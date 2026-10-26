// Thin shell: the public website, sign-in/sign-up pages, the console and the meeting room load on their own. The workspace itself
// (dozens of screens) is a separate chunk that only signed-in users download, so the first visit stays small and quick.
import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api.js';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loading } from './components/ui.jsx';
import { useAuth } from './context.jsx';
import StaffGate from './pages/StaffGate.jsx';
import Login from './pages/Login.jsx';
import { AcceptInvite, ForgotPassword, ResetPassword, Signup, VerifyEmail } from './pages/AuthPages.jsx';
import MarketingSite from './marketing/Marketing.jsx';
const PlatformConsole = lazy(() => import('./pages/PlatformConsole.jsx'));
const MeetingRoom = lazy(() => import('./meet/MeetingRoom.jsx'));
const SiteApp = lazy(() => import('./site/SiteApp.jsx'));
const WorkspaceApp = lazy(() => import('./WorkspaceApp.jsx'));

/**
 * Main domain (multi-tenant mode): the public website. On a workspace address, or in a single-company install, the same
 * paths keep their old meaning ("/" goes to the company's own /site, /login and /signup are the workspace pages).
 */
function MainGate({ fallback }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { api.get('/api/platform/site').then(setInfo).catch(() => setInfo({ landing: false })); }, []);
  if (!info) return <Loading />;
  return info.landing ? <MarketingSite /> : fallback;
}

export default function App() {
  const { user } = useAuth();
  const loc = useLocation();
  if (loc.pathname.startsWith('/meet/')) return <Suspense fallback={<Loading />}><Routes><Route path="/meet/:code" element={<MeetingRoom />} /></Routes></Suspense>;
  if (loc.pathname === '/site' || loc.pathname.startsWith('/site/')) return <Suspense fallback={<Loading />}><Routes><Route path="/site/*" element={<SiteApp />} /></Routes></Suspense>;
  if (loc.pathname.startsWith('/verify-email/')) return <Routes><Route path="/verify-email/:token" element={<VerifyEmail />} /></Routes>;
  if (loc.pathname === '/platform' || loc.pathname.startsWith('/platform/')) return <Suspense fallback={<Loading />}><Routes><Route path="/platform/*" element={<PlatformConsole />} /></Routes></Suspense>;
  if (user === undefined) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<MainGate fallback={<Navigate to="/site" replace />} />} />
        {['/real-estate', '/construction', '/preview', '/pricing', '/contact', '/legal/:slug'].map((p) => <Route key={p} path={p} element={<MainGate fallback={<Navigate to="/login" replace />} />} />)}
        <Route path="/portal/login" element={<Login portal />} />
        <Route path="/vendor/login" element={<Login portal vendor />} />
        <Route path="/login" element={<MainGate fallback={<Login />} />} />
        <Route path="/signup" element={<MainGate fallback={<Signup />} />} />
        <Route path="/forgot-password" element={<MainGate fallback={<ForgotPassword />} />} />
        <Route path="/reset-password/:token" element={<MainGate fallback={<ResetPassword />} />} />
        <Route path="/invite/:token" element={<MainGate fallback={<AcceptInvite />} />} />
        <Route path="/:slug" element={<StaffGate />} />
        <Route path="*" element={<Navigate to={loc.pathname.startsWith('/portal') ? `/portal/login?next=${encodeURIComponent(loc.pathname)}` : loc.pathname.startsWith('/vendor') ? `/vendor/login?next=${encodeURIComponent(loc.pathname)}` : '/login'} replace />} />
      </Routes>
    );
  }
  return <Suspense fallback={<Loading />}><WorkspaceApp /></Suspense>;
}
