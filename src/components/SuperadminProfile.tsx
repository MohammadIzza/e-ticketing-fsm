import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  EMPTY_STATS,
  type ReportStats,
  belumSelesai,
  normalizeStats,
} from "../lib/dashboardStats";
import AvatarBlock from "./AvatarBlock";

function SuperadminProfile() {
  const {
    session,
    isSuperadmin,
    loading,
    profile,
    profileLoading,
    updateMyProfile,
    signOut,
  } = useAuth();
  const navigate = useNavigate();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<ReportStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingName) setName(profile?.full_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.full_name]);

  const refreshStats = useCallback(async () => {
    if (!session || !isSuperadmin) return;
    setStatsLoading(true);
    setStatsError(null);
    const { data, error: err } = await supabase.rpc("report_stats_for_me");
    setStatsLoading(false);
    if (err) {
      setStatsError(err.message);
      return;
    }
    setStats(normalizeStats(data));
  }, [session, isSuperadmin]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/superadmin/login" replace />;
  if (!isSuperadmin) return <Navigate to="/profile" replace />;
  if (!profile && profileLoading) {
    return <div className="auth-screen muted">Memuat profil...</div>;
  }

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

  const handleLogout = async () => {
    await signOut();
    navigate("/superadmin/login", { replace: true });
  };

  return (
    <div className="app">
      <main className="app__main">
        <section className="card profile-card">
          <header className="profile-header">
            <h1 className="section-title" style={{ margin: 0 }}>
              Profil Superadmin
            </h1>
          </header>

          <AvatarBlock fallback={profile?.username ?? "S"} />

          <dl className="profile-summary">
            <div>
              <dt>Nama</dt>
              <dd>{profile?.full_name || "-"}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{profile?.username || "-"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>superadmin</dd>
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

          {/* Big tile menggantikan tombol Manajemen Laporan, dengan stats. */}
          <button
            type="button"
            className="stat-tile"
            onClick={() => navigate("/manajemen-laporan")}
            aria-label="Buka Manajemen Laporan"
          >
            <div className="stat-tile__title">Manajemen Laporan</div>
            <div className="stat-tile__subtitle">
              {statsLoading
                ? "Memuat statistik..."
                : statsError
                  ? "Statistik tidak dapat dimuat"
                  : "Ringkasan seluruh laporan di sistem"}
            </div>
            {!statsError && (
              <div className="stat-tile__grid">
                <StatTileItem label="Total" value={stats.total} />
                <StatTileItem
                  label="Belum Selesai"
                  value={belumSelesai(stats)}
                />
                <StatTileItem
                  label="Selesai"
                  value={stats.diselesaikan}
                />
                <StatTileItem
                  label="Menunggu Verifikasi"
                  value={stats.pending_verification}
                />
                <StatTileItem
                  label="Melebihi SLA"
                  value={stats.overdue}
                  emphasize={stats.overdue > 0}
                />
                <StatTileItem label="Hari Ini" value={stats.hari_ini} />
              </div>
            )}
            <div className="stat-tile__cta">Buka Manajemen Laporan →</div>
          </button>

          {statsError && (
            <div className="notice notice--warn">
              <span>
                <strong>Statistik tidak dapat dimuat:</strong> {statsError}.
                Pastikan migrasi terbaru sudah dijalankan
                (workflow <em>Bootstrap Supabase</em>).
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void refreshStats();
                }}
              >
                Coba Lagi
              </button>
            </div>
          )}

          <div className="profile-actions profile-actions--stack">
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/superadmin/users")}
            >
              Manajemen Pengguna
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/superadmin/categories")}
            >
              Jenis Laporan
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/superadmin/positions")}
            >
              Manajemen Jabatan
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/superadmin/reporter-types")}
            >
              Manajemen Jenis Pelapor
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/survey-aset/petugas")}
            >
              Monitoring Petugas
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/kinerja")}
            >
              Kinerja Pegawai
            </button>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate("/superadmin/kinerja")}
            >
              Konfigurasi Kinerja Pegawai
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/laporan")}
            >
              Buat Laporan
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/survey-aset")}
            >
              Survey dan Aset
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

function StatTileItem(props: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`stat-tile__item${props.emphasize ? " stat-tile__item--alert" : ""}`}
    >
      <div className="stat-tile__item-value">{props.value}</div>
      <div className="stat-tile__item-label">{props.label}</div>
    </div>
  );
}

export default SuperadminProfile;
