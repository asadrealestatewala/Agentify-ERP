import { lazy, Suspense, useState } from 'react';
import { navLinks } from '../../../shared/navigate.js';
import Icon from './Icon.jsx';

const DirectionsModal = lazy(() => import('./DirectionsModal.jsx'));

// "Navigate" opens the device's own maps app with the destination (Google Maps, or Apple Maps first on Apple devices). No key needed.
// Signed-in staff also get "Directions" which shows the route and the written steps inside the app (free OSRM / Valhalla routing).
export default function NavigateButton({ lat, lng, label, className = 'btn sm', children = 'Navigate', inApp = true }) {
  const [open, setOpen] = useState(false);
  const n = navLinks(lat, lng, { label });
  if (!n) return null;
  const other = n.primary === 'apple' ? ['google', 'Google Maps'] : null;
  return (
    <span className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
      {inApp && <button type="button" className={className} onClick={() => setOpen(true)}><Icon name="map" size={14} /> Directions in the app</button>}
      <a className={className} href={n[n.primary]} target="_blank" rel="noreferrer"><Icon name="route" size={14} /> {children}{n.primary === 'apple' ? ' (Apple Maps)' : ' (Google Maps)'}</a>
      {other && <a className="muted" style={{ fontSize: 12 }} href={n[other[0]]} target="_blank" rel="noreferrer">{other[1]}</a>}
      {open && <Suspense fallback={null}><DirectionsModal lat={Number(lat)} lng={Number(lng)} label={label} onClose={() => setOpen(false)} /></Suspense>}
    </span>
  );
}
