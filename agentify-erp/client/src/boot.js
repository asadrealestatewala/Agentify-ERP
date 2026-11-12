// Data the server wrote into a public page's HTML (see server/src/services/fastLanding.js). Present only on the main
// domain's public pages, where nobody is signed in to a workspace, so the app can skip the sign-in and region lookups.
let data = null;
try { const el = typeof document !== 'undefined' && document.getElementById('erp-boot'); if (el) data = JSON.parse(el.textContent); } catch { data = null; }
export const boot = data;
/** True on the main domain's public pages: there is no workspace here, so no signed-in user and no workspace region. */
export const onMainSite = !!data?.main;
