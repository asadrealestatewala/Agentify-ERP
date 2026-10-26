import { Navigate, useParams } from 'react-router-dom';
import Login from './Login.jsx';
import { useBrand } from '../brand.js';

/** The unlisted staff sign-in address (set in Settings); any other single-word path behaves as before and goes to /login. */
export default function StaffGate() {
  const { slug } = useParams();
  const brand = useBrand();
  if (!brand.loaded) return <div className="center-box"><span className="spinner" /></div>;
  if (slug === 'portal' || slug === 'vendor') return <Navigate to={`/${slug}/login`} replace />;
  return brand.workspace && slug === brand.staff_path ? <Login staff /> : <Navigate to="/login" replace />;
}
