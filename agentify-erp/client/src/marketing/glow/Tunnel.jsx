// Perspective-tunnel hero: product screens fly towards the visitor as the page scrolls. Adapted from the supplied
// 21st.dev "perspective tunnel" idea (central type anchor, radial grid, depth rings, cards moving through Z, smoothed
// progress, pointer parallax) with three deliberate differences:
//  - progress comes from the page's own scroll position; no wheel or touch event is ever intercepted, so the page always
//    scrolls normally and the visitor can leave the section at any time;
//  - no animation library: the scroll position sets one CSS variable (--p) and CSS does the 3D maths;
//  - it switches itself off (static hero below) on phones and narrow windows, short windows, reduced motion and low-power devices.
// The cards are decorative copies of real product screens (genuine per-country screenshots of the running app); the keyboard-accessible way into the same screens is the row of buttons under the hero buttons.
import { useEffect, useState } from 'react';
import { reducedMotion } from './parts.jsx';

const shot = (kind, code) => `/marketing/m-${kind}-${String(code).toLowerCase()}.webp`;

/** The six screens in the tunnel and the tour tab each one opens. */
export const TUNNEL = [
  { tab: 'pipeline', title: 'Sales pipeline', kind: 'shot', shot: 're-pipeline' },
  { tab: 'inbox', title: 'Lead inbox', kind: 'shot', shot: 're-inbox' },
  { tab: 'mobile', title: 'Mobile CRM', kind: 'phone', shot: 're-mob-leads' },
  { tab: 'tasks', title: 'Follow-ups', kind: 'shot', shot: 're-dialer' },
  { tab: 'properties', title: 'Properties and interests', kind: 'shot', shot: 're-sale' },
  { tab: 'team', title: 'Team performance', kind: 'shot', shot: 're-dash' },
];
const POS = TUNNEL.map((c, i) => ({
  // alternate left / right gutters; far from the centre so the type block stays clear when a card is near the camera
  bx: (i % 2 ? 1 : -1) * (43 + (i % 3) * 4),
  by: [-24, 18, -4, 26, -28, 8][i],
  rz: (i % 2 ? -1 : 1) * (3 + (i % 5) * 2),
  s: +(i * 0.1).toFixed(2),
}));

const eligible = () => typeof window !== 'undefined'
  && window.innerWidth >= 900 && window.innerHeight >= 640
  && !reducedMotion()
  && !(navigator.deviceMemory && navigator.deviceMemory <= 2)
  && !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

/** True while the tunnel should run; also drives --p on `ref` from the page scroll, smoothed. */
export function useTunnel(ref) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const upd = () => setOn(eligible());
    upd();
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    window.addEventListener('resize', upd); mq?.addEventListener?.('change', upd);
    return () => { window.removeEventListener('resize', upd); mq?.removeEventListener?.('change', upd); };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return undefined;
    let target = 0; let cur = 0; let raf = 0;
    const tick = () => {
      cur += (target - cur) * 0.14;
      if (Math.abs(target - cur) < 0.0005) cur = target;
      el.style.setProperty('--p', cur.toFixed(4));
      raf = cur === target ? 0 : requestAnimationFrame(tick);
    };
    const read = () => {
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      target = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    read();
    window.addEventListener('scroll', read, { passive: true }); window.addEventListener('resize', read);
    return () => { window.removeEventListener('scroll', read); window.removeEventListener('resize', read); if (raf) cancelAnimationFrame(raf); };
  }, [on, ref]);
  return on;
}

function Face({ c, code }) {
  if (c.kind === 'phone') return <img className="phone" src={`/marketing/m-${c.shot}-${String(code).toLowerCase()}.webp`} width="780" height="1688" loading="lazy" alt="" draggable="false" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  return <img src={shot(c.shot, code)} width="2200" height="1480" loading="lazy" alt="" draggable="false" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
}

/** The flying cards. Decorative (aria-hidden): clicking one opens the matching tour tab; keyboard users use the buttons under the hero. */
export function TunnelCards({ country, onPick }) {
  return (
    <div className="gx-tcards" aria-hidden="true">
      <i className="gx-ring r1" /><i className="gx-ring r2" />
      {TUNNEL.map((c, i) => (
        <div key={c.tab} className="gx-tcard" style={{ '--bx': `${POS[i].bx}vw`, '--by': `${POS[i].by}vh`, '--rz': `${POS[i].rz}deg`, '--s': POS[i].s, '--z': i + 1 }} onClick={() => onPick(c.tab)}>
          <div className="gx-tc-bar"><i /><i /><i /><span>{c.title} · sample</span></div>
          <div className="gx-tc-body"><Face c={c} code={country.code} /></div>
        </div>
      ))}
    </div>
  );
}
