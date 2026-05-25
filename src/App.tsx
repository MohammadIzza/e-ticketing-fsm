import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AuthProvider, useAuth } from "./lib/auth";
import { supabaseConfigError } from "./lib/supabase";
import { useOnline } from "./hooks/useOnline";
import { useReportNotifications } from "./hooks/useReportNotifications";
import { unlockAudio } from "./lib/notifications";
import ConfigError from "./components/ConfigError";
import OfflineScreen from "./components/OfflineScreen";
import InAppNotificationToast from "./components/InAppNotificationToast";
import SuperadminLogin from "./components/SuperadminLogin";
import SuperadminProfile from "./components/SuperadminProfile";
import SuperadminUsers from "./components/SuperadminUsers";
import SuperadminCategories from "./components/SuperadminCategories";
import SuperadminPositions from "./components/SuperadminPositions";
import SuperadminReporterTypes from "./components/SuperadminReporterTypes";
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import Dashboard from "./components/Dashboard";
import Profile from "./components/Profile";
import ChangePassword from "./components/ChangePassword";
import ContactAdmin from "./components/ContactAdmin";
import ResetPassword from "./components/ResetPassword";
import SsoRedirect from "./components/SsoRedirect";
import Laporan from "./components/Laporan";
import LaporanSaya from "./components/LaporanSaya";
import LaporanManagement from "./components/LaporanManagement";
import ReportDetail from "./components/ReportDetail";
import SurveyHome from "./components/survey/SurveyHome";
import SurveyPlanning from "./components/survey/SurveyPlanning";
import SurveyDo from "./components/survey/SurveyDo";
import SurveyCheck from "./components/survey/SurveyCheck";
import RoomList from "./components/survey/RoomList";
import AssetDetail from "./components/survey/AssetDetail";
import SurveyManagement from "./components/survey/SurveyManagement";
import SurveyHistory from "./components/survey/SurveyHistory";
import PetugasMonitoring from "./components/survey/PetugasMonitoring";
import PetugasDetail from "./components/survey/PetugasDetail";
import KinerjaConfig from "./components/kinerja/KinerjaConfig";
import KinerjaHome from "./components/kinerja/KinerjaHome";
import KinerjaSubmissionEditor from "./components/kinerja/KinerjaSubmissionEditor";
import KinerjaAssignmentEditor from "./components/kinerja/KinerjaAssignmentEditor";
import "./App.css";

/** Root index route — redirect berdasarkan session + role. */
function IndexRedirect() {
  const { loading, session, isSuperadmin, recoveryMode } = useAuth();
  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (recoveryMode) return <Navigate to="/reset-password" replace />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={isSuperadmin ? "/superadmin" : "/dashboard"} replace />;
}

/** Subscribe ke realtime notifikasi laporan saat user sudah login. */
function NotificationManager() {
  const { user, profile } = useAuth();
  useReportNotifications(user?.id ?? null, profile?.notification_prefs ?? null);
  return null;
}

/**
 * "Unlock" Web Audio API pada interaksi pertama (klik / keypress) di
 * dokumen. Browser modern (Chrome/Edge/Safari) menonaktifkan AudioContext
 * sampai ada user gesture; tanpa unlock ini, ringtone notifikasi tidak
 * akan berbunyi pada notifikasi pertama. One-shot listener — di-cleanup
 * setelah berhasil sekali.
 */
