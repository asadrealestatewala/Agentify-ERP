// Interactive street-level map for the property editor: tap the map or drag the pin to set the exact point, or use the phone's GPS
// while standing at the property. Search results only place the pin near the typed text; this is how the person makes it exact.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from './Icon.jsx';

const PIN = L.divIcon({ className: '', html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#0e7c6b;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);transform:rotate(-45deg)"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
const round = (n) => Math.round(n * 1e6) / 1e6;
const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export default function PinPicker({ lat, lng, onChange, height = 280 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const la = Number(lat); const ln = Number(lng);
  const has = lat !== '' && lat != null && lng !== '' && lng != null && valid(la, ln);

  const place = (p, zoom) => {
    if (!map.current) return;
    if (!marker.current) {
      marker.current = L.marker(p, { icon: PIN, draggable: true }).addTo(map.current);
      marker.current.on('dragend', () => { const q = marker.current.getLatLng(); cb.current(round(q.lat), round(q.lng)); });
    } else marker.current.setLatLng(p);
    map.current.setView(p, zoom ?? Math.max(map.current.getZoom(), 17));
  };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(has ? [la, ln] : [30, 70], has ? 17 : 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    map.current = m;
    m.on('click', (e) => { cb.current(round(e.latlng.lat), round(e.latlng.lng)); });
    if (has) place([la, ln], 17);
    setTimeout(() => m.invalidateSize(), 200);
    return () => { m.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the latitude/longitude fields when they change (typing, search results, GPS)
  useEffect(() => {
    if (!map.current || !has) return;
    const cur = marker.current?.getLatLng();
    if (!cur || Math.abs(cur.lat - la) > 1e-7 || Math.abs(cur.lng - ln) > 1e-7) place([la, ln]);
  }, [la, ln, has]); // eslint-disable-line react-hooks/exhaustive-deps

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) { setMsg('This device does not support location.'); return; }
    setBusy(true); setMsg('');
    navigator.geolocation.getCurrentPosition((pos) => {
      setBusy(false);
      cb.current(round(pos.coords.latitude), round(pos.coords.longitude));
      setMsg(`Pin set to your current position (accurate to about ${Math.round(pos.coords.accuracy)} m). Drag it if the property is a few steps away.`);
    }, (e) => {
      setBusy(false);
      setMsg(e.code === 1 ? 'Location permission is blocked. Allow it in the browser or phone settings, then try again.' : 'Could not get your position. Move to an open area and try again.');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  };

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={useMyLocation}><Icon name="map" size={14} /> {busy ? 'Reading GPS…' : 'Use my current location'}</button>
        <span className="muted" style={{ fontSize: 13 }}>Zoom in and tap the map, or drag the pin, to mark the exact street and plot.</span>
      </div>
      <div ref={el} role="application" aria-label="Map: tap or drag the pin to set the exact location" style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 8, zIndex: 0 }} />
      {msg && <div className="muted" role="status" style={{ marginTop: 6, fontSize: 13 }}>{msg}</div>}
      {has && <a href={`https://www.google.com/maps?q=${la},${ln}`} target="_blank" rel="noreferrer" className="muted">Open in Google Maps ↗</a>}
    </div>
  );
}
