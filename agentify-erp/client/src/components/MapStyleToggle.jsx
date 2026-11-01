import { useState } from 'react';
import { useMaptilerKey } from '../mapEngine.js';

// Map / Satellite switch for the free maps. Only shown when the platform has an optional MapTiler key (satellite imagery is not free without one).
export default function MapStyleToggle({ onChange }) {
  const key = useMaptilerKey();
  const [kind, setKind] = useState('streets');
  if (!key) return null;
  const pick = (k) => { setKind(k); onChange(k); };
  return (
    <div className="mp-toggle" role="group" aria-label="Map type">
      <button type="button" className={kind === 'streets' ? 'on' : ''} aria-pressed={kind === 'streets'} onClick={() => pick('streets')}>Map</button>
      <button type="button" className={kind === 'satellite' ? 'on' : ''} aria-pressed={kind === 'satellite'} onClick={() => pick('satellite')}>Satellite</button>
    </div>
  );
}
