import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  EMPTY_STATS,
  type ReportStats,
  aggregateOwnedStats,
  belumSelesai,
  normalizeStats,
} from "../lib/dashboardStats";
import {
  STATUS_LABEL,
  effectiveStatus,
  statusBadgeClass,
} from "../lib/reportStatus";
import type { ReportStatus, Role } from "../lib/types";
import { useSurveyAccess } from "../hooks/useSurveyAccess";

const DAYS = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface RecentReport {
  id: string;
  description: string;
  photo_url: string;
  status: ReportStatus;
  created_at: string;
  sla_due_at: string | null;
  category: { id: string; name: string } | null;
  reporter: { full_name: string | null; email: string | null } | null;
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Tampilan dashboard. Setiap user setidak-tidaknya punya view "pelapor".
 * Bila user juga punya role petugas / pimpinan, tab tambahan muncul.
 */
type DashboardView = "pelapor" | "petugas" | "pimpinan";

const VIEW_LABEL: Record<DashboardView, string> = {
  pelapor: "Pelapor",
  petugas: "Petugas",
  pimpinan: "Pimpinan",
};

const VIEW_STORAGE_KEY = "fsm:dashboard-view";

/** Urutan otoritas (paling tinggi → paling rendah) sebagai default pertama. */
const VIEW_PRIORITY: DashboardView[] = ["pimpinan", "petugas", "pelapor"];

function pickDefaultView(available: DashboardView[]): DashboardView {
  for (const v of VIEW_PRIORITY) {
    if (available.includes(v)) return v;
  }
  return "pelapor";
}

function loadSavedView(available: DashboardView[]): DashboardView {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw && (available as string[]).includes(raw)) {
      return raw as DashboardView;
    }
  } catch {
    /* localStorage may be disabled (private mode) */
  }
  return pickDefaultView(available);
}

