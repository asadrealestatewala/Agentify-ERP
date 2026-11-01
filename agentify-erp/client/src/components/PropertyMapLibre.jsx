import { useEffect, useRef } from 'react';
import { createMap, styleUrl } from '../maplibre.js';
import { roundCoord } from '../googleMaps.js';
import MapStyleToggle from './MapStyleToggle.jsx';

// Property editor map on free MapLibre tiles: draggable pin, click to move, street-level zoom. Two-finger gestures on phones so the page can still scroll.
export default function PropertyMapLibre({ lat, lng, onMove, height = 260 }) {
  const box = useRef(null);
  const st = useRef({ map: null, mk: null, cfg: null });
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    let dead = false;
    createMap(box.current, { lat, lng, zoom: 17, cooperative: true }).then(({ ml, map, cfg }) => {
      if (dead) { map.remove(); return; }
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new ml.FullscreenControl(), 'top-right');
      map.addControl(new ml.ScaleControl({ maxWidth: 90 }), 'bottom-left');
      const el = document.createElement('div');
      el.className = 'prop-pin'; el.style.cssText = 'width:28px;height:28px;cursor:grab'; el.innerHTML = '<span></span>'; el.title = 'Drag to the exact spot';
      const mk = new ml.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([lng, lat]).addTo(map);
      const report = (p) => cb.current?.(roundCoord(p.lat), roundCoord(p.lng));
      mk.on('dragend', () => report(mk.getLngLat()));
      map.on('click', (e) => { mk.setLngLat(e.lngLat); report(e.lngLat); });
      st.current = { map, mk, cfg };
    }).catch(() => {});
    return () => { dead = true; st.current.map?.remove(); st.current = { map: null, mk: null, cfg: null }; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // coordinates changed from outside (search, typing): move the pin and bring it into view
  useEffect(() => {
    const { map, mk } = st.current;
    if (!map || !mk) return;
    const cur = mk.getLngLat();
    if (Math.abs(cur.lat - lat) < 1e-7 && Math.abs(cur.lng - lng) < 1e-7) return;
    mk.setLngLat([lng, lat]);
    if (!map.getBounds().contains([lng, lat])) map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16.5) });
  }, [lat, lng]);

  const setKind = (k) => { const { map, cfg } = st.current; if (map && cfg) map.setStyle(styleUrl(cfg, k)); };
  return (
    <div style={{ position: 'relative' }}>
      <div ref={box} style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 8, zIndex: 0 }} aria-label="Map: drag the pin to the exact spot" />
      <MapStyleToggle onChange={setKind} />
    </div>
  );
}
