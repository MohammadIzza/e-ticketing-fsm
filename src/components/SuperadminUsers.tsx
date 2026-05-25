import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Position, ReporterType, Role } from "../lib/types";

interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  roles: Role[];
  position_id: string | null;
  position_name: string | null;
  reporter_type_id: string | null;
  reporter_type_name: string | null;
}

const GRANTABLE: Role[] = ["pimpinan", "petugas"];

function SuperadminUsers() {
  const { session, loading, isSuperadmin, user } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [reporterTypes, setReporterTypes] = useState<ReporterType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const [usersRes, posRes, rtRes] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase
        .from("positions")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("reporter_types")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);
    setBusy(false);
    if (usersRes.error) {
      setError(usersRes.error.message);
      setUsers([]);
    } else {
      setUsers((usersRes.data ?? []) as AdminUserRow[]);
    }
    if (!posRes.error) setPositions((posRes.data ?? []) as Position[]);
    if (!rtRes.error) setReporterTypes((rtRes.data ?? []) as ReporterType[]);
  }, []);

  useEffect(() => {
    if (session && isSuperadmin) void refresh();
  }, [session, isSuperadmin, refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        (u.full_name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q) ||
        (u.position_name ?? "").toLowerCase().includes(q) ||
        (u.reporter_type_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/superadmin/login" replace />;
  if (!isSuperadmin) return <Navigate to="/profile" replace />;

  const toggleRole = async (target: AdminUserRow, role: Role) => {
    const has = target.roles.includes(role);
    const key = `${target.id}:${role}`;
    setPendingKey(key);
    setError(null);
    try {
      const fn = has ? "admin_revoke_role" : "admin_grant_role";
      const { error: err } = await supabase.rpc(fn, {
        p_user_id: target.id,
        p_role: role,
      });
      if (err) {
        setError(err.message);
        return;
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === target.id
            ? {
                ...u,
                roles: (has
                  ? u.roles.filter((r) => r !== role)
                  : [...u.roles, role].sort()) as Role[],
              }
            : u,
        ),
      );
    } finally {
      setPendingKey(null);
    }
  };

  const setPosition = async (target: AdminUserRow, positionId: string) => {
    const key = `${target.id}:position`;
    setPendingKey(key);
    setError(null);
    const { error: err } = await supabase.rpc("admin_set_position", {
      p_user_id: target.id,
      p_position_id: positionId || null,
    });
    setPendingKey(null);
    if (err) {
      setError(err.message);
      return;
    }
    const matched = positions.find((p) => p.id === positionId) ?? null;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === target.id
          ? {
              ...u,
              position_id: positionId || null,
              position_name: matched?.name ?? null,
            }
          : u,
      ),
    );
  };

  const setReporterType = async (target: AdminUserRow, rtId: string) => {
    const key = `${target.id}:reporter_type`;
    setPendingKey(key);
    setError(null);
    const { error: err } = await supabase.rpc("admin_set_reporter_type", {
      p_user_id: target.id,
      p_reporter_type_id: rtId || null,
    });
    setPendingKey(null);
    if (err) {
      setError(err.message);
      return;
    }
    const matched = reporterTypes.find((p) => p.id === rtId) ?? null;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === target.id
          ? {
              ...u,
              reporter_type_id: rtId || null,
              reporter_type_name: matched?.name ?? null,
            }
          : u,
      ),
    );
  };

  const renderRoleChips = (row: AdminUserRow) =>
    row.roles.map((r) => (
      <span key={r} className={`pill pill--role pill--role-${r}`}>
        {r}
      </span>
    ));

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/superadmin")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Manajemen Pengguna</h1>
        </div>

        <section className="card">
          <p className="section-desc">
            Atur role tambahan, jabatan (untuk pimpinan), dan jenis pelapor.
            Role superadmin tidak dapat diubah dari sini.
          </p>

          <label className="field" style={{ marginBottom: "0.85rem" }}>
            <span className="field__label">Cari</span>
            <input
              type="text"
              className="field__input"
              placeholder="Cari nama, email, username, jabatan, jenis..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: "2.5rem" }}
            />
          </label>

          {error && <p className="notice notice--warn">{error}</p>}

          {busy && users.length === 0 ? (
            <p className="muted small">Memuat...</p>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <p>
                {users.length === 0
                  ? "Belum ada user terdaftar."
                  : "Tidak ada user yang cocok dengan pencarian."}
              </p>
            </div>
          ) : (
            <ul className="user-list">
              {filtered.map((u) => {
                const isSelf = u.id === user?.id;
                const isPimpinan = u.roles.includes("pimpinan");
                return (
                  <li key={u.id} className="user-row">
                    <div className="user-row__main">
                      <div className="user-row__name">
                        {u.full_name || "(tanpa nama)"}
                        {isSelf && (
                          <span className="muted small"> · (Anda)</span>
                        )}
                      </div>
                      <div className="user-row__meta">
                        {u.email || u.username || "-"}
                      </div>
                      <div className="user-row__chips">
                        {u.roles.length > 0 ? (
                          renderRoleChips(u)
                        ) : (
                          <span className="muted small">tanpa role</span>
                        )}
                        {u.position_name && (
                          <span className="pill pill--accent">
                            {u.position_name}
                          </span>
                        )}
                        {u.reporter_type_name && (
                          <span className="pill">
                            {u.reporter_type_name}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "0.5rem",
                          marginTop: "0.5rem",
                        }}
                      >
                        {isPimpinan && (
                          <label className="field">
                            <span className="field__label">Jabatan</span>
                            <select
                              className="field__input"
                              value={u.position_id ?? ""}
                              onChange={(e) =>
                                void setPosition(u, e.target.value)
                              }
                              disabled={
                                pendingKey === `${u.id}:position` ||
                                positions.length === 0
                              }
                              style={{ minHeight: "2.5rem" }}
                            >
                              <option value="">— Tidak ada —</option>
                              {positions.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="field">
                          <span className="field__label">Jenis Pelapor</span>
                          <select
                            className="field__input"
                            value={u.reporter_type_id ?? ""}
                            onChange={(e) =>
                              void setReporterType(u, e.target.value)
                            }
                            disabled={
                              pendingKey === `${u.id}:reporter_type` ||
                              reporterTypes.length === 0
                            }
                            style={{ minHeight: "2.5rem" }}
                          >
                            <option value="">— Tidak ada —</option>
                            {reporterTypes.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                    <div className="user-row__actions">
                      {GRANTABLE.map((role) => {
                        const has = u.roles.includes(role);
                        const key = `${u.id}:${role}`;
                        const pending = pendingKey === key;
                        return (
                          <button
                            key={role}
                            type="button"
                            className={`btn btn--sm ${has ? "" : "btn--ghost"}`}
                            onClick={() => void toggleRole(u, role)}
                            disabled={pending}
                            title={
                              has ? `Cabut role ${role}` : `Beri role ${role}`
                            }
                          >
                            {pending
                              ? "..."
                              : has
                                ? `✓ ${role}`
                                : `+ ${role}`}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export default SuperadminUsers;
