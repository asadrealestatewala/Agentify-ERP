// Small building blocks for the glow-dark home page: icons, scroll reveal, count-up, the cursor-reactive dot field,
// the install-app hook and the theme.
import { useCallback, useEffect, useRef, useState } from 'react';

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none), (pointer: coarse)').matches;

// ---------------------------------------------------------------- icons (one outline set, 24px grid)
const PATHS = {
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  chat: 'M4 5h16v11H9l-5 4V5z',
  chart: 'M4 20V10m6 10V4m6 16v-8m4 8H2',
  building: 'M5 21V4h9v17M14 9h5v12M8 8h3M8 12h3M8 16h3M3 21h18',
  check: 'M5 12.5l4.5 4.5L19 7',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 5a3 3 0 010 6m2.5 9a5.5 5.5 0 00-3-4.9',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  file: 'M7 3h7l5 5v13H7V3zm7 0v5h5M10 13h6M10 17h6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  video: 'M3 6h12v12H3V6zm12 4l6-3v10l-6-3',
  key: 'M14 10a4 4 0 11-1.2 2.8L4 21v-3H2v-2h3v-2h2l5.2-5.2A4 4 0 0114 10z',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11zm0-8a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  sun: 'M12 4V2m0 20v-2M4 12H2m20 0h-2M6 6L4.6 4.6M19.4 19.4L18 18M6 18l-1.4 1.4M19.4 4.6L18 6M12 17a5 5 0 100-10 5 5 0 000 10z',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z',
  play: 'M8 5l12 7-12 7V5z',
  download: 'M12 3v12m-5-5l5 5 5-5M4 21h16',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  whatsapp: 'M4 20l1.3-4.2A8 8 0 1112 20a8 8 0 01-3.8-1L4 20zm5-11c.3 2 2.4 4.6 5 5.4l1.3-1.2-1.8-1-.8.7a4 4 0 01-1.9-1.9l.7-.8-1-1.8L9 9z',
  mail: 'M3 6h18v12H3V6zm0 1l9 6 9-6',
};
export function Ico({ n, size = 22, stroke = 1.8, className = '' }) {
  return <svg className={`gx-ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[n] || PATHS.star} /></svg>;
}

// ---------------------------------------------------------------- scroll reveal (fade and rise), once
export function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const els = [...root.querySelectorAll('.gx-rv')];
    if (reducedMotion() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return undefined; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

// ---------------------------------------------------------------- numbers that count up when seen (and when they change)
export function CountUp({ to, format = (v) => Math.round(v).toLocaleString('en'), ms = 900 }) {
  const [v, setV] = useState(() => (reducedMotion() ? to : 0));
  const from = useRef(reducedMotion() ? to : 0);
  const el = useRef(null);
  const seen = useRef(false);
  const run = useCallback((target) => {
    if (reducedMotion()) { setV(target); from.current = target; return undefined; }
    const start = performance.now(), a = from.current;
    let raf;
    const tick = (t) => { const k = Math.min(1, (t - start) / ms), e = 1 - (1 - k) ** 3; const cur = a + (target - a) * e; setV(cur); from.current = cur; if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  useEffect(() => {
    if (seen.current) return run(to);
    const node = el.current;
    if (!node || !('IntersectionObserver' in window)) { seen.current = true; return run(to); }
    let stop;
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { seen.current = true; io.disconnect(); stop = run(to); } }, { threshold: 0.4 });
    io.observe(node);
    return () => { io.disconnect(); stop?.(); };
  }, [to, run]);
  return <span ref={el}>{format(v)}</span>;
}

// ---------------------------------------------------------------- the dot field: dots near the pointer light up, a click sends a ring
export function DotField() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || reducedMotion() || isTouch()) return undefined;
    const ctx = c.getContext('2d');
    const GAP = 26, R = 130;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, dirty = true;
    const mouse = { x: -999, y: -999 };
    const rings = [];
    const size = () => { const b = c.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); w = b.width; h = b.height; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); dirty = true; };
    const dark = () => c.closest('.glow')?.dataset.theme !== 'light';
    const draw = () => {
      raf = 0;
      if (!visible) return;
      ctx.clearRect(0, 0, w, h);
      const base = dark() ? '255,240,230' : '15,27,45';
      const grad = [[245, 176, 74], [52, 211, 153], [14, 159, 139], [56, 189, 248]];
      for (let x = GAP / 2; x < w; x += GAP) {
        for (let y = GAP / 2; y < h; y += GAP) {
          const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
          let a = 0.09, r = 1, col = base;
          if (d < R) { const k = 1 - d / R; a = 0.09 + k * 0.85; r = 1 + k * 1.4; const g = grad[Math.min(3, Math.floor((x / w) * 4))]; col = `${g[0]},${g[1]},${g[2]}`; }
          for (const ring of rings) { const e = Math.abs(Math.hypot(x - ring.x, y - ring.y) - ring.r); if (e < 14) { const k = (1 - e / 14) * (1 - ring.r / 320); a = Math.max(a, 0.2 + k * 0.7); r = Math.max(r, 1 + k * 1.6); col = '52,211,153'; } }
          ctx.fillStyle = `rgba(${col},${a})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
        }
      }
      for (let i = rings.length - 1; i >= 0; i -= 1) { rings[i].r += 7; if (rings[i].r > 320) rings.splice(i, 1); }
      dirty = false;
      if (rings.length) raf = requestAnimationFrame(draw);
    };
    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(draw); };
    const move = (e) => { const b = c.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; kick(); };
    const leave = () => { mouse.x = mouse.y = -999; kick(); };
    const click = (e) => { const b = c.getBoundingClientRect(); rings.push({ x: e.clientX - b.left, y: e.clientY - b.top, r: 0 }); kick(); };
    const host = c.parentElement;
    const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) kick(); }, { threshold: 0 });
    io.observe(c);
    size(); kick();
    window.addEventListener('resize', size);
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave); host.addEventListener('pointerdown', click);
    const mo = new MutationObserver(kick); const g = c.closest('.glow'); if (g) mo.observe(g, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { cancelAnimationFrame(raf); io.disconnect(); mo.disconnect(); window.removeEventListener('resize', size); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); host.removeEventListener('pointerdown', click); };
  }, []);
  return <canvas ref={ref} className="gx-dots" aria-hidden="true" />;
}

// ---------------------------------------------------------------- install the app (PWA): the browser's own prompt, or the iPhone steps
export function useInstall() {
  const [evt, setEvt] = useState(() => (typeof window !== 'undefined' ? window.__erpInstallEvt || null : null));
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const [installed, setInstalled] = useState(!!standalone);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); window.__erpInstallEvt = e; setEvt(e); };
    const done = () => { window.__erpInstallEvt = null; setEvt(null); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', h); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done); };
  }, []);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  const install = async () => {
    if (!evt) return false;
    evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    window.__erpInstallEvt = null; setEvt(null);
    if (choice?.outcome === 'accepted') setInstalled(true);
    return choice?.outcome === 'accepted';
  };
  return { canPrompt: !!evt && !installed, installed, ios: ios && !installed, install };
}

// ---------------------------------------------------------------- theme (the brand's light teal by default, dark on request, remembered on this device)
export function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('agentify_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const toggle = () => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('agentify_theme', n); } catch { /* ignore */ } return n; });
  return [theme, toggle];
}

/** Cursor spotlight on cards: sets --mx / --my where the pointer is. */
export const spot = (e) => { const b = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--mx', `${e.clientX - b.left}px`); e.currentTarget.style.setProperty('--my', `${e.clientY - b.top}px`); };
