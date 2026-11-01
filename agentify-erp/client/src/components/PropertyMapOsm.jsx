import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Map with a draggable pin for the property editor. Dragging the pin (or clicking the map) reports the new position.
// OpenStreetMap's tile servers refuse requests that carry no Referer (their usage policy). The app sends 'no-referrer' by default
// (helmet), so the tile images ask for the origin to be sent. Only the site's address is sent, never the page path.
// The pin is drawn with CSS in the workspace's primary colour, so no marker image files are needed.
const pinIcon = () => L.divIcon({ className: 'prop-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });

export default function PropertyMap({ lat, lng, onMove, height = 260 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([lat, lng], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' }).addTo(m);
    const mk = L.marker([lat, lng], { draggable: true, icon: pinIcon(), keyboard: true, title: 'Drag to the exact spot' }).addTo(m);
    const report = (p) => cb.current?.(Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6);
    mk.on('dragend', () => report(mk.getLatLng()));
    m.on('click', (e) => { mk.setLatLng(e.latlng); report(e.latlng); });
    map.current = m; marker.current = mk;
    return () => { m.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // coordinates changed from outside (search, typing): move the pin and bring it into view
  useEffect(() => {
    const mk = marker.current; const m = map.current;
    if (!mk || !m) return;
    const cur = mk.getLatLng();
    if (Math.abs(cur.lat - lat) < 1e-7 && Math.abs(cur.lng - lng) < 1e-7) return;
    mk.setLatLng([lat, lng]);
    if (!m.getBounds().contains([lat, lng])) m.setView([lat, lng], Math.max(m.getZoom(), 16));
  }, [lat, lng]);

  return <div ref={el} style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 8, zIndex: 0 }} aria-label="Map: drag the pin to the exact spot" />;
}
