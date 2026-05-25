import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import {
  DEFAULT_PERIOD,
  describePeriod,
  displayName,
  fetchPetugasMonitoring,
  MONTH_LABELS,
  periodToRange,
  sortPetugas,
  type PeriodFilter,
  type PeriodKind,
  type PetugasOverview,
  type PetugasSortKey,
  type PetugasWorkStatus,
} from "../../lib/petugasMonitoring";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/petugas` — Monitoring Petugas (re-introduce dari PR #49).
 *
 * Filter:
 *   - Status     : semua / sedang bekerja / tidak bekerja
 *   - Sort       : pekerjaan terbanyak / paling aktif / nama
 *   - Periode    : Semua waktu / Bulan / Semester / Tahun
 *                  (Item #4 PR-C — dropdown ringkasan pekerjaan)
 *   - Search     : nama / email
 *
 * Akses: superadmin atau pimpinan dengan akses Survey Aset.
 */
function PetugasMonitoring() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();

  const [period, setPeriod] = useState<PeriodFilter>(DEFAULT_PERIOD);
  const [statusFilter, setStatusFilter] = useState<"all" | PetugasWorkStatus>(
    "all",
  );
  const [sortKey, setSortKey] = useState<PetugasSortKey>("total_desc");
  const [rows, setRows] = useState<PetugasOverview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => periodToRange(period), [period]);

  useEffect(() => {
    if (!access.enabled) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchPetugasMonitoring({ range })
      .then((data) => {
        if (mounted) setRows(data);
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Gagal memuat data.");
          setRows([]);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [access.enabled, range]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    const working = list.filter((r) => r.status === "working").length;
    const idle = list.length - working;
    const totalWork = list.reduce((sum, r) => sum + r.total, 0);
    return { total: list.length, working, idle, totalWork };
  }, [rows]);

  const filteredAndSorted = useMemo(() => {
    if (!rows) return [];
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter((r) => r.status === statusFilter);
    return sortPetugas(filtered, sortKey);
  }, [rows, statusFilter, sortKey]);

  const ls = useListState(filteredAndSorted, (r, q) =>
    `${r.petugas.full_name ?? ""} ${r.petugas.email ?? ""} ${
      r.petugas.username ?? ""
    }`
      .toLowerCase()
      .includes(q),
  );

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;
  if (
    access.role !== "pimpinan" &&
    access.role !== "petugas" &&
    !access.isSuperadmin
  ) {
    // Petugas tidak boleh lihat halaman ini — back ke survey home.
    return <Navigate to="/survey-aset" replace />;
  }
  // Petugas (selain superadmin) tidak boleh lihat monitoring petugas lain.
  if (access.role === "petugas" && !access.isSuperadmin) {
    return <Navigate to="/survey-aset" replace />;
  }

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              navigate(access.isSuperadmin ? "/superadmin" : "/dashboard")
            }
          >
            ← Kembali
          </button>
          <h1 className="page-title">Monitoring Petugas</h1>
        </div>

        <section className="card">
          <div className="summary-grid" aria-label="Ringkasan petugas">
            <div className="summary-tile">
              <span className="summary-tile__value">{summary.total}</span>
              <span className="summary-tile__label">Total Petugas</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__value">{summary.working}</span>
              <span className="summary-tile__label">Sedang Bekerja</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__value">{summary.idle}</span>
              <span className="summary-tile__label">Tidak Bekerja</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__value">{summary.totalWork}</span>
              <span className="summary-tile__label">
                Pekerjaan ({describePeriod(period)})
              </span>
            </div>
          </div>
        </section>

        <PeriodPicker value={period} onChange={setPeriod} />

        <section className="card">
          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari nama / email petugas..."
          >
            <select
              className="list-toolbar__select"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as "all" | PetugasWorkStatus,
                )
              }
              aria-label="Filter status kerja"
            >
              <option value="all">Semua Status</option>
              <option value="working">Sedang Bekerja</option>
              <option value="idle">Tidak Bekerja</option>
            </select>
            <select
              className="list-toolbar__select"
              value={sortKey}
              onChange={(e) =>
                setSortKey(e.target.value as PetugasSortKey)
              }
              aria-label="Urutkan"
            >
              <option value="total_desc">Pekerjaan Terbanyak</option>
              <option value="active_desc">Paling Aktif Sekarang</option>
              <option value="name_asc">Nama (A–Z)</option>
            </select>
          </ListToolbar>

          {loading ? (
            <p className="muted small">Memuat...</p>
          ) : error ? (
            <p className="notice notice--warn">{error}</p>
          ) : ls.total === 0 ? (
            <p className="muted small">
              Tidak ada petugas yang cocok dengan filter saat ini.
            </p>
          ) : (
            <ul className="list-rows">
              {ls.page.map((r) => (
                <li key={r.petugas.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">
                      {displayName(r.petugas)}{" "}
                      <span
                        className={`pill ${
                          r.status === "working" ? "pill--ok" : "pill--warn"
                        }`}
                      >
                        {r.status === "working"
                          ? "Sedang Bekerja"
                          : "Tidak Bekerja"}
                      </span>
                    </p>
                    <p className="list-row__sub">
                      {r.petugas.email ?? "-"} · {r.total} pekerjaan ·{" "}
                      {r.active} aktif sekarang
                    </p>
                  </div>
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        navigate(`/survey-aset/petugas/${r.petugas.id}`)
                      }
                    >
                      Detail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager state={ls} />
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* PeriodPicker — dropdown rentang waktu (Item #4 PR-C)                       */
/* ------------------------------------------------------------------------- */

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const YEAR_OPTIONS = Array.from(
  { length: 6 },
  (_, i) => CURRENT_YEAR - 4 + i,
);

function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodFilter;
  onChange: (p: PeriodFilter) => void;
}) {
  const setKind = (kind: PeriodKind) => {
    if (kind === "all") {
      onChange({ kind: "all", year: CURRENT_YEAR });
      return;
    }
    if (kind === "year") {
      onChange({ kind: "year", year: value.year ?? CURRENT_YEAR });
      return;
    }
    if (kind === "semester") {
      onChange({
        kind: "semester",
        year: value.year ?? CURRENT_YEAR,
        semester: value.semester ?? (NOW.getMonth() < 6 ? 1 : 2),
      });
      return;
    }
    onChange({
      kind: "month",
      year: value.year ?? CURRENT_YEAR,
      month: value.month ?? NOW.getMonth() + 1,
    });
  };

  return (
    <section className="card" aria-label="Filter periode">
      <div className="profile-section">
        <h3 className="profile-section__title">Rentang Waktu</h3>
        <p className="muted small" style={{ margin: "0 0 0.5rem 0" }}>
          Filter ringkasan pekerjaan berdasarkan periode. Status "sedang
          bekerja" tetap dihitung berdasarkan kondisi saat ini, bukan
          periode.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "flex-end",
          }}
        >
          <label className="field" style={{ flex: "0 1 10rem", margin: 0 }}>
            <span className="field__label">Periode</span>
            <select
              className="field__input"
              value={value.kind}
              onChange={(e) => setKind(e.target.value as PeriodKind)}
              style={{ minHeight: "2.5rem" }}
            >
              <option value="all">Semua Waktu</option>
              <option value="month">Bulan</option>
              <option value="semester">Semester</option>
              <option value="year">Tahun</option>
            </select>
          </label>

          {value.kind !== "all" && (
            <label className="field" style={{ flex: "0 1 7rem", margin: 0 }}>
              <span className="field__label">Tahun</span>
              <select
                className="field__input"
                value={value.year}
                onChange={(e) =>
                  onChange({ ...value, year: Number(e.target.value) })
                }
                style={{ minHeight: "2.5rem" }}
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          )}

          {value.kind === "month" && (
            <label className="field" style={{ flex: "0 1 8rem", margin: 0 }}>
              <span className="field__label">Bulan</span>
              <select
                className="field__input"
                value={value.month ?? NOW.getMonth() + 1}
                onChange={(e) =>
                  onChange({ ...value, month: Number(e.target.value) })
                }
                style={{ minHeight: "2.5rem" }}
              >
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}

          {value.kind === "semester" && (
            <label className="field" style={{ flex: "0 1 9rem", margin: 0 }}>
              <span className="field__label">Semester</span>
              <select
                className="field__input"
                value={value.semester ?? 1}
                onChange={(e) =>
                  onChange({
                    ...value,
                    semester: Number(e.target.value) as 1 | 2,
                  })
                }
                style={{ minHeight: "2.5rem" }}
              >
                <option value={1}>Sem 1 (Jan–Jun)</option>
                <option value={2}>Sem 2 (Jul–Des)</option>
              </select>
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

export default PetugasMonitoring;
