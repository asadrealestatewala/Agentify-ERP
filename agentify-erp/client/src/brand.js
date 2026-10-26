import { useEffect, useState } from 'react';
import { api } from './api.js';

// The workspace name is public (needed before sign-in) and rarely changes: fetched once per page load.
let cached = null;
let pending = null;
const load = () => (pending ||= api.get('/api/auth/brand').then((b) => { cached = b; return b; }).catch(() => { pending = null; return null; }));

/** Company name of the workspace being viewed. Falls back to the product name until it loads. */
export function useBrand() {
  const [brand, setBrand] = useState(cached);
  const [done, setDone] = useState(!!cached);
  useEffect(() => { if (!cached) load().then((b) => { if (b) setBrand(b); setDone(true); }); }, []);
  return { name: brand?.name || 'Agentify ERP', demo_logins: brand?.demo_logins || [], sso: brand?.sso || [], workspace: !!brand?.workspace, logo: brand?.logo || '', staff_path: brand?.staff_path || 'staff', loaded: done };
}
