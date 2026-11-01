import { useEffect, useRef } from 'react';
import { createMap, circleFeature, styleUrl } from '../maplibre.js';
import { brandColour } from '../googleMaps.js';
import MapStyleToggle from './MapStyleToggle.jsx';

// Live map of field agents on free MapLibre vector tiles. Built for modest phones: at most MAX_PINS markers are drawn (the picked agent
// always, then the most recently seen), pins are updated in place instead of rebuilt, one animation loop glides every moving pin,
// and the pulsing halo is switched off when many pins are showing. The picked agent is followed; "Show everyone" fits all pins.
const MAX_PINS = 150;
const MANY = 40;
const FRESH = { fresh: '#0e7c6b', recent: '#d97706', stale: '#9ca3af', none: '#9ca3af' };
const initials = (n = '') => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

function makePin(a) {
  const el = document.createElement('div');
  el.innerHTML = '<span class="lm-av"></span><span class="lm-name"></span>';
  el.dataset.k = '';
  return el;
}
function paintPin(el, a, sel, many) {
  const key = `${a.name}|${a.freshness}|${sel}|${many}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.className = `lm-pin${sel ? ' sel' : ''}${a.freshness === 'fresh' && !many ? ' live' : ''}`;
  el.style.setProperty('--lm', FRESH[a.freshness] || FRESH.none);
  el.firstChild.textContent = initials(a.name);
  el.lastChild.textContent = (a.name || '').split(/\s+/)[0] || '';
  el.title = a.name || '';
  el.style.zIndex = sel ? 10 : 1;
}

export default function LiveMapLibre({ agents, selectedId, onSelect, height = 380 }) {
  const box = useRef(null);
  const st = useRef({ map: null, ml: null, cfg: null, pins: new Map(), raf: 0, fitted: false, kind: 'streets', ready: null, circle: null });
  const pick = useRef(onSelect);
  pick.current = onSelect;

  useEffect(() => {
    const s = st.current;
    let dead = false;
    const addRing = () => {
      const m = s.map;
      if (!m || m.getSource('acc')) return;
      m.addSource('acc', { type: 'geojson', data: s.circle || { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'acc-fill', type: 'fill', source: 'acc', paint: { 'fill-color': brandColour(), 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'acc-line', type: 'line', source: 'acc', paint: { 'line-color': brandColour(), 'line-opacity': 0.7, 'line-width': 1 } });
    };
    createMap(box.current, { kind: s.kind }).then(({ ml, map, cfg }) => {
      if (dead) { map.remove(); return; }
      s.map = map; s.ml = ml; s.cfg = cfg;
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new ml.FullscreenControl(), 'top-right');
      map.addControl(new ml.ScaleControl({ maxWidth: 90 }), 'bottom-left');
      map.on('load', addRing);
      map.on('style.load', addRing);
      s.ready?.();
    }).catch(() => { /* WebGL failed: the page keeps the list and the map link */ });
    return () => { dead = true; cancelAnimationFrame(s.raf); s.pins.forEach((p) => p.mk.remove()); s.pins.clear(); s.map?.remove(); s.map = null; };
  }, []);

  // one loop moves every pin that is still gliding
  const animate = () => {
    const s = st.current;
    if (s.raf) return;
    const tick = (now) => {
      let busy = false;
      s.pins.forEach((p) => {
        if (!p.anim) return;
        const k = Math.min(1, (now - p.anim.t0) / 1500);
        const e = 1 - (1 - k) ** 3;
        p.mk.setLngLat([p.anim.from[0] + (p.anim.to[0] - p.anim.from[0]) * e, p.anim.from[1] + (p.anim.to[1] - p.anim.from[1]) * e]);
        if (k < 1) busy = true; else p.anim = null;
      });
      s.raf = busy ? requestAnimationFrame(tick) : 0;
    };
    s.raf = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const s = st.current;
    const apply = () => {
      if (!s.map || !s.ml) return;
      const all = (agents || []).filter((a) => a.location);
      const shown = [...all].sort((a, b) => (a.user_id === selectedId ? -1 : b.user_id === selectedId ? 1 : (a.age_minutes ?? 1e9) - (b.age_minutes ?? 1e9))).slice(0, MAX_PINS);
      const many = shown.length > MANY;
      const seen = new Set();
      for (const a of shown) {
        seen.add(a.user_id);
        const to = [a.location.lng, a.location.lat];
        const sel = a.user_id === selectedId;
        let p = s.pins.get(a.user_id);
        if (!p) {
          const el = makePin(a);
          el.addEventListener('click', (e) => { e.stopPropagation(); pick.current?.(a.user_id); });
          p = { mk: new s.ml.Marker({ element: el, anchor: 'center' }).setLngLat(to).addTo(s.map), el, pos: to, anim: null };
          s.pins.set(a.user_id, p);
        } else if (Math.abs(p.pos[0] - to[0]) > 1e-7 || Math.abs(p.pos[1] - to[1]) > 1e-7) {
          const from = p.anim ? p.mk.getLngLat().toArray() : p.pos;
          p.anim = { from, to, t0: performance.now() }; p.pos = to;
          animate();
        }
        paintPin(p.el, a, sel, many);
      }
      for (const [id, p] of s.pins) if (!seen.has(id)) { p.mk.remove(); s.pins.delete(id); }

      const picked = all.find((a) => a.user_id === selectedId);
      s.circle = picked?.location.accuracy_m ? circleFeature(picked.location.lat, picked.location.lng, Math.min(picked.location.accuracy_m, 5000)) : { type: 'FeatureCollection', features: [] };
      s.map.getSource('acc')?.setData(s.circle);

      if (!s.fitted && all.length) {
        s.fitted = true;
        if (all.length === 1) s.map.jumpTo({ center: [all[0].location.lng, all[0].location.lat], zoom: 17 });
        else { const b = new s.ml.LngLatBounds(); all.forEach((a) => b.extend([a.location.lng, a.location.lat])); s.map.fitBounds(b, { padding: 60, maxZoom: 17, duration: 0 }); }
      }
    };
    s.ready = apply;
    apply();
  }, [agents, selectedId]);

  // choosing an agent in the list flies the map to their street
  const lastSel = useRef(null);
  useEffect(() => {
    const s = st.current;
    const a = (agents || []).find((x) => x.user_id === selectedId && x.location);
    if (!a || lastSel.current === selectedId || !s.map) return;
    lastSel.current = selectedId;
    s.map.easeTo({ center: [a.location.lng, a.location.lat], zoom: Math.max(s.map.getZoom(), 16.5), duration: 700 });
  }, [selectedId, agents]);

  const fit = () => {
    const s = st.current; const w = (agents || []).filter((a) => a.location);
    if (!s.map || !w.length) return;
    if (w.length === 1) { s.map.easeTo({ center: [w[0].location.lng, w[0].location.lat], zoom: 17 }); return; }
    const b = new s.ml.LngLatBounds(); w.forEach((a) => b.extend([a.location.lng, a.location.lat]));
    s.map.fitBounds(b, { padding: 60, maxZoom: 17 });
  };
  const setKind = (k) => { const s = st.current; s.kind = k; if (s.map && s.cfg) s.map.setStyle(styleUrl(s.cfg, k)); };

  return (
    <div className="lm-wrap">
      <div ref={box} className="lm-map" style={{ height }} role="application" aria-label="Live map of field agents" />
      <button type="button" className="btn sm lm-fit" onClick={fit}>Show everyone</button>
      <MapStyleToggle onChange={setKind} />
    </div>
  );
}
