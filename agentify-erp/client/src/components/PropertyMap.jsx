import { lazy, Suspense } from 'react';
import { useMaps } from '../googleMaps.js';

// Google Maps when the platform has a key, OpenStreetMap (Leaflet) otherwise. Same props either way.
const Osm = lazy(() => import('./PropertyMapOsm.jsx'));
const Google = lazy(() => import('./PropertyMapGoogle.jsx'));

export default function PropertyMap(props) {
  const m = useMaps();
  const h = props.height || 260;
  return <Suspense fallback={<div style={{ height: h }} />}>{m === 'ready' ? <Google {...props} /> : m === 'off' ? <Osm {...props} /> : <div style={{ height: h }} />}</Suspense>;
}
