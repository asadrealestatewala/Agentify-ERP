import { navLinks } from '../../../shared/navigate.js';
import Icon from './Icon.jsx';

// "Navigate" opens the device's own maps app with the destination (Google Maps, or Apple Maps first on Apple devices). No key needed.
export default function NavigateButton({ lat, lng, label, className = 'btn sm', children = 'Navigate' }) {
  const n = navLinks(lat, lng, { label });
  if (!n) return null;
  const other = n.primary === 'apple' ? ['google', 'Google Maps'] : null;
  return (
    <span className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
      <a className={className} href={n[n.primary]} target="_blank" rel="noreferrer"><Icon name="route" size={14} /> {children}{n.primary === 'apple' ? ' (Apple Maps)' : ' (Google Maps)'}</a>
      {other && <a className="muted" style={{ fontSize: 12 }} href={n[other[0]]} target="_blank" rel="noreferrer">{other[1]}</a>}
    </span>
  );
}
