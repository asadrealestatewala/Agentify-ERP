// Thin shell: the public website, sign-in/sign-up pages, the console and the meeting room load on their own. The workspace itself
// (dozens of screens) is a separate chunk that only signed-in users download, so the first visit stays small and quick.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loading } from './components/ui.jsx';
import { Drawn, FirstView, loadSiteInfo, marketingChunk } from './firstView.jsx';
import { useAuth } from './context.jsx';
import { inNativeApp } from './installApp.js';
import StaffGate from './pages/StaffGate.jsx';
import Login from './pages/Login.jsx';
import { AcceptInvite, ForgotPassword, ResetPassword, Signup, VerifyEmail } from './pages/AuthPages.jsx';
const MarketingSite = lazy(() => marketingChunk || import('./marketing/Marketing.jsx'));
const PlatformConsole = lazy(() => import('./pages/PlatformConsole.jsx'));
const MeetingRoom = lazy(() => import('./meet/MeetingRoom.jsx'));
const SiteApp = lazy(() => import('./site/SiteApp.jsx'));
const WorkspaceApp = lazy(() => import('./WorkspaceApp.jsx'));

/**
 * Main domain (multi-tenant mode): the public website. On a workspace address, or in a single-company install, the same
 * paths keep their old meaning ("/" goes to the company's own /site, /login and /signup are the workspace pages).
 */
// Home-screen icon on iPhone/Android opens "/"; signed-out installed apps go to the login page, never the public site.
const installedApp = () => window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches || new URLSearchParams(window.location.search).get('source') === 'pwa';
// Keep the installable manifest pointed at the login page being viewed (portals included).
function useManifestStart(pathname) {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const start = ['/login', '/portal/login', '/vendor/login', '/developer/login'].includes(pathname) ? pathname : '';
    link.setAttribute('href', start ? `/manifest.webmanifest?start=${encodeURIComponent(start)}` : '/manifest.webmanifest');
  }, [pathname]);
}

// the answer is kept for the whole visit, so moving between public pages never shows a loading screen again
let siteKnown = null;
function MainGate({ fallback }) {
  const [info, setInfo] = useState(siteKnown);
  useEffect(() => { if (!info) loadSiteInfo().then((v) => { siteKnown = v; setInfo(v); }); }, [info]);
  if (!info) return <FirstView />;
  return info.landing ? <Suspense fallback={<FirstView />}><MarketingSite /></Suspense> : <Drawn>{fallback}</Drawn>;
}

export default function App() {
  const { user } = useAuth();
  const loc = useLocation();
  useManifestStart(loc.pathname);
  if (loc.pathname.startsWith('/meet/')) return <Suspense fallback={<Loading />}><Routes><Route path="/meet/:code" element={<MeetingRoom />} /></Routes></Suspense>;
  if (loc.pathname === '/site' || loc.pathname.startsWith('/site/')) return <Suspense fallback={<Loading />}><Routes><Route path="/site/*" element={<SiteApp />} /></Routes></Suspense>;
  if (loc.pathname.startsWith('/verify-email/')) return <Routes><Route path="/verify-email/:token" element={<VerifyEmail />} /></Routes>;
  if (loc.pathname === '/platform' || loc.pathname.startsWith('/platform/')) return <Suspense fallback={<Loading />}><Routes><Route path="/platform/*" element={<PlatformConsole />} /></Routes></Suspense>;
  if (user === undefined) return <FirstView />;

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<MainGate fallback={<Navigate to={inNativeApp() || installedApp() ? '/login' : '/site'} replace />} />} />
        {['/real-estate', '/construction', '/preview', '/pricing', '/contact', '/delete-account', '/download-app', '/legal/:slug', '/blog', '/blog/:slug'].map((p) => <Route key={p} path={p} element={<MainGate fallback={<Navigate to="/login" replace />} />} />)}
        <Route path="/portal/login" element={<Login portal />} />
        <Route path="/vendor/login" element={<Login portal vendor />} />
        <Route path="/developer/login" element={<Login portal developer />} />
        <Route path="/login" element={<MainGate fallback={<Login />} />} />
        <Route path="/signup" element={<MainGate fallback={<Signup />} />} />
        <Route path="/forgot-password" element={<MainGate fallback={<ForgotPassword />} />} />
        <Route path="/reset-password/:token" element={<MainGate fallback={<ResetPassword />} />} />
        <Route path="/invite/:token" element={<MainGate fallback={<AcceptInvite />} />} />
        <Route path="/:slug" element={<StaffGate />} />
        <Route path="*" element={<Navigate to={loc.pathname.startsWith('/portal') ? `/portal/login?next=${encodeURIComponent(loc.pathname)}` : loc.pathname.startsWith('/vendor') ? `/vendor/login?next=${encodeURIComponent(loc.pathname)}` : loc.pathname.startsWith('/developer') ? `/developer/login?next=${encodeURIComponent(loc.pathname)}` : '/login'} replace />} />
      </Routes>
    );
  }
  return <Suspense fallback={<Loading />}><Drawn><WorkspaceApp /></Drawn></Suspense>;
}
