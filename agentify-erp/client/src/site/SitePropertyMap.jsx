import { useEffect, useRef } from 'react';
import { mapId, useMaps } from '../googleMaps.js';

// Location block on a public listing page: Google Maps (street/satellite) when available, else the OpenStreetMap embed.
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

export default function SitePropertyMap({ lat, lng }) {
  const m = useMaps();
  if (m === 'ready') return <GoogleView lat={lat} lng={lng} />;
  if (m === 'loading') return <div className="map" style={{ height: 320 }} />;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008}%2C${lat - 0.005}%2C${lng + 0.008}%2C${lat + 0.005}&layer=mapnik&marker=${lat}%2C${lng}`;
  return <iframe title="Map" className="map" src={src} loading="lazy" />;
}
