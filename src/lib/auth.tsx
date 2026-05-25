import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile, Role } from "./types";

interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: Role[];
  isSuperadmin: boolean;
  loading: boolean;
  profileLoading: boolean;
  /** True ketika supabase-js mendeteksi session dari link reset password. */
  recoveryMode: boolean;
  refreshProfile: () => Promise<void>;
  signInWithEmail: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signInSuperadmin: (
    username: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUp: (input: SignUpInput) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateMyProfile: (input: {
    fullName?: string | null;
    avatarUrl?: string | null;
    waNumber?: string | null;
    notificationPrefs?: import("./types").NotificationPrefs | null;
  }) => Promise<{ error: string | null }>;
  uploadAvatar: (
    file: File | Blob,
  ) => Promise<{ url: string | null; error: string | null }>;
  /** Kirim email reset password ke email user yang sedang login. */
  requestPasswordReset: () => Promise<{ error: string | null }>;
  /** Kirim email reset password untuk email arbitrary (dipakai /forgot-password). */
  sendPasswordResetTo: (email: string) => Promise<{ error: string | null }>;
  /** Set password baru (dipakai pada halaman /reset-password setelah recovery session aktif). */
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const userId = session?.user.id ?? null;
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

  const loadProfileAndRoles = useCallback(async (uid: string) => {
    setProfileLoading(true);
    try {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);

      if (userIdRef.current !== uid) return; // session changed mid-flight

      if (profileRes.error) {
        console.error("Failed to load profile:", profileRes.error);
        setProfile(null);
      } else {
        setProfile((profileRes.data as Profile | null) ?? null);
      }

      if (rolesRes.error) {
        console.error("Failed to load roles:", rolesRes.error);
        setRoles([]);
      } else {
        const list = (rolesRes.data ?? [])
          .map((r) => r.role as Role)
          .filter(Boolean);
        setRoles(list);
      }
    } finally {
      if (userIdRef.current === uid) setProfileLoading(false);
    }
  }, []);

  // Initial session + listen for changes.
  useEffect(() => {
    let mounted = true;

    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session ?? null);
        if (data.session) {
          await loadProfileAndRoles(data.session.user.id);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((evt, sess) => {
      if (evt === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
      } else if (evt === "SIGNED_OUT") {
        setRecoveryMode(false);
      }
      setSession(sess ?? null);
      if (sess) {
        void loadProfileAndRoles(sess.user.id);
      } else {
        setProfile(null);
        setRoles([]);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileAndRoles]);

  const refreshProfile = useCallback(async () => {
    if (!userIdRef.current) return;
    await loadProfileAndRoles(userIdRef.current);
  }, [loadProfileAndRoles]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        // Supabase mengembalikan "Email not confirmed" kalau project
        // mengaktifkan email confirmation. Translate ke pesan yang jelas.
        const msg = error.message || "";
        if (/not\s*confirm/i.test(msg) || /belum\s*verif/i.test(msg)) {
          return {
            error:
              "Email belum diverifikasi. Silakan cek email konfirmasi Anda lalu login ulang.",
          };
        }
        return { error: msg };
      }
      // Defensive check: kalau project tidak mensyaratkan confirmation
      // tapi kita tetap ingin tolak user yang belum verifikasi, signOut + error.
      if (data.user && !data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        return {
          error:
            "Email belum diverifikasi. Silakan cek email konfirmasi Anda lalu login ulang.",
        };
      }
      return { error: null };
    },
    [],
  );

  const signInSuperadmin = useCallback(
    async (username: string, password: string) => {
      const cleanUsername = username.trim().toLowerCase();
      if (!cleanUsername) {
        return { error: "Username wajib diisi." };
      }

      const { data: email, error: rpcError } = await supabase.rpc(
        "find_email_by_username",
        { p_username: cleanUsername },
      );
      if (rpcError) {
        return { error: rpcError.message };
      }
      if (!email) {
        return { error: "Username atau password salah." };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email as string,
        password,
      });
      if (error) {
        return { error: "Username atau password salah." };
      }

      // Verify role: must include 'superadmin'. Otherwise reject (and sign out).
      const uid = data.user?.id;
      if (!uid) return { error: "Login gagal." };

      const { data: roleRows, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);

      if (roleErr) {
        await supabase.auth.signOut();
        return { error: roleErr.message };
      }

      const userRoles = (roleRows ?? []).map((r) => r.role as Role);
      if (!userRoles.includes("superadmin")) {
        await supabase.auth.signOut();
        return { error: "Akun ini bukan superadmin." };
      }

      return { error: null };
    },
    [],
  );

  const signUp = useCallback(
    async ({ email, password, fullName }: SignUpInput) => {
      const cleanEmail = email.trim();
      const cleanFullName = fullName.trim();

      if (!cleanEmail) return { error: "Email wajib diisi." };
      if (password.length < 6) {
        return { error: "Password minimal 6 karakter." };
      }
      if (!cleanFullName) return { error: "Nama wajib diisi." };

      // Pre-check via RPC email_exists (SECURITY DEFINER, baca auth.users).
      // Lebih reliable daripada bergantung ke pattern user.identities yang
      // kadang tidak konsisten lintas versi supabase-js.
      const exists = await supabase.rpc("email_exists", {
        p_email: cleanEmail,
      });
      if (!exists.error && exists.data === true) {
        return { error: "EMAIL_ALREADY_REGISTERED" };
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanFullName,
          },
        },
      });
      if (error) {
        const lower = (error.message || "").toLowerCase();
        if (
          lower.includes("already") ||
          lower.includes("registered") ||
          lower.includes("exists") ||
          lower.includes("duplicate")
        ) {
          return { error: "EMAIL_ALREADY_REGISTERED" };
        }
        return { error: error.message };
      }
      // Backup detection: Supabase, untuk mencegah email enumeration,
      // bisa mengembalikan success ketika email sudah terdaftar — bedanya
      // `user.identities` jadi kosong / undefined.
      const identities = data.user?.identities;
      if (data.user && (!identities || identities.length === 0)) {
        return { error: "EMAIL_ALREADY_REGISTERED" };
      }
      return { error: null };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRoles([]);
  }, []);

  const updateMyProfile = useCallback<AuthContextValue["updateMyProfile"]>(
    async ({ fullName, avatarUrl, waNumber, notificationPrefs }) => {
      const { error } = await supabase.rpc("update_my_profile", {
        p_full_name: fullName === undefined ? null : fullName,
        p_avatar_url: avatarUrl === undefined ? null : avatarUrl,
        p_wa_number: waNumber === undefined ? null : waNumber,
        p_notification_prefs:
          notificationPrefs === undefined ? null : notificationPrefs,
      });
      if (error) return { error: error.message };
      await refreshProfile();
      return { error: null };
    },
    [refreshProfile],
  );

  const uploadAvatar = useCallback<AuthContextValue["uploadAvatar"]>(
    async (file) => {
      const uid = userIdRef.current;
      if (!uid) return { url: null, error: "Tidak ada sesi aktif." };
      const ts = Date.now();
      const ext =
        file instanceof File && file.name.includes(".")
          ? (file.name.split(".").pop() ?? "jpg").toLowerCase()
          : "jpg";
      const path = `avatars/${uid}/${ts}.${ext}`;
      const contentType =
        (file as Blob).type && (file as Blob).type !== ""
          ? (file as Blob).type
          : "image/jpeg";

      const { error } = await supabase.storage
        .from("profile-avatars")
        .upload(path, file, {
          cacheControl: "3600",
          contentType,
          upsert: false,
        });
      if (error) return { url: null, error: error.message };

      const { data } = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(path);
      return { url: data.publicUrl, error: null };
    },
    [],
  );

  const requestPasswordReset = useCallback<
    AuthContextValue["requestPasswordReset"]
  >(async () => {
    const email = session?.user?.email;
    if (!email) return { error: "Tidak ada sesi aktif." };
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) return { error: error.message };
    return { error: null };
  }, [session?.user?.email]);

  const sendPasswordResetTo = useCallback<
    AuthContextValue["sendPasswordResetTo"]
  >(async (email) => {
    const cleanEmail = email.trim();
    if (!cleanEmail) return { error: "Email wajib diisi." };
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const updatePassword = useCallback<AuthContextValue["updatePassword"]>(
    async (newPassword) => {
      if (newPassword.length < 6) {
        return { error: "Password minimal 6 karakter." };
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) return { error: error.message };
      // Setelah set password berhasil, recovery flag tidak perlu lagi.
      setRecoveryMode(false);
      return { error: null };
    },
    [],
  );

  const value = useMemo<AuthContextValue>(() => {
    return {
      session,
      user: session?.user ?? null,
      profile,
      roles,
      isSuperadmin: roles.includes("superadmin"),
      loading,
      profileLoading,
      recoveryMode,
      refreshProfile,
      signInWithEmail,
      signInSuperadmin,
      signUp,
      signOut,
      updateMyProfile,
      uploadAvatar,
      requestPasswordReset,
      sendPasswordResetTo,
      updatePassword,
    };
  }, [
    session,
    profile,
    roles,
    loading,
    profileLoading,
    recoveryMode,
    refreshProfile,
    signInWithEmail,
    signInSuperadmin,
    signUp,
    signOut,
    updateMyProfile,
    uploadAvatar,
    requestPasswordReset,
    sendPasswordResetTo,
    updatePassword,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
