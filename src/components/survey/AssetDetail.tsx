import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  ASSET_CONDITION_LABEL,
  type AssetHistoryRow,
  type AssetRow,
  type Room,
} from "../../lib/surveyTypes";

/**
 * `/survey-aset/assets/:assetId`
 *
 * Detail satu aset + riwayat perubahan kondisinya. Read-only kecuali
 * superadmin (yang boleh ubah lewat halaman manajemen — di sini cuma
 * tombol pintas).
 */
function AssetDetail() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();
  const { assetId } = useParams<{ assetId: string }>();

  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [history, setHistory] = useState<AssetHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.enabled || !assetId) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      const aRes = await supabase
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .maybeSingle();
      if (!mounted) return;
      if (aRes.error || !aRes.data) {
        setLoading(false);
        setError(aRes.error?.message ?? "Aset tidak ditemukan.");
        return;
      }
      const a = aRes.data as AssetRow;
      setAsset(a);
      const [rRes, hRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", a.room_id).maybeSingle(),
        supabase
          .from("asset_history")
          .select("*")
          .eq("asset_id", assetId)
          .order("changed_at", { ascending: false })
          .limit(50),
      ]);
      setLoading(false);
      if (rRes.data) setRoom(rRes.data as Room);
      if (!hRes.error) setHistory((hRes.data ?? []) as AssetHistoryRow[]);
    })();
    return () => {
      mounted = false;
    };
  }, [access.enabled, assetId]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/survey-aset/rooms")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Detail Aset</h1>
        </div>

        {loading ? (
          <p className="muted small">Memuat...</p>
        ) : error ? (
          <p className="notice notice--warn">{error}</p>
        ) : asset ? (
          <>
            <section className="card">
              <h2 className="section-title">{asset.name}</h2>
              <p className="muted small" style={{ margin: 0 }}>
                <strong>Kode inventaris:</strong> {asset.code ?? "-"}
                <br />
                <strong>Ruang:</strong>{" "}
                {room
                  ? room.code
                    ? `${room.code} — ${room.name}`
                    : room.name
                  : "-"}
                <br />
                <strong>Kondisi terkini:</strong>{" "}
                {ASSET_CONDITION_LABEL[asset.current_condition]}
                {asset.notes && (
                  <>
                    <br />
                    <strong>Catatan:</strong> {asset.notes}
                  </>
                )}
              </p>
            </section>

            <section className="card">
              <h2 className="section-title">Histori Perubahan</h2>
              {history.length === 0 ? (
                <p className="muted small">Belum ada perubahan tercatat.</p>
              ) : (
                <ul className="list-rows">
                  {history.map((h) => (
                    <li key={h.id} className="list-row">
                      <div className="list-row__main">
                        <p className="list-row__title">
                          {h.previous_condition
                            ? ASSET_CONDITION_LABEL[h.previous_condition]
                            : "-"}{" "}
                          →{" "}
                          {h.new_condition
                            ? ASSET_CONDITION_LABEL[h.new_condition]
                            : "-"}
                        </p>
                        <p className="list-row__sub">
                          {new Date(h.changed_at).toLocaleString("id-ID")}
                          {h.note && <> — {h.note}</>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default AssetDetail;
