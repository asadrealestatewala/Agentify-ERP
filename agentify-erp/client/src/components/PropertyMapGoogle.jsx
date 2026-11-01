import { useEffect, useRef } from 'react';
import { mapId, roundCoord } from '../googleMaps.js';

// Property editor map on Google Maps: draggable pin, click to move, Map / Satellite toggle, street-level zoom.
function pinEl() {
  const el = document.createElement('div');
  el.className = 'prop-pin';
  el.innerHTML = '<span></span>';
  return el;
}

export default function PropertyMapGoogle({ lat, lng, onMove, height = 260 }) {
  const box = useRef(null);
  const st = useRef({ map: null, mk: null });
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    let dead = false;
    (async () => {
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('marker')]);
      if (dead) return;
      const map = new Map(box.current, { center: { lat, lng }, zoom: 18, mapId: mapId(), mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] }, streetViewControl: true, fullscreenControl: true, gestureHandling: 'cooperative', clickableIcons: false });
      const mk = new AdvancedMarkerElement({ map, position: { lat, lng }, gmpDraggable: true, content: pinEl(), title: 'Drag to the exact spot' });
      const report = (p) => cb.current?.(roundCoord(p.lat), roundCoord(p.lng));
      mk.addListener('dragend', () => { const p = mk.position; report({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }); });
      map.addListener('click', (e) => { const p = { lat: e.latLng.lat(), lng: e.latLng.lng() }; mk.position = p; report(p); });
      st.current = { map, mk };
    })();
    return () => { dead = true; if (st.current.mk) st.current.mk.map = null; st.current = { map: null, mk: null }; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const { map, mk } = st.current;
    if (!map || !mk) return;
    const p = mk.position; const cl = typeof p.lat === 'function' ? p.lat() : p.lat; const cg = typeof p.lng === 'function' ? p.lng() : p.lng;
    if (Math.abs(cl - lat) < 1e-7 && Math.abs(cg - lng) < 1e-7) return;
    mk.position = { lat, lng };
    if (!map.getBounds()?.contains({ lat, lng })) { map.setCenter({ lat, lng }); map.setZoom(Math.max(map.getZoom() || 16, 17)); }
  }, [lat, lng]);

  return <div ref={box} style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 8, zIndex: 0 }} aria-label="Map: drag the pin to the exact spot" />;
}
