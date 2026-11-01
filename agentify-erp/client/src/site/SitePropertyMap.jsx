import { useEffect, useRef } from 'react';
import { mapId } from '../googleMaps.js';
import { useMapEngine } from '../mapEngine.js';
import { createMap } from '../maplibre.js';
import { navLinks } from '../../../shared/navigate.js';

// Location block on a public listing page: free MapLibre street map by default, Google Maps when chosen, the OpenStreetMap embed without WebGL.
function GoogleView({ lat, lng }) {
  const box = useRef(null);
  useEffect(() => {
    let dead = false; let mk;
    (async () => {
      const [{ Map }, { AdvancedMarkerElement, PinElement }] = await Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('marker')]);
      if (dead) return;
      const map = new Map(box.current, { center: { lat, lng }, zoom: 16, mapId: mapId(), mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] }, streetViewControl: true, fullscreenControl: true, gestureHandling: 'cooperative', clickableIcons: false });
      const pin = new PinElement({ background: '#0e7c6b', borderColor: '#fff', glyphColor: '#fff' });
      mk = new AdvancedMarkerElement({ map, position: { lat, lng }, content: pin.element });
    })();
    return () => { dead = true; if (mk) mk.map = null; };
  }, [lat, lng]);
  return <div ref={box} className="map" style={{ width: '100%', height: 320, borderRadius: 8 }} role="application" aria-label="Map of the property" />;
}

function MapLibreView({ lat, lng }) {
  const box = useRef(null);
  useEffect(() => {
    let dead = false; let map;
    createMap(box.current, { lat, lng, zoom: 16, cooperative: true }).then(({ ml, map: m }) => {
      if (dead) { m.remove(); return; }
      map = m;
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new ml.FullscreenControl(), 'top-right');
      const el = document.createElement('div');
      el.innerHTML = '<svg width="30" height="38" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20 12 30 12 30s12-10 12-18.3C24 5.2 18.6 0 12 0z" fill="#0e7c6b" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11.5" r="4.5" fill="#fff"/></svg>';
      new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(m);
    }).catch(() => {});
    return () => { dead = true; map?.remove(); };
  }, [lat, lng]);
  return <div ref={box} className="map" style={{ width: '100%', height: 320, borderRadius: 8, overflow: 'hidden' }} role="application" aria-label="Map of the property" />;
}

export default function SitePropertyMap({ lat, lng }) {
  const m = useMapEngine();
  if (m === 'google') return <GoogleView lat={lat} lng={lng} />;
  if (m === 'maplibre') return <MapLibreView lat={lat} lng={lng} />;
  if (m === 'loading') return <div className="map" style={{ height: 320 }} />;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008}%2C${lat - 0.005}%2C${lng + 0.008}%2C${lat + 0.005}&layer=mapnik&marker=${lat}%2C${lng}`;
  return <iframe title="Map" className="map" src={src} loading="lazy" />;
}

/** "Navigate" on a public listing: opens the visitor's own maps app (Apple Maps first on Apple devices, Google Maps otherwise). */
export function SiteNavigate({ lat, lng, label }) {
  const n = navLinks(lat, lng, { label });
  if (!n) return null;
  return (
    <div className="row gap">
      <a className="btn-s" href={n[n.primary]} target="_blank" rel="noreferrer">➤ Navigate ({n.primary === 'apple' ? 'Apple Maps' : 'Google Maps'})</a>
      {n.primary === 'apple' && <a href={n.google} target="_blank" rel="noreferrer">Google Maps ↗</a>}
    </div>
  );
}
