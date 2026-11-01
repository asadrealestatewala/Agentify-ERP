import { useEffect, useMemo, useRef, useState } from 'react';
import { createMap } from '../maplibre.js';
import { brandColour } from '../googleMaps.js';
import { api } from '../api.js';
import { getRegion } from '../format.js';
import { hasWebGL } from '../mapEngine.js';
import { ErrorBox, Loading, Modal } from './ui.jsx';
import NavigateButton from './NavigateButton.jsx';

// In-app directions on free OSRM / Valhalla routing (via /api/directions). The device position is read once when the window opens
// (and, only if "Follow me" is on, while it stays open). Only the start and end coordinates are sent to our server to ask for the route.
const MODES = [['driving', 'Drive'], ['walking', 'Walk'], ['cycling', 'Cycle']];
const imperial = () => getRegion().config.units_system === 'imperial';
const dist = (m) => (imperial() ? (m < 160 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609.34).toFixed(1)} mi`) : m < 1000 ? `${Math.round(m / 10) * 10 || m} m` : `${(m / 1000).toFixed(1)} km`);
const mins = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim(); };
const near = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

const getPosition = () => new Promise((resolve, reject) => {
  if (!('geolocation' in navigator)) { reject(new Error('This device cannot find its position.')); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    (e) => reject(new Error(e.code === 1 ? 'Location permission is blocked. Allow it in the browser or phone settings to get directions from where you are.' : 'Your position could not be found. Move to an open area and try again.')),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
});

export default function DirectionsModal({ lat, lng, label, onClose }) {
  const [mode, setMode] = useState('driving');
  const [from, setFrom] = useState(null);
  const [route, setRoute] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(true);
  const [follow, setFollow] = useState(false);
  const [me, setMe] = useState(null);
  const [tryN, setTryN] = useState(0);
  const box = useRef(null);
  const st = useRef({ map: null, ml: null, you: null });
  const webgl = useMemo(hasWebGL, []);

  useEffect(() => {
    let live = true;
    setBusy(true); setErr(null); setRoute(null);
    (async () => {
      try {
        const start = from || await getPosition();
        if (!live) return;
        if (!from) setFrom(start);
        const r = await api.get(`/api/directions?from=${start.lat},${start.lng}&to=${lat},${lng}&mode=${mode}`);
        if (live) setRoute(r);
      } catch (e) { if (live) setErr(e); } finally { if (live) setBusy(false); }
    })();
    return () => { live = false; };
  }, [mode, lat, lng, tryN]); // eslint-disable-line react-hooks/exhaustive-deps

  // map with the route line
  useEffect(() => {
    const s = st.current;
    if (!route || !webgl || !box.current) return undefined;
    let dead = false;
    createMap(box.current, { lat, lng, zoom: 13 }).then(({ ml, map }) => {
      if (dead) { map.remove(); return; }
      s.map = map; s.ml = ml;
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      const setup = () => {
        if (map.getSource('dir')) return;
        map.addSource('dir', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.geometry } } });
        map.addLayer({ id: 'dir-case', type: 'line', source: 'dir', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
        map.addLayer({ id: 'dir-line', type: 'line', source: 'dir', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': brandColour(), 'line-width': 5 } });
      };
      map.on('load', setup); map.on('style.load', setup);
      const dot = (txt, bg) => { const el = document.createElement('div'); el.className = 'rr-dot'; el.style.background = bg; el.textContent = txt; return el; };
      new ml.Marker({ element: dot('A', '#16a34a') }).setLngLat(route.geometry[0]).addTo(map);
      new ml.Marker({ element: dot('B', '#dc2626') }).setLngLat(route.geometry[route.geometry.length - 1]).addTo(map);
      const b = new ml.LngLatBounds(); route.geometry.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 });
    }).catch(() => { /* no WebGL: the written steps still work */ });
    return () => { dead = true; s.you = null; s.map?.remove(); s.map = null; };
  }, [route, webgl]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow me: foreground only, nothing is sent anywhere
  useEffect(() => {
    if (!follow || !('geolocation' in navigator)) return undefined;
    const id = navigator.geolocation.watchPosition((p) => setMe([p.coords.longitude, p.coords.latitude]), () => setFollow(false), { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    return () => { navigator.geolocation.clearWatch(id); setMe(null); };
  }, [follow]);
  useEffect(() => {
    const s = st.current;
    if (!s.map || !s.ml) return;
    if (!me) { s.you?.remove(); s.you = null; return; }
    if (!s.you) { const el = document.createElement('div'); el.className = 'rr-me'; s.you = new s.ml.Marker({ element: el }).setLngLat(me).addTo(s.map); } else s.you.setLngLat(me);
    s.map.easeTo({ center: me, duration: 600 });
  }, [me]);

  // the next turn: the first step whose turning point lies further along the line than where the person is
  const stepIdx = useMemo(() => (route ? route.steps.map((s) => { let bi = 0; let bd = Infinity; route.geometry.forEach((g, i) => { const d = near(g, [s.lng, s.lat]); if (d < bd) { bd = d; bi = i; } }); return bi; }) : []), [route]);
  const nextStep = useMemo(() => {
    if (!route || !me) return -1;
    let ni = 0; let bd = Infinity;
    route.geometry.forEach((g, i) => { const d = near(g, me); if (d < bd) { bd = d; ni = i; } });
    const i = stepIdx.findIndex((x, k) => k > 0 && x >= ni);
    return i < 0 ? route.steps.length - 1 : i;
  }, [route, me, stepIdx]);

  const fly = (s) => st.current.map?.easeTo({ center: [s.lng, s.lat], zoom: 17, duration: 500 });
  const shown = nextStep >= 0 ? route.steps[nextStep] : null;

  return (
    <Modal title={`Directions${label ? ` to ${label}` : ''}`} onClose={onClose} size="lg">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }} role="group" aria-label="Travel mode">
        {MODES.map(([k, n]) => <button key={k} className={`btn sm${mode === k ? ' primary' : ''}`} aria-pressed={mode === k} onClick={() => setMode(k)}>{n}</button>)}
        {route && <label className="row" style={{ gap: 6, marginLeft: 'auto', fontSize: 13 }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow me while this window is open</label>}
      </div>
      {busy && <Loading rows={3} />}
      {err && !busy && (
        <div>
          <ErrorBox error={err} />
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setTryN((n) => n + 1)}>Try again</button>
            <NavigateButton lat={lat} lng={lng} label={label} />
          </div>
        </div>
      )}
      {route && !busy && (
        <>
          <div className="bold" style={{ marginBottom: 6 }}>{mins(route.duration_s)} · {dist(route.distance_m)} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>by {MODES.find((m) => m[0] === mode)[1].toLowerCase()}</span></div>
          {shown && <div className="alert" role="status" style={{ marginBottom: 8 }}><span className="bold">Next:</span> {shown.text}{shown.distance_m ? ` (${dist(shown.distance_m)})` : ''}</div>}
          {webgl && <div ref={box} className="lm-map" style={{ height: 300 }} role="application" aria-label="Route map" />}
          <ol className="dir-steps">
            {route.steps.map((s, i) => (
              <li key={i} className={i === nextStep ? 'now' : ''}>
                <button type="button" onClick={() => fly(s)}><span>{s.text}</span><span className="muted">{s.distance_m ? dist(s.distance_m) : ''}</span></button>
              </li>
            ))}
          </ol>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Route from OpenStreetMap data ({route.provider === 'osrm' ? 'OSRM' : 'Valhalla'}). Times assume normal traffic and can differ. Your start position is used only to ask for this route and is not saved.
          </div>
          <div style={{ marginTop: 8 }}><NavigateButton lat={lat} lng={lng} label={label}>Open in maps app</NavigateButton></div>
        </>
      )}
    </Modal>
  );
}
