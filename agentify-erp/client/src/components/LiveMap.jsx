import { useEffect, useRef } from 'react';
import { mapId, glide, brandColour } from '../googleMaps.js';

// Live Google map of field agents. Markers glide to new positions when a fresh reading arrives, the selected agent is
// followed, and the map offers Map / Satellite+labels, zoom to street level, fullscreen and "fit everyone".
const FRESH = { fresh: '#0e7c6b', recent: '#d97706', stale: '#9ca3af', none: '#9ca3af' };
const initials = (n = '') => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

function markerEl(a, selected) {
  const el = document.createElement('div');
  el.className = `lm-pin${selected ? ' sel' : ''}${a.freshness === 'fresh' ? ' live' : ''}`;
  el.style.setProperty('--lm', FRESH[a.freshness] || FRESH.none);
  const first = (a.name || '').split(/\s+/)[0] || '';
  el.innerHTML = '<span class="lm-av"></span><span class="lm-name"></span>';
  el.firstChild.textContent = initials(a.name);
  el.lastChild.textContent = first;
  el.title = a.name;
  return el;
}

export default function LiveMap({ agents, selectedId, onSelect, height = 380 }) {
  const box = useRef(null);
  const state = useRef({ map: null, markers: new Map(), circle: null, fitted: false, lib: null });
  const pick = useRef(onSelect);
  pick.current = onSelect;

  useEffect(() => {
    const st = state.current;
    let dead = false;
    (async () => {
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('marker')]);
      if (dead) return;
      st.lib = { AdvancedMarkerElement };
      st.map = new Map(box.current, {
        center: { lat: 30, lng: 70 }, zoom: 4, mapId: mapId(), mapTypeId: 'roadmap', gestureHandling: 'greedy',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] }, streetViewControl: true, fullscreenControl: true, clickableIcons: false,
      });
      st.circle = new window.google.maps.Circle({ map: st.map, strokeColor: brandColour(), strokeOpacity: 0.7, strokeWeight: 1, fillColor: brandColour(), fillOpacity: 0.12, clickable: false, visible: false });
      st.ready?.();
    })();
    return () => { dead = true; st.markers.forEach((m) => { m.cancel?.(); m.mk.map = null; }); st.markers.clear(); st.map = null; };
  }, []);

  useEffect(() => {
    const st = state.current;
    const apply = () => {
      if (!st.map || !st.lib) return;
      const withLoc = (agents || []).filter((a) => a.location);
      const seen = new Set();
      for (const a of withLoc) {
        seen.add(a.user_id);
        const pos = { lat: a.location.lat, lng: a.location.lng };
        const sel = a.user_id === selectedId;
        let m = st.markers.get(a.user_id);
        if (!m) {
          const mk = new st.lib.AdvancedMarkerElement({ map: st.map, position: pos, content: markerEl(a, sel), title: a.name, zIndex: sel ? 10 : 1 });
          mk.addListener('click', () => pick.current?.(a.user_id));
          m = { mk, pos, cancel: null };
          st.markers.set(a.user_id, m);
        } else {
          m.mk.content = markerEl(a, sel);
          m.mk.zIndex = sel ? 10 : 1;
          if (Math.abs(m.pos.lat - pos.lat) > 1e-7 || Math.abs(m.pos.lng - pos.lng) > 1e-7) {
            m.cancel?.();
            const from = m.pos; m.pos = pos;
            m.cancel = glide(from, pos, 1500, (p) => { m.mk.position = p; });
          }
        }
      }
      for (const [id, m] of st.markers) if (!seen.has(id)) { m.cancel?.(); m.mk.map = null; st.markers.delete(id); }

      const picked = withLoc.find((a) => a.user_id === selectedId);
      if (picked) {
        st.circle.setOptions({ visible: !!picked.location.accuracy_m, center: { lat: picked.location.lat, lng: picked.location.lng }, radius: Math.min(picked.location.accuracy_m || 0, 5000) });
      } else st.circle.setVisible(false);

      if (!st.fitted && withLoc.length) {
        st.fitted = true;
        if (withLoc.length === 1) { st.map.setCenter({ lat: withLoc[0].location.lat, lng: withLoc[0].location.lng }); st.map.setZoom(17); }
        else { const b = new window.google.maps.LatLngBounds(); withLoc.forEach((a) => b.extend({ lat: a.location.lat, lng: a.location.lng })); st.map.fitBounds(b, 60); }
      }
    };
    st.ready = apply;
    apply();
  }, [agents, selectedId]);

  // choosing an agent in the list flies the map to their street
  const lastSel = useRef(null);
  useEffect(() => {
    const st = state.current;
    const a = (agents || []).find((x) => x.user_id === selectedId && x.location);
    if (!a || lastSel.current === selectedId || !st.map) return;
    lastSel.current = selectedId;
    st.map.panTo({ lat: a.location.lat, lng: a.location.lng });
    if ((st.map.getZoom() || 0) < 16) st.map.setZoom(17);
  }, [selectedId, agents]);

  const fit = () => {
    const st = state.current; const w = (agents || []).filter((a) => a.location);
    if (!st.map || !w.length) return;
    const b = new window.google.maps.LatLngBounds(); w.forEach((a) => b.extend({ lat: a.location.lat, lng: a.location.lng }));
    st.map.fitBounds(b, 60); if (w.length === 1) st.map.setZoom(17);
  };

  return (
    <div className="lm-wrap">
      <div ref={box} className="lm-map" style={{ height }} role="application" aria-label="Live map of field agents" />
      <button type="button" className="btn sm lm-fit" onClick={fit}>Show everyone</button>
    </div>
  );
}
