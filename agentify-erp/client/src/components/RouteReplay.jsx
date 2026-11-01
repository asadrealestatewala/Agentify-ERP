import { useEffect, useMemo, useRef, useState } from 'react';
import { createMap } from '../maplibre.js';
import { brandColour } from '../googleMaps.js';
import { api } from '../api.js';
import { getRegion } from '../format.js';
import { hasWebGL } from '../mapEngine.js';
import { Empty, ErrorBox, Loading } from './ui.jsx';
import Icon from './Icon.jsx';

// Route history replay for one field agent: pick a day, press play and watch the saved readings in order on the free MapLibre map.
// Days are the workspace's days (its timezone), not the viewer's. Straight lines join consecutive readings, so a long gap means the
// person was not sharing, not that they stood still.
const tz = () => getRegion().config.timezone || 'UTC';
const SEG_PER_SEC = 1.2;
const SPEEDS = [1, 2, 4, 8];

function offsetMs(zone, utcMs) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs;
}
/** UTC instant at which the given calendar day (YYYY-MM-DD) starts in a timezone. */
export function dayStart(dateStr, zone = tz()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - offsetMs(zone, guess - offsetMs(zone, guess));
}
export const todayStr = (zone = tz()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
export const shiftDay = (dateStr, n) => { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const clock = (ms) => new Intl.DateTimeFormat(undefined, { timeZone: tz(), hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
const km = (m) => (getRegion().config.units_system === 'imperial' ? `${(m / 1609.34).toFixed(1)} mi` : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function RouteReplay({ agent, onClose }) {
  const [day, setDay] = useState(todayStr());
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pos, setPos] = useState(0); // fractional index into the points
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const box = useRef(null);
  const st = useRef({ map: null, ml: null, mk: null, ready: false });
  const webgl = useMemo(hasWebGL, []);

  useEffect(() => {
    let live = true;
    setData(null); setErr(null); setPlaying(false); setPos(0);
    const from = dayStart(day); const to = dayStart(shiftDay(day, 1));
    api.get(`/api/field/team/${agent.user_id}/route?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`)
      .then((d) => live && setData(d)).catch((e) => live && setErr(e));
    return () => { live = false; };
  }, [agent.user_id, day]);

  const pts = data?.points || [];
  const line = useMemo(() => pts.map((p) => [p.lng, p.lat]), [pts]);
  const last = Math.max(0, pts.length - 1);

  // the point on the line at a fractional index
  const at = (i) => {
    if (!pts.length) return null;
    const a = Math.min(Math.floor(i), last); const b = Math.min(a + 1, last); const f = i - a;
    const ta = Date.parse(pts[a].captured_at); const tb = Date.parse(pts[b].captured_at);
    return { lng: pts[a].lng + (pts[b].lng - pts[a].lng) * f, lat: pts[a].lat + (pts[b].lat - pts[a].lat) * f, t: ta + (tb - ta) * f };
  };

  // map
  useEffect(() => {
    const s = st.current;
    if (!webgl || !box.current || !pts.length) return undefined;
    let dead = false;
    createMap(box.current, { lat: pts[0].lat, lng: pts[0].lng, zoom: 14 }).then(({ ml, map }) => {
      if (dead) { map.remove(); return; }
      s.map = map; s.ml = ml;
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      const setup = () => {
        if (map.getSource('route')) return;
        const feat = (c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
        map.addSource('route', { type: 'geojson', data: feat(line.length > 1 ? line : [line[0], line[0]]) });
        map.addSource('done', { type: 'geojson', data: feat([line[0], line[0]]) });
        map.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.9 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9ca3af', 'line-width': 4 } });
        map.addLayer({ id: 'done-line', type: 'line', source: 'done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': brandColour(), 'line-width': 5 } });
        s.ready = true; s.draw?.();
      };
      map.on('load', setup); map.on('style.load', setup);
      const mk = (txt, bg) => { const el = document.createElement('div'); el.className = 'rr-dot'; el.style.background = bg; el.textContent = txt; return new ml.Marker({ element: el }); };
      mk('A', '#16a34a').setLngLat(line[0]).addTo(map);
      if (line.length > 1) mk('B', '#dc2626').setLngLat(line[line.length - 1]).addTo(map);
      const me = document.createElement('div'); me.className = 'rr-me';
      s.mk = new ml.Marker({ element: me }).setLngLat(line[0]).addTo(map);
      const b = new ml.LngLatBounds(); line.forEach((c) => b.extend(c));
      if (line.length > 1) map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 }); else map.jumpTo({ center: line[0], zoom: 16 });
    }).catch(() => { /* WebGL failed: the summary below still works */ });
    return () => { dead = true; s.ready = false; s.mk = null; s.map?.remove(); s.map = null; };
  }, [data, webgl]); // eslint-disable-line react-hooks/exhaustive-deps

  // moving marker and the travelled part of the line
  useEffect(() => {
    const s = st.current;
    s.draw = () => {
      const p = at(pos); if (!p || !s.map) return;
      s.mk?.setLngLat([p.lng, p.lat]);
      if (!s.ready) return;
      const n = Math.floor(pos);
      s.map.getSource('done')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...line.slice(0, n + 1), [p.lng, p.lat]] } });
    };
    s.draw();
  }, [pos, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // playback
  useEffect(() => {
    if (!playing) return undefined;
    let raf; let prev = performance.now();
    const tick = (now) => {
      const dt = (now - prev) / 1000; prev = now;
      setPos((p) => {
        const n = p + dt * SEG_PER_SEC * speed;
        if (n >= last) { setPlaying(false); return last; }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, last]);

  const cur = at(pos);
  const play = () => { if (pos >= last) setPos(0); setPlaying((x) => !x); };
  const today = todayStr();

  return (
    <div className="rr">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setDay((d) => shiftDay(d, -1))} aria-label="Previous day"><Icon name="chevL" size={14} /></button>
        <input className="input" type="date" style={{ width: 'auto' }} value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Route date" />
        <button className="btn sm" disabled={day >= today} onClick={() => setDay((d) => shiftDay(d, 1))} aria-label="Next day"><Icon name="chevR" size={14} /></button>
        {onClose && <button className="btn sm ghost" onClick={onClose}>Hide replay</button>}
      </div>
      {err && <ErrorBox error={err} />}
      {!err && !data && <Loading rows={2} />}
      {data && !data.enabled && <Empty icon="route">Route history is switched off for this workspace. An admin can turn it on in the location settings below.</Empty>}
      {data?.enabled && !pts.length && <Empty icon="route">No route was shared by {agent.name} on this day.</Empty>}
      {data?.enabled && pts.length > 0 && (
        <>
          {webgl ? <div ref={box} className="lm-map" style={{ height: 340 }} role="application" aria-label={`Route of ${agent.name}`} /> : <div className="muted" style={{ fontSize: 12 }}>This browser cannot draw the map. The summary below still applies.</div>}
          <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="btn primary sm" onClick={play} disabled={pts.length < 2} aria-label={playing ? 'Pause replay' : 'Play replay'}><Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : pos >= last && last > 0 ? 'Replay' : 'Play'}</button>
            <div role="group" aria-label="Replay speed" className="row" style={{ gap: 4 }}>
              {SPEEDS.map((x) => <button key={x} className={`btn sm${speed === x ? ' primary' : ''}`} aria-pressed={speed === x} onClick={() => setSpeed(x)}>{x}×</button>)}
            </div>
            <span className="bold nowrap" aria-live="off">{cur ? clock(cur.t) : ''}</span>
          </div>
          <input type="range" min={0} max={last} step={0.01} value={pos} disabled={pts.length < 2} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} style={{ width: '100%', marginTop: 6 }} aria-label="Replay position" />
          <div className="muted" style={{ fontSize: 12 }}>
            {pts.length} shared readings between {clock(Date.parse(data.started_at))} and {clock(Date.parse(data.ended_at))} ({tz()}) · about {km(data.distance_m)} in straight lines between readings.
            Gaps mean the person was not sharing, not that they stayed in place. Routes are deleted after {data.retention_days} days, and each view is logged.
          </div>
        </>
      )}
    </div>
  );
}