function Dashboard() {
  const { session, loading, isSuperadmin, roles, user, profile } = useAuth();
  const navigate = useNavigate();
  const surveyAccess = useSurveyAccess();
  const [now, setNow] = useState<Date>(() => new Date());

  // Available views = pelapor (selalu) + role tambahan yang dipunyai user.
  const availableViews = useMemo<DashboardView[]>(() => {
    const list: DashboardView[] = ["pelapor"];
    if (roles.includes("petugas" as Role)) list.push("petugas");
    if (roles.includes("pimpinan" as Role)) list.push("pimpinan");
    return list;
  }, [roles]);

  const [view, setView] = useState<DashboardView>(() =>
    loadSavedView(["pelapor"]),
  );

  // Kalau roles berubah dan view tersimpan tidak lagi tersedia,
  // jatuhkan ke default berdasar otoritas tertinggi.
  useEffect(() => {
    if (!availableViews.includes(view)) {
      setView(pickDefaultView(availableViews));
    }
  }, [availableViews, view]);

  // Persist selected view.
  const onChangeView = useCallback((v: DashboardView) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  // ===== Data per view =====

  // Pelapor view: laporan yang DIAJUKAN user sendiri.
  const [ownedStats, setOwnedStats] = useState<ReportStats>(EMPTY_STATS);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Petugas/Pimpinan view: stats RPC RLS-scoped + 3 terkini.
  const [scopedStats, setScopedStats] = useState<ReportStats>(EMPTY_STATS);
  const [scopedLoading, setScopedLoading] = useState(false);
  const [scopedError, setScopedError] = useState<string | null>(null);

  const [recent, setRecent] = useState<RecentReport[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const refreshOwned = useCallback(async () => {
    if (!user) return;
    setOwnedError(null);
    const { data, error } = await supabase
      .from("reports")
      .select("status, sla_due_at, pending_verification, created_at")
      .eq("user_id", user.id);
    if (error) {
      setOwnedError(error.message);
      return;
    }
    setOwnedStats(
      aggregateOwnedStats(
        (data ?? []) as Array<{
          status: string;
          sla_due_at: string | null;
          pending_verification: boolean | null;
          created_at: string;
        }>,
      ),
    );
  }, [user]);

  const refreshScoped = useCallback(async () => {
    if (!session || isSuperadmin) return;
    setScopedLoading(true);
    setScopedError(null);
    const { data, error } = await supabase.rpc("report_stats_for_me");
    setScopedLoading(false);
    if (error) {
      setScopedError(error.message);
      return;
    }
    setScopedStats(normalizeStats(data));
  }, [session, isSuperadmin]);

  const refreshRecent = useCallback(
    async (asView: DashboardView) => {
      if (!session || !user) return;
      if (asView !== "petugas" && asView !== "pimpinan") return;
      setRecentLoading(true);
      let query = supabase
        .from("reports")
        .select(
          `id, description, photo_url, status, created_at, sla_due_at,
           category:categories!category_id(id, name),
           reporter:profiles!user_id(full_name, email)`,
        )
        .order("created_at", { ascending: false })
        .limit(3);
      if (asView === "pimpinan") {
        // Laporan Masuk = baru (status='dikirim'), RLS auto-filter wewenang.
        query = query.eq("status", "dikirim");
      } else {
        // Tugas Terkini = ditugaskan kepada saya.
        query = query.eq("status", "ditugaskan").eq("assigned_to", user.id);
      }
      const { data, error } = await query;
      setRecentLoading(false);
      if (error) {
        console.error("Gagal memuat daftar terkini:", error);
        setRecent([]);
        return;
      }
      const rows = ((data ?? []) as unknown[]).map((raw) => {
        const r = raw as RecentReport & {
          category:
            | RecentReport["category"]
            | RecentReport["category"][]
            | null;
          reporter:
            | RecentReport["reporter"]
            | RecentReport["reporter"][]
            | null;
        };
        const norm = <T,>(x: T | T[] | null): T | null =>
          Array.isArray(x) ? (x[0] ?? null) : (x ?? null);
        return {
          ...r,
          category: norm(r.category),
          reporter: norm(r.reporter),
        };
      });
      setRecent(rows);
    },
    [session, user],
  );

  // Fetch data sesuai view aktif. Setiap perpindahan view me-refresh
  // bagian yang relevan saja, sisanya tetap di memori.
  useEffect(() => {
    if (view === "pelapor") {
      void refreshOwned();
    }
  }, [view, refreshOwned]);

  useEffect(() => {
    if (view === "petugas" || view === "pimpinan") {
      void refreshScoped();
      void refreshRecent(view);
    }
  }, [view, refreshScoped, refreshRecent]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (isSuperadmin) return <Navigate to="/superadmin" replace />;

  // ===== Header (jam + tab switcher kalau perlu) =====
  const showSwitcher = availableViews.length > 1;

  // Display name: prioritas full_name → email → fallback "Pengguna".
  // Ditampilkan di header (setelah logo, sebelum kartu jam) supaya
  // user langsung tahu sedang login sebagai siapa di device shared.
  const displayName =
    profile?.full_name?.trim() ||
    profile?.email?.trim() ||
    user?.email ||
    "Pengguna";

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <div className="brand__logo">FSM</div>
          <div>
            <h1 className="brand__title">FSM LAPOR!</h1>
          </div>
        </div>
        <div
          className="user-greeting"
          aria-label="Anda login sebagai"
          style={{
            marginLeft: "auto",
            textAlign: "right",
            display: "flex",
            flexDirection: "column",
            lineHeight: 1.15,
            maxWidth: "55%",
          }}
        >
          <span className="muted small">Halo,</span>
          <strong
            style={{
              fontSize: "0.95rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </strong>
        </div>
      </header>

      <main className="app__main">
        <section className="card clock-card">
          <div className="clock-card__time" aria-live="polite">
            {formatTime(now)}
          </div>
          <div className="clock-card__date">{formatDate(now)}</div>
        </section>

        {showSwitcher && (
          <nav
            className="view-switcher"
            role="tablist"
            aria-label="Pilih tampilan dashboard"
          >
            <span className="view-switcher__hint">Tampil sebagai:</span>
            <div className="view-switcher__tabs">
              {availableViews.map((v) => {
                const isActive = view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`view-switcher__tab${
                      isActive ? " is-active" : ""
                    }`}
                    onClick={() => onChangeView(v)}
                  >
                    {VIEW_LABEL[v]}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {view === "pelapor" && (
          <PelaporView
            ownedStats={ownedStats}
            ownedError={ownedError}
            navigate={navigate}
          />
        )}
        {view === "petugas" && (
          <PetugasView
            scopedStats={scopedStats}
            scopedLoading={scopedLoading}
            scopedError={scopedError}
            recent={recent}
            recentLoading={recentLoading}
            refreshScoped={refreshScoped}
            navigate={navigate}
          />
        )}
        {view === "pimpinan" && (
          <PimpinanView
            scopedStats={scopedStats}
            scopedLoading={scopedLoading}
            scopedError={scopedError}
            recent={recent}
            recentLoading={recentLoading}
            refreshScoped={refreshScoped}
            navigate={navigate}
          />
        )}

        {/* Tombol Profil tetap ada di SEMUA view sebagai pintu keluar
            ke pengaturan akun pribadi. */}
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => navigate("/profile")}
        >
          Profil
        </button>

        {/* Modul Survey Aset — tombol hanya muncul bila petugas/pimpinan
            sudah diberi akses oleh superadmin (lewat manajemen
            survey-aset). Tidak tergantung pada view yang aktif. */}
        {!surveyAccess.loading && surveyAccess.enabled && (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => navigate("/survey-aset")}
          >
            Survey dan Aset
          </button>
        )}

        {/* Modul Kinerja Pegawai (PR-D..F). Visible untuk semua user
            login — gating per-aksi terjadi di dalam halaman /kinerja. */}
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => navigate("/kinerja")}
        >
          Kinerja Pegawai
        </button>
      </main>
    </div>
  );
}

/* ============================================================
 * View: PELAPOR — fokus laporan yang DIAJUKAN sendiri.
 * ============================================================ */
function PelaporView(props: {
  ownedStats: ReportStats;
  ownedError: string | null;
  navigate: (to: string) => void;
}) {
  const { ownedStats, ownedError, navigate } = props;
  const aktif = belumSelesai(ownedStats);

  return (
    <>
      <button
        type="button"
        className="summary-tile"
        onClick={() => navigate("/laporan-saya")}
        aria-label="Lihat semua laporan Anda"
      >
        <span className="summary-tile__title">Ringkasan Laporan Anda</span>
        <span className="summary-tile__grid">
          <SummaryCell label="Total" value={ownedStats.total} />
          <SummaryCell label="Aktif" value={aktif} />
          <SummaryCell label="Selesai" value={ownedStats.diselesaikan} />
          <SummaryCell
            label="Melebihi SLA"
            value={ownedStats.overdue}
            alert={ownedStats.overdue > 0}
          />
        </span>
        <span className="summary-tile__cta">Lihat Laporan Saya →</span>
        {ownedError && (
          <span className="summary-tile__err">Gagal memuat: {ownedError}</span>
        )}
      </button>

      <button
        type="button"
        className="btn btn--primary btn--block btn--lg"
        onClick={() => navigate("/laporan")}
      >
        + Buat Laporan
      </button>
    </>
  );
}

/* ============================================================
 * View: PETUGAS — fokus tugas yang ditugaskan kepada saya.
 * ============================================================ */
function PetugasView(props: {
  scopedStats: ReportStats;
  scopedLoading: boolean;
  scopedError: string | null;
  recent: RecentReport[];
  recentLoading: boolean;
  refreshScoped: () => Promise<void>;
  navigate: (to: string) => void;
}) {
  const {
    scopedStats,
    scopedLoading,
    scopedError,
    recent,
    recentLoading,
    refreshScoped,
    navigate,
  } = props;
  const aktif = belumSelesai(scopedStats);

  return (
    <>
      <ScopedStatsCard
        title="Statistik Tugas Anda"
        stats={scopedStats}
        aktif={aktif}
        loading={scopedLoading}
        error={scopedError}
        onRetry={() => void refreshScoped()}
        showPendingVerificationLine={false}
      />

      <RecentList
        title="Tugas Terkini"
        emptyText="Tidak ada tugas aktif. 🎉"
        helpText="Laporan yang ditugaskan kepada Anda dan masih berstatus Ditugaskan."
        recent={recent}
        loading={recentLoading}
        navigate={navigate}
      />

      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => navigate("/manajemen-laporan")}
      >
        Lihat Semua Penugasan →
      </button>
    </>
  );
}

/* ============================================================
 * View: PIMPINAN — fokus laporan masuk di wewenang.
 * ============================================================ */
function PimpinanView(props: {
  scopedStats: ReportStats;
  scopedLoading: boolean;
  scopedError: string | null;
  recent: RecentReport[];
  recentLoading: boolean;
  refreshScoped: () => Promise<void>;
  navigate: (to: string) => void;
}) {
  const {
    scopedStats,
    scopedLoading,
    scopedError,
    recent,
    recentLoading,
    refreshScoped,
    navigate,
  } = props;
  const aktif = belumSelesai(scopedStats);

  return (
    <>
      <ScopedStatsCard
        title="Statistik dalam Wewenang Anda"
        stats={scopedStats}
        aktif={aktif}
        loading={scopedLoading}
        error={scopedError}
        onRetry={() => void refreshScoped()}
        showPendingVerificationLine
      />

      <RecentList
        title="Laporan Masuk"
        emptyText="Tidak ada laporan masuk."
        helpText="Laporan baru masuk yang masih menunggu untuk diterima/ditugaskan."
        recent={recent}
        loading={recentLoading}
        navigate={navigate}
      />

      {/* Monitoring Petugas — shortcut langsung ke halaman daftar
          petugas. Halaman tujuan sudah handle access check (butuh
          Survey Aset access). Tombol selalu render — kalau pimpinan
          belum punya akses, halaman /survey-aset/petugas akan
          redirect ke /survey-aset dan menampilkan pesan akses. */}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => navigate("/survey-aset/petugas")}
      >
        Monitoring Petugas →
      </button>

      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => navigate("/manajemen-laporan")}
      >
        Lihat Semua Laporan →
      </button>
    </>
  );
}

/* ============================================================
 * Sub-komponen yang dipakai bersama oleh petugas/pimpinan view.
 * ============================================================ */
function ScopedStatsCard(props: {
  title: string;
  stats: ReportStats;
  aktif: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  showPendingVerificationLine: boolean;
}) {
  return (
    <section className="card">
      <header className="report-list__header">
        <h2 className="section-title" style={{ margin: 0 }}>
          {props.title}
        </h2>
      </header>
      {props.error ? (
        <div className="notice notice--warn">
          <span>
            <strong>Statistik tidak dapat dimuat:</strong> {props.error}.
            Pastikan migrasi terbaru sudah dijalankan.
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={props.onRetry}
          >
            Coba Lagi
          </button>
        </div>
      ) : props.loading && props.stats.total === 0 ? (
        <p className="muted small">Memuat statistik...</p>
      ) : (
        <>
          <div className="stats-grid stats-grid--4">
            <StatBox label="Total" value={props.stats.total} tone="info" />
            <StatBox label="Aktif" value={props.aktif} tone="accent" />
            <StatBox
              label="Selesai"
              value={props.stats.diselesaikan}
              tone="ok"
            />
            <StatBox
              label="Melebihi SLA"
              value={props.stats.overdue}
              tone="danger"
            />
          </div>
          {props.showPendingVerificationLine &&
            props.stats.pending_verification > 0 && (
              <p className="muted small" style={{ marginTop: "0.6rem" }}>
                Menunggu verifikasi:{" "}
                <strong>{props.stats.pending_verification}</strong>
              </p>
            )}
        </>
      )}
    </section>
  );
}

function RecentList(props: {
  title: string;
  emptyText: string;
  helpText: string;
  recent: RecentReport[];
  loading: boolean;
  navigate: (to: string) => void;
}) {
  return (
    <section className="card">
      <header className="report-list__header">
        <h2 className="section-title" style={{ margin: 0 }}>
          {props.title}
        </h2>
        <span className="badge">{props.recent.length}</span>
        <span className="muted small">maks. 3 terbaru</span>
      </header>
      <p className="section-desc" style={{ marginBottom: "0.5rem" }}>
        {props.helpText}
      </p>

      {props.loading && props.recent.length === 0 ? (
        <p className="muted small">Memuat...</p>
      ) : props.recent.length === 0 ? (
        <div className="empty">
          <p>{props.emptyText}</p>
        </div>
      ) : (
        <ul className="report-list__items">
          {props.recent.map((r) => {
            const eff = effectiveStatus({
              status: r.status,
              slaDueAt: r.sla_due_at,
            });
            return (
              <li key={r.id} className="report-item">
                <div className="report-item__photo">
                  <img src={r.photo_url} alt="Foto laporan" loading="lazy" />
                </div>
                <div className="report-item__body">
                  <p className="report-item__desc">{r.description}</p>
                  {r.reporter && (
                    <p className="muted small" style={{ margin: "0.2rem 0" }}>
                      <strong>Pelapor:</strong>{" "}
                      {r.reporter.full_name || r.reporter.email || "-"}
                    </p>
                  )}
                  {r.category && (
                    <p className="muted small" style={{ margin: "0.2rem 0" }}>
                      <strong>Jenis:</strong> {r.category.name}
                    </p>
                  )}
                  <div className="report-item__chips">
                    <span className={statusBadgeClass(eff)}>
                      {STATUS_LABEL[eff]}
                    </span>
                    <span className="muted small">
                      {fmtDateShort(r.created_at)}
                    </span>
                  </div>
                  {r.sla_due_at && (
                    <p className="muted small" style={{ margin: "0.2rem 0" }}>
                      <strong>SLA:</strong> {fmtDateShort(r.sla_due_at)}
                    </p>
                  )}
                  <div className="report-item__action-row">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => props.navigate(`/laporan/${r.id}`)}
                    >
                      Detail
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SummaryCell(props: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <span className="summary-tile__cell">
      <span
        className={`summary-tile__value${
          props.alert ? " summary-tile__value--alert" : ""
        }`}
      >
        {props.value}
      </span>
      <span className="summary-tile__label">{props.label}</span>
    </span>
  );
}

function StatBox(props: {
  label: string;
  value: number;
  tone?: "info" | "ok" | "warn" | "danger" | "accent";
}) {
  const cls = `stat-box stat-box--${props.tone ?? "neutral"}`;
  return (
    <div className={cls}>
      <div className="stat-box__value">{props.value}</div>
      <div className="stat-box__label">{props.label}</div>
    </div>
  );
}

export default Dashboard;
