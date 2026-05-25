import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { buildMapsUrl, formatAccuracy, formatCoords, hasCoords } from "../lib/geo";
import {
  DISPLAY_STATUS_ORDER,
  STATUS_LABEL,
  canDeleteReport,
  effectiveStatus,
  statusBadgeClass,
} from "../lib/reportStatus";
import type {
  DisplayStatus,
  ReportStatus,
  ReportStatusHistory,
  Role,
} from "../lib/types";

interface ReporterInfo {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

interface ReportRow {
  id: string;
  user_id: string;
  category_id: string | null;
  photo_url: string;
  description: string;
  status: ReportStatus;
  created_at: string;
  updated_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  geo_captured_at: string | null;
  sla_option_id: string | null;
  sla_due_at: string | null;
  completion_note: string | null;
  completion_photo_url: string | null;
  pending_verification: boolean;
  verified_at: string | null;
  category: { id: string; name: string } | null;
  sla_option: { id: string; label: string; hours: number } | null;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function reporterLabel(p: ReporterInfo | null): string {
  if (!p) return "Sistem";
  if (p.full_name && p.email) return `${p.full_name} (${p.email})`;
  return p.full_name || p.email || p.username || "Pengguna";
}

const SELECT_COLUMNS = `
  id, user_id, category_id, photo_url, description, status,
  created_at, updated_at,
  latitude, longitude, accuracy_m, geo_captured_at,
  sla_option_id, sla_due_at,
  completion_note, completion_photo_url,
  pending_verification, verified_at,
  category:categories!category_id(id, name),
  sla_option:category_sla_options!sla_option_id(id, label, hours)
`;

function LaporanSaya() {
  const { session, loading, user, roles, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | DisplayStatus>("");

  const [historyTarget, setHistoryTarget] = useState<ReportRow | null>(null);
  const [history, setHistory] = useState<
    (ReportStatusHistory & { changer: ReporterInfo | null })[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    const { data, error } = await supabase
      .from("reports")
      .select(SELECT_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setListLoading(false);
    if (error) {
      console.error(error);
      setReports([]);
      return;
    }
    const rows: ReportRow[] = ((data ?? []) as unknown[]).map((raw) => {
      const r = raw as ReportRow & {
        category: ReportRow["category"] | ReportRow["category"][] | null;
        sla_option:
          | ReportRow["sla_option"]
          | ReportRow["sla_option"][]
          | null;
      };
      const norm = <T,>(x: T | T[] | null): T | null =>
        Array.isArray(x) ? (x[0] ?? null) : (x ?? null);
      return {
        ...r,
        category: norm(r.category),
        sla_option: norm(r.sla_option),
      };
    });
    setReports(rows);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    let rows = reports;
    if (statusFilter) {
      rows = rows.filter((r) => {
        const eff = effectiveStatus({
          status: r.status,
          slaDueAt: r.sla_due_at,
        });
        return eff === statusFilter;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          (r.category?.name ?? "").toLowerCase().includes(q),
      );
    }
    if (from) {
      const fromTs = new Date(from + "T00:00:00").getTime();
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= fromTs);
    }
    if (to) {
      const toTs = new Date(to + "T23:59:59").getTime();
      rows = rows.filter((r) => new Date(r.created_at).getTime() <= toTs);
    }
    return rows;
  }, [reports, search, from, to, statusFilter]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;
  if (isSuperadmin) return <Navigate to="/manajemen-laporan" replace />;

  const handleDelete = async (row: ReportRow) => {
    if (!canDeleteReport(row.status, true, roles as Role[])) {
      window.alert(
        "Laporan ini sudah diterima/diproses dan tidak dapat dihapus. Hubungi administrator jika perlu.",
      );
      return;
    }
    if (!window.confirm("Hapus laporan ini? Aksi ini tidak dapat dibatalkan."))
      return;
    setDeletingId(row.id);
    try {
      const { error } = await supabase
        .from("reports")
        .delete()
        .eq("id", row.id);
      if (error) {
        window.alert(`Gagal menghapus: ${error.message}`);
        return;
      }
      if (row.photo_url) {
        const marker = "/report-photos/";
        const idx = row.photo_url.indexOf(marker);
        if (idx >= 0) {
          const path = row.photo_url.slice(idx + marker.length);
          await supabase.storage.from("report-photos").remove([path]);
        }
      }
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  const openHistory = async (row: ReportRow) => {
    setHistoryTarget(row);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistory([]);
    const { data, error } = await supabase.rpc(
      "report_history_with_actors",
      { p_report_id: row.id },
    );
    setHistoryLoading(false);
    if (error) {
      setHistoryError(error.message);
      return;
    }
    type RpcRow = {
      history_id: string;
      history_status: ReportStatus;
      history_changed_at: string;
      history_note: string | null;
      history_changed_by: string | null;
      changer_full_name: string | null;
      changer_email: string | null;
      changer_username: string | null;
    };
    const rows = ((data ?? []) as RpcRow[]).map((r) => ({
      id: r.history_id,
      report_id: row.id,
      status: r.history_status,
      changed_by: r.history_changed_by,
      changed_at: r.history_changed_at,
      note: r.history_note,
      changer:
        r.history_changed_by !== null
          ? {
              id: r.history_changed_by,
              full_name: r.changer_full_name,
              email: r.changer_email,
              username: r.changer_username,
              avatar_url: null,
            }
          : null,
    }));
    setHistory(rows);
  };

  const resetFilters = () => {
    setSearch("");
    setFrom("");
    setTo("");
    setStatusFilter("");
  };

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
          <h1 className="page-title">Laporan Saya</h1>
        </div>

        <section className="card">
          <div className="filter-toolbar">
            <label className="field">
              <span className="field__label">Cari</span>
              <input
                type="text"
                className="field__input"
                placeholder="Cari isi atau jenis..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minHeight: "2.5rem" }}
              />
            </label>
            <label className="field">
              <span className="field__label">Status</span>
              <select
                className="field__input"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "" | DisplayStatus)
                }
                style={{ minHeight: "2.5rem" }}
              >
                <option value="">Semua</option>
                {DISPLAY_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="filter-toolbar__dates">
              <label className="field">
                <span className="field__label">Dari</span>
                <input
                  type="date"
                  className="field__input"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                />
              </label>
              <label className="field">
                <span className="field__label">Sampai</span>
                <input
                  type="date"
                  className="field__input"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                />
              </label>
            </div>
            {(search || from || to || statusFilter) && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={resetFilters}
              >
                Reset Filter
              </button>
            )}
          </div>

          <header
            className="report-list__header"
            style={{ marginTop: "0.5rem" }}
          >
            <span className="badge">{filtered.length}</span>
            <span className="muted small">
              {filtered.length === reports.length
                ? "menampilkan semua"
                : `dari ${reports.length} total`}
            </span>
          </header>

          {listLoading ? (
            <p className="muted small">Memuat...</p>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <p>
                {reports.length === 0
                  ? "Belum ada laporan. Buat laporan pertama Anda dari menu Buat Laporan."
                  : "Tidak ada laporan yang cocok dengan filter."}
              </p>
            </div>
          ) : (
            <ul className="report-list__items">
              {filtered.map((r) => {
                const eff = effectiveStatus({
                  status: r.status,
                  slaDueAt: r.sla_due_at,
                });
                const deletable = canDeleteReport(
                  r.status,
                  true,
                  roles as Role[],
                );
                return (
                  <li key={r.id} className="report-item">
                    <div className="report-item__photo">
                      <img
                        src={r.photo_url}
                        alt="Foto laporan"
                        loading="lazy"
                      />
                    </div>
                    <div className="report-item__body">
                      <p className="report-item__desc">{r.description}</p>
                      <div className="report-item__chips">
                        <span className={statusBadgeClass(eff)}>
                          {STATUS_LABEL[eff]}
                        </span>
                        {r.pending_verification && (
                          <span className="pill pill--warn">
                            Menunggu Verifikasi
                          </span>
                        )}
                        {r.category && (
                          <span className="pill">{r.category.name}</span>
                        )}
                      </div>
                      {r.sla_option && (
                        <p
                          className="muted small"
                          style={{ margin: "0.2rem 0" }}
                        >
                          <strong>SLA:</strong> {r.sla_option.label} (
                          {r.sla_option.hours} jam)
                          {r.sla_due_at &&
                            ` · jatuh tempo ${fmt(r.sla_due_at)}`}
                        </p>
                      )}
                      {r.completion_note && (
                        <p
                          className="muted small"
                          style={{ margin: "0.2rem 0" }}
                        >
                          <strong>Catatan Penyelesaian:</strong>{" "}
                          {r.completion_note}
                        </p>
                      )}
                      {r.completion_photo_url && (
                        <p
                          className="muted small"
                          style={{ margin: "0.2rem 0" }}
                        >
                          <a
                            href={r.completion_photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="link-btn"
                          >
                            Lihat Foto Bukti Penyelesaian
                          </a>
                        </p>
                      )}
                      {hasCoords(r) && (
                        <p
                          className="muted small"
                          style={{ margin: "0.2rem 0" }}
                        >
                          📍 {formatCoords(r, 5)}{" "}
                          {formatAccuracy(r.accuracy_m)}
                          {" — "}
                          <a
                            href={buildMapsUrl(r) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="link-btn"
                          >
                            Buka di Maps
                          </a>
                        </p>
                      )}
                      <div className="report-item__meta">
                        <span>{fmt(r.created_at)}</span>
                        <div className="report-item__action-row">
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => navigate(`/laporan/${r.id}`)}
                          >
                            Detail
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void openHistory(r)}
                          >
                            Riwayat
                          </button>
                          {deletable ? (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => void handleDelete(r)}
                              disabled={deletingId === r.id}
                            >
                              {deletingId === r.id ? "..." : "Hapus"}
                            </button>
                          ) : (
                            <span className="muted small">
                              tidak dapat dihapus
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {historyTarget && (
        <div className="modal-backdrop" onClick={() => setHistoryTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Riwayat Status</h2>
            <p className="muted small">
              {historyTarget.description.slice(0, 60)}
              {historyTarget.description.length > 60 ? "..." : ""}
            </p>
            {historyTarget.sla_option && (
              <p className="muted small">
                <strong>SLA:</strong> {historyTarget.sla_option.label} (
                {historyTarget.sla_option.hours} jam)
                {historyTarget.sla_due_at &&
                  ` · jatuh tempo ${fmt(historyTarget.sla_due_at)}`}
              </p>
            )}
            {historyLoading ? (
              <p className="muted small">Memuat...</p>
            ) : historyError ? (
              <div className="notice notice--warn">
                <span>
                  <strong>Riwayat gagal dimuat:</strong> {historyError}.
                  Pastikan migrasi terbaru sudah dijalankan.
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => historyTarget && void openHistory(historyTarget)}
                >
                  Coba Lagi
                </button>
              </div>
            ) : history.length === 0 ? (
              <p className="muted small">Tidak ada riwayat.</p>
            ) : (
              <ol className="timeline">
                {history.map((h) => (
                  <li key={h.id} className="timeline-item">
                    <div className="timeline-item__dot" aria-hidden />
                    <div className="timeline-item__body">
                      <span className={statusBadgeClass(h.status)}>
                        {STATUS_LABEL[h.status]}
                      </span>
                      <div className="muted small">{fmt(h.changed_at)}</div>
                      <div className="muted small">
                        oleh {reporterLabel(h.changer)}
                      </div>
                      {h.note && (
                        <div className="muted small">
                          <em>“{h.note}”</em>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="profile-actions" style={{ marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setHistoryTarget(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LaporanSaya;
