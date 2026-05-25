import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { formatAccuracy, formatCoords } from "../lib/geo";
import CameraCapture from "./CameraCapture";
import type { Category, CategorySlaOption } from "../lib/types";

type GeoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      latitude: number;
      longitude: number;
      accuracy: number;
      capturedAt: number;
    }
  | { kind: "error"; message: string };

function Laporan() {
  const { session, isSuperadmin, loading, user, profile } = useAuth();
  const navigate = useNavigate();

  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  const [slaOptions, setSlaOptions] = useState<CategorySlaOption[]>([]);
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaOptionId, setSlaOptionId] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Load active categories + filter by user's reporter type.
  //
  // Aturan filter (Item #2):
  //   - Kategori yang TIDAK punya baris di `category_reporter_types`
  //     dianggap "open to all" — boleh dipilih jenis pelapor manapun.
  //   - Kategori yang PUNYA baris hanya muncul untuk pelapor dengan
  //     `profile.reporter_type_id` IN list itu.
  //   - Pelapor tanpa jenis pelapor (reporter_type_id NULL) hanya
  //     melihat kategori yang open to all.
  useEffect(() => {
    let mounted = true;
    setCatLoading(true);
    Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("category_reporter_types")
        .select("category_id, reporter_type_id"),
    ]).then(([catRes, crtRes]) => {
      if (!mounted) return;
      setCatLoading(false);
      if (catRes.error) {
        console.error("Failed to load categories:", catRes.error);
        setCategories([]);
        return;
      }
      const all = (catRes.data ?? []) as Category[];
      // Bila tabel belum ada (mis. migrasi 0019 belum dijalankan), fallback
      // ke "tampilkan semua" agar tidak memblok pelapor.
      if (crtRes.error) {
        console.warn(
          "category_reporter_types unavailable — showing all categories:",
          crtRes.error.message,
        );
        setCategories(all);
        return;
      }
      const restrictionMap = new Map<string, Set<string>>();
      for (const r of (crtRes.data ?? []) as {
        category_id: string;
        reporter_type_id: string;
      }[]) {
        const set = restrictionMap.get(r.category_id) ?? new Set<string>();
        set.add(r.reporter_type_id);
        restrictionMap.set(r.category_id, set);
      }
      const myType = profile?.reporter_type_id ?? null;
      const filtered = all.filter((c) => {
        const allowed = restrictionMap.get(c.id);
        if (!allowed || allowed.size === 0) return true; // open to all
        // Superadmin selalu melihat semua kategori (mis. saat memverifikasi
        // form di lingkungan dev). Pelapor biasa harus match.
        if (isSuperadmin) return true;
        return myType !== null && allowed.has(myType);
      });
      setCategories(filtered);
    });
    return () => {
      mounted = false;
    };
  }, [profile?.reporter_type_id, isSuperadmin]);

  // Load SLA options whenever category changes.
  useEffect(() => {
    setSlaOptionId("");
    if (!categoryId) {
      setSlaOptions([]);
      return;
    }
    let mounted = true;
    setSlaLoading(true);
    supabase
      .from("category_sla_options")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .then(({ data, error: err }) => {
        if (!mounted) return;
        setSlaLoading(false);
        if (err) {
          console.error("Failed to load SLA options:", err);
          setSlaOptions([]);
          return;
        }
        setSlaOptions((data ?? []) as CategorySlaOption[]);
      });
    return () => {
      mounted = false;
    };
  }, [categoryId]);

  const tryCaptureGeo = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({
        kind: "error",
        message: "Browser tidak mendukung geolocation.",
      });
      return;
    }
    setGeo({ kind: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          kind: "ok",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: pos.timestamp,
        });
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Izin lokasi ditolak. Aktifkan akses lokasi di pengaturan browser untuk verifikasi otomatis."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Posisi tidak tersedia (sinyal GPS lemah?)."
              : err.code === err.TIMEOUT
                ? "Mengambil lokasi terlalu lama. Coba lagi."
                : err.message || "Gagal mengambil lokasi.";
        setGeo({ kind: "error", message: msg });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  // Auto-attempt sekali saat mount.
  useEffect(() => {
    tryCaptureGeo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;

  const backTo = isSuperadmin ? "/superadmin" : "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!photo) {
      setError("Ambil foto terlebih dahulu.");
      return;
    }
    if (!description.trim()) {
      setError("Keterangan wajib diisi.");
      return;
    }
    if (!categoryId) {
      setError("Pilih jenis laporan.");
      return;
    }
    if (slaOptions.length > 0 && !slaOptionId) {
      setError("Pilih SLA (kapan harus diselesaikan).");
      return;
    }
    setSaving(true);
    try {
      const ts = Date.now();
      const ext = (photo.type.split("/")[1] || "jpg").split("+")[0];
      const path = `reports/${user.id}/${ts}.${ext}`;
      const contentType =
        photo.type && photo.type !== "" ? photo.type : "image/jpeg";

      const { error: upErr } = await supabase.storage
        .from("report-photos")
        .upload(path, photo, {
          cacheControl: "3600",
          contentType,
          upsert: false,
        });
      if (upErr) {
        setError(upErr.message);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("report-photos").getPublicUrl(path);

      const geoFields =
        geo.kind === "ok"
          ? {
              latitude: geo.latitude,
              longitude: geo.longitude,
              accuracy_m: geo.accuracy,
              geo_captured_at: new Date(geo.capturedAt).toISOString(),
            }
          : {};

      const slaField = slaOptionId ? { sla_option_id: slaOptionId } : {};

      const { error: insErr } = await supabase.from("reports").insert({
        user_id: user.id,
        photo_url: publicUrl,
        description: description.trim(),
        category_id: categoryId,
        ...geoFields,
        ...slaField,
      });
      if (insErr) {
        await supabase.storage.from("report-photos").remove([path]);
        setError(insErr.message);
        return;
      }
      navigate(isSuperadmin ? "/manajemen-laporan" : "/laporan-saya", {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan laporan.");
    } finally {
      setSaving(false);
    }
  };

  const renderGeoStatus = () => {
    if (geo.kind === "idle") return null;
    if (geo.kind === "loading") {
      return (
        <p className="notice notice--info" style={{ margin: 0 }}>
          Mengambil lokasi...
        </p>
      );
    }
    if (geo.kind === "error") {
      return (
        <div className="notice notice--warn">
          <span>
            Lokasi tidak tertangkap: {geo.message}
            <br />
            <span className="small">
              Anda tetap bisa mengirim laporan tanpa lokasi, tetapi sistem
              tidak dapat memverifikasi posisi.
            </span>
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={tryCaptureGeo}
          >
            Coba Lagi
          </button>
        </div>
      );
    }
    return (
      <div className="notice notice--info">
        <span>
          <strong>Lokasi terdeteksi:</strong>{" "}
          {formatCoords(
            { latitude: geo.latitude, longitude: geo.longitude },
            5,
          )}{" "}
          {formatAccuracy(geo.accuracy)}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={tryCaptureGeo}
        >
          Refresh
        </button>
      </div>
    );
  };

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(backTo)}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Buat Laporan</h1>
        </div>

        <section className="card">
          <form className="report-form" onSubmit={handleSubmit}>
            {!photo ? (
              <CameraCapture autoStart onCapture={(blob) => setPhoto(blob)} />
            ) : (
              <div className="photo-preview">
                {photoUrl && <img src={photoUrl} alt="Pratinjau foto" />}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setPhoto(null)}
                >
                  Foto Ulang
                </button>
              </div>
            )}

            <label className="field">
              <span className="field__label">Jenis Laporan</span>
              <select
                className="field__input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
                required
                disabled={catLoading || categories.length === 0}
              >
                <option value="">
                  {catLoading
                    ? "Memuat..."
                    : categories.length === 0
                      ? "Belum ada jenis tersedia"
                      : "— Pilih jenis —"}
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {categories.length === 0 && !catLoading && (
                <span className="muted small">
                  Hubungi superadmin untuk menambah jenis laporan.
                </span>
              )}
            </label>

            {categoryId && (slaLoading || slaOptions.length > 0) && (
              <label className="field">
                <span className="field__label">
                  SLA (kapan harus diselesaikan)
                </span>
                <select
                  className="field__input"
                  value={slaOptionId}
                  onChange={(e) => setSlaOptionId(e.target.value)}
                  disabled={slaLoading}
                  style={{ minHeight: "2.5rem" }}
                  required={slaOptions.length > 0}
                >
                  <option value="">
                    {slaLoading ? "Memuat..." : "— Pilih SLA —"}
                  </option>
                  {slaOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.hours} jam)
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              <span className="field__label">Keterangan</span>
              <textarea
                className="field__input"
                rows={4}
                placeholder="Tulis detail laporan, lokasi, waktu kejadian..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </label>

            {renderGeoStatus()}

            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={saving || !photo || categories.length === 0}
            >
              {saving ? "Mengirim..." : "Kirim Laporan"}
            </button>

            {error && <p className="notice notice--warn">{error}</p>}
          </form>
        </section>
      </main>
    </div>
  );
}

export default Laporan;
