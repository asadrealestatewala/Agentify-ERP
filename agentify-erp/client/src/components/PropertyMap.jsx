import { lazy, Suspense } from 'react';
import { useMapEngine } from '../mapEngine.js';

// Free MapLibre map by default, Google Maps when the platform owner chose it, Leaflet only on browsers without WebGL. Same props everywhere.
const Osm = lazy(() => import('./PropertyMapOsm.jsx'));
const Google = lazy(() => import('./PropertyMapGoogle.jsx'));
const Libre = lazy(() => import('./PropertyMapLibre.jsx'));

export default function PropertyMap(props) {
  const m = useMapEngine();
  const h = props.height || 260;
  const View = m === 'google' ? Google : m === 'maplibre' ? Libre : m === 'off' ? Osm : null;
  return <Suspense fallback={<div style={{ height: h }} />}>{View ? <View {...props} /> : <div style={{ height: h }} />}</Suspense>;
}
