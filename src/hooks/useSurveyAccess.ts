import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

interface State {
  loading: boolean;
  /** True kalau user boleh masuk ke modul Survey Aset. */
  enabled: boolean;
  /** True kalau user adalah superadmin (akses penuh). */
  isSuperadmin: boolean;
  /** Salah satu role petugas/pimpinan/superadmin (untuk gate sub-menu). */
  role: "superadmin" | "pimpinan" | "petugas" | "lainnya";
}

const INITIAL: State = {
  loading: true,
  enabled: false,
  isSuperadmin: false,
  role: "lainnya",
};

/**
 * Hook minimal yang menentukan apakah user diberi izin oleh superadmin
 * untuk masuk modul Survey Aset, plus role efektifnya untuk gating
 * sub-menu (Petugas/Pimpinan punya tombol berbeda di dalam modul).
 *
 * Sumber data:
 *   - useAuth().roles → cek superadmin/pimpinan/petugas
 *   - SELECT survey_module_access where user_id = me → cek izin
 *
 * RLS sudah membatasi SELECT pada survey_module_access ke baris milik
 * user atau superadmin, jadi query ini aman dipanggil oleh siapapun
 * yang sudah login.
 */
export function useSurveyAccess(): State {
  const { user, roles, isSuperadmin, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (authLoading) {
      setState(INITIAL);
      return;
    }
    if (!user) {
      setState({ ...INITIAL, loading: false });
      return;
    }

    let mounted = true;
    const role: State["role"] = isSuperadmin
      ? "superadmin"
      : roles.includes("pimpinan")
        ? "pimpinan"
        : roles.includes("petugas")
          ? "petugas"
          : "lainnya";

    if (isSuperadmin) {
      // Superadmin selalu boleh.
      setState({ loading: false, enabled: true, isSuperadmin: true, role });
      return;
    }

    setState((s) => ({ ...s, loading: true }));
    supabase
      .from("survey_module_access")
      .select("enabled")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.warn("useSurveyAccess: gagal cek akses:", error.message);
          setState({
            loading: false,
            enabled: false,
            isSuperadmin: false,
            role,
          });
          return;
        }
        setState({
          loading: false,
          enabled: !!data?.enabled,
          isSuperadmin: false,
          role,
        });
      });
    return () => {
      mounted = false;
    };
  }, [authLoading, user, roles, isSuperadmin]);

  return state;
}
