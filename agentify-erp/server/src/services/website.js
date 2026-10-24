import crypto from 'node:crypto';
import { get, all, run, getSetting, setSetting } from '../db.js';
import { now, jparse } from '../util.js';

/** ERP status -> website visibility. ERP is the source of truth. */
export function websiteState(p) {
  if (!p.published) return 'hidden';
  switch (p.status) {
    case 'available': return 'published';
    case 'featured': return 'featured';
    case 'reserved': return 'reserved';
    case 'sold': return 'sold';
    default: return 'hidden'; // draft, on_hold, cancelled
  }
}

export function publicProperty(p, { full = true } = {}) {
  const media = all('SELECT id,kind,path,caption FROM media WHERE entity_type=? AND entity_id=? ORDER BY sort_order,id', 'property', p.id);
  const project = p.project_id ? get('SELECT id,code,name,location,dev_status FROM projects WHERE id=?', p.project_id) : null;
  const cover = media.find((m) => m.kind === 'cover') || media.find((m) => m.kind === 'gallery');
  const out = {
    id: p.id, code: p.code, title: p.title, purpose: p.purpose, property_type: p.property_type,
    price: p.net_price, total_price: p.total_price, discount: p.discount, currency: getSetting('currency', 'PKR'),
    area: p.area_size, unit: p.unit, city: p.city, area_name: p.area_name, location: p.location,
    block: p.block, plot_no: p.plot_no, lat: p.lat, lng: p.lng,
    installment_available: !!p.installment_available, ready_possession: !!p.ready_possession,
    status: websiteState(p), featured: p.status === 'featured', short_description: p.short_desc,
    cover_image: cover ? `/uploads/${cover.path}` : null,
    project: project ? { id: project.id, code: project.code, name: project.name } : null,
  };
  if (!full) return out;
  const agent = p.agent_id ? get('SELECT name FROM users WHERE id=?', p.agent_id) : null;
  return {
    ...out, description: p.description, features: jparse(p.features, {}), amenities: jparse(p.amenities, []),
    images: media.filter((m) => !['video', 'document'].includes(m.kind)).map((m) => ({ kind: m.kind, url: `/uploads/${m.path}`, caption: m.caption })),
    videos: jparse(p.videos, []),
    contact: { name: agent?.name ?? null, email: p.contact_email, phone: p.contact_phone, whatsapp: p.contact_whatsapp },
    updated_at: p.updated_at || p.created_at,
  };
}

/** The secret that signs webhook deliveries (never the API key, which the receiving site must not get). Made on first use. */
export function webhookSecret() {
  let s = getSetting('website_webhook_secret', '');
  if (!s) { s = `whsec_${crypto.randomBytes(24).toString('hex')}`; setSetting('website_webhook_secret', s); }
  return s;
}

/**
 * Signature headers for a webhook body: Agentify-Signature `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * The receiver recomputes the HMAC with its signing secret, compares in constant time and rejects old timestamps (replays).
 */
export function signWebhook(body, secret = webhookSecret(), at = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return { 'Agentify-Signature': `t=${at},v1=${v1}`, 'Agentify-Event-Id': crypto.randomUUID() };
}

const syncLog = (propertyId, event, status, response) => run('INSERT INTO sync_log(property_id,event,status,response,created_at) VALUES(?,?,?,?,?)', propertyId, event, status, String(response).slice(0, 300), now());

/** Optional push notification to the website. The site can also pull from /api/public. */
export function fireWebhook(propertyId, event) {
  const url = getSetting('website_webhook_url');
  const p = get('SELECT * FROM properties WHERE id=?', propertyId);
  if (!p) return;
  if (!url) {
    syncLog(propertyId, event, 'pull', `website_state=${websiteState(p)} (served via public API)`);
    return;
  }
  const body = JSON.stringify({ event, property: publicProperty(p) });
  const headers = { 'Content-Type': 'application/json', 'X-ERP-Event': event, ...signWebhook(body) };
  // checked at every delivery (not only when saved): only https, only public addresses, and redirects are not followed
  import('./integrations.js')
    .then(({ assertPublicHttps }) => assertPublicHttps(url))
    .then((safe) => fetch(safe, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(8000) }))
    .then((r) => syncLog(propertyId, event, r.ok ? 'ok' : 'error', `HTTP ${r.status}`))
    .catch((e) => syncLog(propertyId, event, 'error', e.message));
}