function AudioGestureUnlocker() {
  useEffect(() => {
    const handler = () => {
      unlockAudio();
    };
    window.addEventListener("pointerdown", handler, {
      once: true,
      passive: true,
    });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route index element={<IndexRedirect />} />
      <Route path="/superadmin/login" element={<SuperadminLogin />} />
      <Route path="/superadmin/users" element={<SuperadminUsers />} />
      <Route
        path="/superadmin/categories"
        element={<SuperadminCategories />}
      />
      <Route
        path="/superadmin/positions"
        element={<SuperadminPositions />}
      />
      <Route
        path="/superadmin/reporter-types"
        element={<SuperadminReporterTypes />}
      />
      <Route path="/superadmin/kinerja" element={<KinerjaConfig />} />
      <Route path="/kinerja" element={<KinerjaHome />} />
      <Route
        path="/kinerja/submission/new"
        element={<KinerjaSubmissionEditor />}
      />
      <Route
        path="/kinerja/submission/:id"
        element={<KinerjaSubmissionEditor />}
      />
      <Route
        path="/kinerja/assignment/new"
        element={<KinerjaAssignmentEditor />}
      />
      <Route path="/superadmin/laporan" element={<LaporanManagement />} />
      <Route path="/manajemen-laporan" element={<LaporanManagement />} />
      <Route path="/superadmin" element={<SuperadminProfile />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/sso-redirect" element={<SsoRedirect />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/profile/password" element={<ChangePassword />} />
      <Route path="/profile/contact-admin" element={<ContactAdmin />} />
      <Route path="/laporan" element={<Laporan />} />
      <Route path="/laporan-saya" element={<LaporanSaya />} />
      <Route path="/laporan/:id" element={<ReportDetail />} />
      {/* ---- Modul Survey Aset (terisolasi, gated by useSurveyAccess) ---- */}
      <Route path="/survey-aset" element={<SurveyHome />} />
      <Route path="/survey-aset/planning" element={<SurveyPlanning />} />
      <Route path="/survey-aset/do" element={<SurveyDo />} />
      <Route path="/survey-aset/check" element={<SurveyCheck />} />
      <Route path="/survey-aset/rooms" element={<RoomList />} />
      <Route path="/survey-aset/assets/:assetId" element={<AssetDetail />} />
      <Route path="/survey-aset/manage" element={<SurveyManagement />} />
      <Route path="/survey-aset/history" element={<SurveyHistory />} />
      <Route path="/survey-aset/petugas" element={<PetugasMonitoring />} />
      <Route path="/survey-aset/petugas/:id" element={<PetugasDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PwaFooter() {
  const [pwaReady, setPwaReady] = useState(false);

  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      console.info("Service Worker registered:", swUrl);
    },
    onRegisterError(error) {
      console.error("Service Worker registration error:", error);
    },
  });

  useEffect(() => {
    if ("serviceWorker" in navigator) setPwaReady(true);
  }, []);

  return (
    <footer className="app__footer pwa-footer">
      <div className={`status ${pwaReady ? "status--ok" : "status--pending"}`}>
        <span className="status__dot" />
        <span>{pwaReady ? "PWA Ready" : "Checking PWA support..."}</span>
      </div>

      {offlineReady && (
        <p className="notice notice--info">Aplikasi siap digunakan offline.</p>
      )}

      {needRefresh && (
        <div className="notice notice--warn">
          <span>Versi baru tersedia.</span>
          <button
            type="button"
            className="btn"
            onClick={() => updateServiceWorker(true)}
          >
            Muat Ulang
          </button>
        </div>
      )}
    </footer>
  );
}

/** Footer hanya render pada route utama, supaya tidak ganggu auth screen. */
function PwaFooterMount() {
  const { pathname } = useLocation();
  const hideOn = [
    "/login",
    "/register",
    "/forgot-password",
    "/superadmin/login",
    "/reset-password",
    "/sso-redirect",
  ];
  if (hideOn.includes(pathname)) return null;
  return <PwaFooter />;
}

/** Block seluruh app saat offline. */
function OnlineGate({ children }: { children: React.ReactNode }) {
  const online = useOnline();
  if (!online) return <OfflineScreen />;
  return <>{children}</>;
}

function App() {
  if (supabaseConfigError) {
    return <ConfigError message={supabaseConfigError} />;
  }
  return (
    <OnlineGate>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <NotificationManager />
          <AudioGestureUnlocker />
          <InAppNotificationToast />
          <PwaFooterMount />
        </BrowserRouter>
      </AuthProvider>
    </OnlineGate>
  );
}

export default App;
