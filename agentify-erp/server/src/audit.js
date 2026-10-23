import { run, all, get, getSetting } from './db.js';
import { currentTenant } from './context.js';
import { sendMail, layout, mailReady } from './services/mailer.js';
import { now } from './util.js';
import { pushTo } from './services/push.js';

export function audit(req, action, entity, entityId, detail) {
  const u = req?.user;
  run('INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)',
    u?.id ?? null, u ? `${u.name} (${u.role})` : 'system', action, entity ?? null, entityId == null ? null : String(entityId),
    typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null, req?.ip ?? null, now());
}

/** Contact timeline entry. */
export function activity(contactId, user, action, { field, prev, next, detail, entityType, entityId } = {}) {
  const ts = now();
  run(`INSERT INTO activities(contact_id,entity_type,entity_id,user_id,user_name,action,field,prev_value,new_value,detail,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    contactId ?? null, entityType ?? null, entityId ?? null, user?.id ?? null, user?.name ?? 'System', action,
    field ?? null, prev ?? null, next ?? null, detail ?? null, ts);
  if (contactId) run('UPDATE contacts SET last_activity_at=? WHERE id=?', ts, contactId);
}

/** In-app notification (+ phone push when subscribed). `opts.dedupe` makes a notification once-only per user. */
export function notify(userIds, type, title, body, link, opts = {}) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  for (const id of ids) {
    const r = run('INSERT OR IGNORE INTO notifications(user_id,type,title,body,link,read,dedupe,created_at) VALUES(?,?,?,?,?,0,?,?)', id, type, title, body ?? null, link ?? null, opts.dedupe ?? null, now());
    if (r.changes) { pushTo(id, { title, body: body ?? '', url: link || '/' }); emailNotification(id, title, body, link); }
  }
}

// ---- e-mail copy of an in-app notification. Off unless the workspace switched it on; staff with a confirmed address only;
// at most five per person per ten minutes so an import or a bulk action never floods an inbox. Never throws into the caller.
const recent = new Map();
function emailNotification(userId, title, body, link) {
  try {
    const on = String(getSetting('notify_email_enabled') ?? '');
    if (!on || on === '0' || on === 'false' || !mailReady()) return;
    const u = get('SELECT u.email, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND u.email_verified=1 AND r.portal=0', userId);
    if (!u || !u.email) return;
    const t = Date.now(), list = (recent.get(userId) || []).filter((x) => t - x < 600_000);
    if (list.length >= 5) return;
    recent.set(userId, [...list, t]);
    const tenant = currentTenant(), base = process.env.ERP_BASE_DOMAIN;
    const origin = tenant && base ? `https://${tenant.custom_domain || `${tenant.slug}.${base}`}` : '';
    const url = link && origin ? `${origin}${String(link).startsWith('/') ? '' : '/'}${link}` : origin || null;
    sendMail({ type: 'notification', to: u.email, subject: title, ...layout({ heading: title, lines: [body || ''].filter(Boolean), button: url ? { label: 'Open in Agentify ERP', url } : undefined, footer: 'You receive this because e-mail notifications are switched on for your workspace (Settings, Notifications).' }) }).catch(() => {});
  } catch { /* a notification must never fail because of its e-mail */ }
}

/** Notify every active user whose role has a permission. */
export function notifyPerm(module, action, type, title, body, link) {
  const rows = all(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id
    LEFT JOIN role_permissions p ON p.role_id=r.id AND p.module=? AND p.action=?
    WHERE u.active=1 AND r.portal=0 AND (r.name='Super Admin' OR p.role_id IS NOT NULL)`, module, action);
  notify(rows.map((r) => r.id), type, title, body, link);
}
export const userName = (id) => (id ? get('SELECT name FROM users WHERE id=?', id)?.name : null);
