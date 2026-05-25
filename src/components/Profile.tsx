import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_EVENT_LABEL,
  notificationPermission,
  notificationsSupported,
  playRingtone,
  requestNotificationPermission,
  showNotification,
  unlockAudio,
  type ReportEventKey,
} from "../lib/notifications";
import { emitToast } from "../lib/notificationToast";
import type { NotificationPrefs } from "../lib/types";
import AvatarBlock from "./AvatarBlock";

const EVENT_KEYS: ReportEventKey[] = [
  "diterima",
  "ditugaskan",
  "diselesaikan",
  "verified",
];

function mergeWithDefaults(
  src: NotificationPrefs | null | undefined,
): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(src ?? {}) };
}

function Profile() {
  const {
    session,
    isSuperadmin,
    loading,
    user,
    profile,
    profileLoading,
    roles,
    updateMyProfile,
    signOut,
  } = useAuth();
  const navigate = useNavigate();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ----- Nomor WhatsApp -----
  const [editingWa, setEditingWa] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [savingWa, setSavingWa] = useState(false);
  const [waInfo, setWaInfo] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);

  // ----- Notifikasi -----
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifInfo, setNotifInfo] = useState<string | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => notificationPermission());

  // Reset edit state setiap kali profil terload baru.
  useEffect(() => {
    if (!editingName) {
      setName(profile?.full_name ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.full_name]);

  useEffect(() => {
    if (!editingWa) {
      setWaNumber(profile?.wa_number ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.wa_number]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (isSuperadmin) return <Navigate to="/superadmin" replace />;
  if (!profile && profileLoading) {
    return <div className="auth-screen muted">Memuat profil...</div>;
  }

  const prefs = mergeWithDefaults(profile?.notification_prefs);

  const handleStartEdit = () => {
    setError(null);
    setInfo(null);
    setName(profile?.full_name ?? "");
    setEditingName(true);
  };

  const handleCancelEdit = () => {
    setName(profile?.full_name ?? "");
    setEditingName(false);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    setSavingName(true);
    const { error: err } = await updateMyProfile({ fullName: cleanName });
    setSavingName(false);
    if (err) {
      setError(err);
    } else {
      setInfo("Nama tersimpan.");
      setEditingName(false);
    }
  };

  // ----- WA handlers -----
  const handleStartEditWa = () => {
    setWaError(null);
    setWaInfo(null);
    setWaNumber(profile?.wa_number ?? "");
    setEditingWa(true);
  };

  const handleCancelEditWa = () => {
    setWaNumber(profile?.wa_number ?? "");
    setEditingWa(false);
    setWaError(null);
  };

  const handleSaveWa = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaError(null);
    setWaInfo(null);
    // Trim + biarkan empty string lewat (artinya: kosongkan).
    const raw = waNumber.trim();
    if (raw !== "") {
      // Frontend pre-check ringan; RPC server-side juga memvalidasi.
      const cleanedDigits = raw.replace(/[^0-9+]/g, "");
      if (cleanedDigits.length < 6) {
        setWaError("Nomor WhatsApp tidak valid (minimal 6 digit).");
        return;
      }
    }
    setSavingWa(true);
    const { error: err } = await updateMyProfile({ waNumber: raw });
    setSavingWa(false);
    if (err) {
      setWaError(err);
    } else {
      setWaInfo(
        raw === "" ? "Nomor WA dihapus." : "Nomor WA tersimpan.",
      );
      setEditingWa(false);
    }
  };

  // ----- Notifikasi handlers -----
  const persistPrefs = async (next: NotificationPrefs) => {
    setNotifSaving(true);
    setNotifError(null);
    setNotifInfo(null);
    const { error: err } = await updateMyProfile({
      notificationPrefs: next,
    });
    setNotifSaving(false);
    if (err) {
      setNotifError(err);
    } else {
      setNotifInfo("Preferensi notifikasi tersimpan.");
    }
  };

  const handleToggleMaster = async () => {
    const next = mergeWithDefaults(profile?.notification_prefs);
    const willEnable = !next.enabled;
    if (willEnable) {
      // Saat enable, minta permission dulu kalau belum granted.
      if (!notificationsSupported()) {
        setNotifError(
          "Browser Anda tidak mendukung Notification API. Notifikasi tidak akan tampil.",
        );
        return;
      }
      // Click sekaligus user gesture — unlock audio supaya nantinya
      // ringtone bisa diputar saat notifikasi pertama datang.
      unlockAudio();
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result !== "granted") {
        setNotifError(
          "Izin notifikasi belum diberikan. Aktifkan izin pada browser, lalu coba lagi.",
        );
        return;
      }
      next.enabled = true;
      // PENTING: saat user pertama kali mengaktifkan master switch, otomatis
      // nyalakan SEMUA per-event toggles supaya UX-nya intuitif. Tanpa baris
      // ini user akan toggle "Aktifkan notifikasi" → ON, beri izin, lalu
      // tidak pernah dapat notifikasi karena `isEventEnabled()` butuh
      // `prefs[event] === true` per-event. User dapat opt-out per-event
      // setelahnya melalui checkbox di bawah.
      for (const k of EVENT_KEYS) {
        next[k] = true;
      }
    } else {
      // Disable master saja — preserve preferensi per-event supaya
      // kalau user re-enable lagi pilihannya kembali. Kita TIDAK reset
      // toggle per-event ke false di sini.
      next.enabled = false;
    }
    await persistPrefs(next);
  };

  const handleToggleEvent = async (key: ReportEventKey) => {
    const next = mergeWithDefaults(profile?.notification_prefs);
    next[key] = !next[key];
    await persistPrefs(next);
  };

  // ----- Test Notifikasi -----
  // Tombol manual untuk membuktikan Notification API + permission bekerja
  // di device pengguna, tanpa harus menunggu perubahan status laporan dari
  // pimpinan/petugas.
  const handleTestNotification = async () => {
    setNotifError(null);
    setNotifInfo(null);
    // Unlock audio sekaligus (klik tombol = user gesture). Tanpa ini,
    // playRingtone() pertama bisa di-block oleh autoplay policy.
    unlockAudio();
    if (!notificationsSupported()) {
      setNotifError("Browser Anda tidak mendukung Notification API.");
      return;
    }
    let perm = notificationPermission();
    if (perm !== "granted") {
      perm = await requestNotificationPermission();
      setPermission(perm);
    }
    if (perm !== "granted") {
      setNotifError(
        "Izin notifikasi belum diberikan. Aktifkan izin pada browser, lalu coba lagi.",
      );
      return;
    }
    showNotification("FSM LAPOR! - Tes Notifikasi", {
      body: "Notifikasi berhasil tampil. Anda siap menerima update laporan di device ini.",
      tag: "fsm-test-notification",
    });
    // Tampilkan juga in-app toast + bunyikan ringtone, supaya user
    // langsung tahu bagaimana tampilan notifikasi nantinya.
    emitToast({
      title: "FSM LAPOR! - Tes Notifikasi",
      body: "Notifikasi berhasil tampil + nada dering aktif.",
      tone: "success",
    });
    try {
      playRingtone();
    } catch {
      // ignore — ringtone optional
    }
    setNotifInfo(
      "Notifikasi tes dikirim. Cek pojok atas/bawah layar atau pusat notifikasi sistem.",
    );
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const verified = !!user?.email_confirmed_at;

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/dashboard")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Profil</h1>
        </div>

        <section className="card profile-card">
          <AvatarBlock fallback={profile?.full_name ?? profile?.email ?? "P"} />

          <dl className="profile-summary">
            <div>
              <dt>Nama</dt>
              <dd>{profile?.full_name || "-"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile?.email || user?.email || "-"}</dd>
            </div>
            <div>
              <dt>Status Email</dt>
              <dd>
                {verified ? (
                  <span className="pill pill--ok">✓ Terverifikasi</span>
                ) : (
                  <span className="pill pill--warn">Belum Diverifikasi</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Nomor WA</dt>
              <dd>{profile?.wa_number || "(belum diisi)"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.3rem",
                  }}
                >
                  {roles.length > 0 ? (
                    roles.map((r) => (
                      <span key={r} className={`pill pill--role-${r}`}>
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="pill">pelapor</span>
                  )}
                </div>
              </dd>
            </div>
          </dl>

          <div className="profile-section">
            <h2 className="profile-section__title">Nama</h2>
            {!editingName ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <span className="muted small">
                  {profile?.full_name || "(belum diisi)"}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleStartEdit}
                >
                  Ganti Nama
                </button>
              </div>
            ) : (
              <form className="report-form" onSubmit={handleSaveName}>
                <label className="field">
                  <span className="field__label">Nama Baru</span>
                  <input
                    type="text"
                    className="field__input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    style={{ minHeight: "2.5rem" }}
                    required
                  />
                </label>
                <div className="profile-actions">
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={savingName}
                  >
                    {savingName ? "Menyimpan..." : "Simpan"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={handleCancelEdit}
                    disabled={savingName}
                  >
                    Batal
                  </button>
                </div>
              </form>
            )}
            {error && <p className="notice notice--warn">{error}</p>}
            {info && <p className="notice notice--info">{info}</p>}
          </div>

          {/* ===== Nomor WhatsApp (opsional) ===== */}
          <div className="profile-section">
            <h2 className="profile-section__title">Nomor WhatsApp</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Opsional. Bila diisi, nomor ini dapat dilihat petugas/pimpinan
              dari halaman Detail Laporan untuk menghubungi Anda.
            </p>
            {!editingWa ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <span className="muted small">
                  {profile?.wa_number || "(belum diisi)"}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleStartEditWa}
                >
                  {profile?.wa_number ? "Ubah" : "Isi"} Nomor WA
                </button>
              </div>
            ) : (
              <form className="report-form" onSubmit={handleSaveWa}>
                <label className="field">
                  <span className="field__label">
                    Nomor WhatsApp (kosongkan untuk hapus)
                  </span>
                  <input
                    type="tel"
                    inputMode="tel"
                    className="field__input"
                    value={waNumber}
                    onChange={(e) => setWaNumber(e.target.value)}
                    placeholder="contoh: +6281234567890"
                    autoFocus
                    style={{ minHeight: "2.5rem" }}
                  />
                </label>
                <div className="profile-actions">
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={savingWa}
                  >
                    {savingWa ? "Menyimpan..." : "Simpan"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={handleCancelEditWa}
                    disabled={savingWa}
                  >
                    Batal
                  </button>
                </div>
              </form>
            )}
            {waError && <p className="notice notice--warn">{waError}</p>}
            {waInfo && <p className="notice notice--info">{waInfo}</p>}
          </div>

          {/* ===== Notifikasi ===== */}
          <div className="profile-section">
            <h2 className="profile-section__title">Notifikasi</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Atur notifikasi untuk perubahan status laporan. Default
              notifikasi <strong>nonaktif</strong>; Anda perlu memberikan
              izin browser saat mengaktifkannya.
            </p>

            {permission === "unsupported" && (
              <p className="notice notice--warn">
                Browser Anda tidak mendukung Notification API. Notifikasi
                tidak akan tampil meski diaktifkan.
              </p>
            )}
            {permission === "denied" && (
              <p className="notice notice--warn">
                Izin notifikasi pada browser <strong>diblokir</strong>.
                Buka pengaturan situs di browser untuk mengizinkannya
                lalu kembali ke halaman ini.
              </p>
            )}

            <label
              className="field"
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
              }}
            >
              <span className="field__label" style={{ marginBottom: 0 }}>
                Aktifkan notifikasi
              </span>
              <input
                type="checkbox"
                checked={!!prefs.enabled}
                onChange={() => void handleToggleMaster()}
                disabled={notifSaving}
                aria-label="Aktifkan notifikasi"
                style={{ width: "1.25rem", height: "1.25rem" }}
              />
            </label>

            <fieldset
              disabled={!prefs.enabled || notifSaving}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                opacity: prefs.enabled ? 1 : 0.55,
              }}
            >
              <legend className="muted small" style={{ marginBottom: "0.4rem" }}>
                Jenis perubahan status yang ingin dinotifikasi:
              </legend>
              {EVENT_KEYS.map((k) => (
                <label
                  key={k}
                  className="field"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    marginBottom: "0.4rem",
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {NOTIFICATION_EVENT_LABEL[k]}
                  </span>
                  <input
                    type="checkbox"
                    checked={!!prefs[k]}
                    onChange={() => void handleToggleEvent(k)}
                    disabled={!prefs.enabled || notifSaving}
                    aria-label={NOTIFICATION_EVENT_LABEL[k]}
                    style={{ width: "1.15rem", height: "1.15rem" }}
                  />
                </label>
              ))}
            </fieldset>

            {notifError && (
              <p className="notice notice--warn">{notifError}</p>
            )}
            {notifInfo && <p className="notice notice--info">{notifInfo}</p>}

            {/*
             * Tombol "Tes Notifikasi" — bantu user/admin verifikasi bahwa
             * Notification API + permission browser bekerja di device ini
             * tanpa perlu menunggu perubahan status laporan dari pimpinan/
             * petugas. Kalau tombol ini ditekan dan tidak ada notifikasi
             * muncul, masalahnya 99% di permission/OS-level (mis. Do Not
             * Disturb), bukan di kode realtime.
             */}
            <div className="profile-actions" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void handleTestNotification()}
                disabled={
                  permission === "unsupported" || permission === "denied"
                }
              >
                Tes Notifikasi
              </button>
            </div>

            <p className="muted small">
              Catatan: notifikasi tampil saat aplikasi sedang dibuka di
              browser/PWA. Kalau aplikasi tertutup penuh, notifikasi push
              latar belakang belum didukung.
            </p>
          </div>

          {/*
           * Tombol pintas "Penugasan Laporan" / "Manajemen Laporan" sudah
           * dipindahkan ke Dashboard (lihat tombol "Lihat Semua ..." di
           * view Petugas/Pimpinan). Halaman Profil sekarang fokus murni
           * pada akun pribadi: ganti nama/WA, preferensi notifikasi,
           * password, kontak admin, dan logout — supaya tidak ada dua
           * pintu masuk yang tumpang tindih ke fitur manajemen.
           */}
          <div className="profile-actions profile-actions--stack">
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/profile/password")}
            >
              Ganti Password
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/profile/contact-admin")}
            >
              Hubungi Administrator
            </button>
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={() => void handleLogout()}
            >
              Logout
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Profile;
