import { useEffect, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useLocation } from 'react-router-dom';
import { useAuth, useToast } from '../context.jsx';
import { TOURS } from '../../../shared/help/tours.js';

const onScreen = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
};
const pathOf = (id) => TOURS[id]?.path;
const forPath = (pathname) => Object.keys(TOURS).find((id) => pathOf(id) && (pathname === pathOf(id) || pathname.startsWith(pathOf(id) + '/'))) || 'main';

/** Interactive tour (Driver.js). Steps come from shared/help/tours.js and attach to data-tour="..." markers; hidden targets are skipped. */
export default function ProductTour() {
  const { user, markTour } = useAuth();
  const toast = useToast();
  const loc = useLocation();
  const live = useRef(null);
  const tried = useRef(new Set());
  const latest = useRef({});
  latest.current = { user, markTour, toast, pathname: loc.pathname };

  const start = (id, manual) => {
    const tour = TOURS[id];
    if (!tour || live.current) return;
    const steps = tour.steps
      .map((s) => ({ el: document.querySelector(`[data-tour="${s.target}"]`), s }))
      .filter((x) => onScreen(x.el))
      .map(({ el, s }) => ({ element: el, popover: { title: s.title, description: s.text } }));
    if (!steps.length) { if (manual) latest.current.toast?.('Nothing to show on this screen yet.'); return; }
    const d = driver({
      showProgress: true, allowClose: true, overlayOpacity: 0.55, stagePadding: 6, popoverClass: 'erp-tour',
      nextBtnText: 'Next', prevBtnText: 'Back', doneBtnText: 'Done', progressText: '{{current}} of {{total}}',
      steps,
      onDestroyed: () => { live.current = null; latest.current.markTour?.(id).catch(() => {}); },
    });
    live.current = d;
    d.drive();
  };

  useEffect(() => {
    const h = (e) => start(forPath(latest.current.pathname), !!e.detail?.manual);
    window.addEventListener('erp:tour', h);
    return () => { window.removeEventListener('erp:tour', h); live.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First visit: play the welcome tour once, then each page tour the first time that page opens.
  useEffect(() => {
    if (!user || user.portal) return undefined;
    const seen = user.tour_seen || {};
    const mainId = 'main';
    const pageId = forPath(loc.pathname);
    const id = TOURS[mainId].version > (seen[mainId] || 0) ? mainId : pageId;
    const t = TOURS[id];
    if (!t?.autostart || (seen[id] || 0) >= t.version || tried.current.has(id)) return undefined;
    const timer = setTimeout(() => { tried.current.add(id); start(id, false); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loc.pathname, user?.tour_seen?.main]);

  return null;
}
