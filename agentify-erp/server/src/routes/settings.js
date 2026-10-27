import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { snapshotCurrent } from '../services/backup.js';
import bcrypt from 'bcryptjs';
import { all, get, run, tx, getSetting, setSetting } from '../db.js';
import { assertEmailAllowed } from '../services/disposableEmail.js';
import { can, hasPerm, MODULES, ACTIONS, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { crud, uploader } from './helpers.js';
import { asyncH, bad, notFound, jparse, now } from '../util.js';
import { createInvite, pendingInvites, revokeInvite } from '../services/accessLinks.js';
import { assertSeatAvailable } from '../services/plans.js';
import { webhookSecret } from '../services/website.js';
import { cleanStaffPath } from '../services/staffLogin.js';
import { checkBrandColor } from '../../../shared/brandColor.js';

const r = Router();
r.use(requireStaff);

const SETTING_KEYS = ['company_name', 'company_address', 'company_phone', 'company_email', 'logo_url', 'currency', 'date_format',
  'default_commission_pct', 'agent_targets', 'website_webhook_url', 'website_api_key', 'notify_email_enabled', 'notify_sms_enabled',
  'notify_whatsapp_enabled', 'installment_reminder_days', 'allow_negative_bank',
  // printed documents (receipt vouchers, expense vouchers, statements)
  'print_header', 'print_footer', 'print_email', 'print_phone', 'print_address', 'print_website', 'print_social', 'print_show_logo',
  'receipt_title', 'receipt_header', 'receipt_footer', 'receipt_terms', 'receipt_copies', 'receipt_qr', 'expense_title', 'expense_header', 'expense_footer', 'agents_can_publish', 'staff_login_path', 'brand_color'];

/** Bootstrap data for dropdowns across the app. */
r.get('/meta', asyncH((req, res) => {
  const lookups = {};
  for (const l of all('SELECT * FROM lookups WHERE active=1 ORDER BY type, sort_order, id')) (lookups[l.type] ||= []).push({ ...l, meta: jparse(l.meta, {}) });
  const settings = {};
  const hidden = ['website_api_key', 'website_webhook_url', 'website_webhook_secret', ...(req.user.own_scope ? ['default_commission_pct'] : [])];
  for (const s of all('SELECT key,value FROM settings')) if (!hidden.includes(s.key)) settings[s.key] = s.value;
  res.json({
    lookups, settings,
    users: all(`SELECT u.id,u.name,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 ORDER BY u.name`),
    projects: all('SELECT id,code,name,kind FROM projects ORDER BY name'),
    accounts: ['accounting', 'payments', 'vendors'].some((m) => hasPerm(req.user, m, 'view'))
      ? all('SELECT id,code,name,type,subtype,parent_id FROM accounts WHERE active=1 ORDER BY code') : [],
    custom_fields: all('SELECT * FROM custom_fields ORDER BY sort_order,id').map((f) => ({ ...f, options: jparse(f.options, []) })),
    modules: MODULES, actions: ACTIONS,
  });
}));

// ---- System settings
r.get('/system', can('settings', 'view'), (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, '');
  out.website_webhook_secret = webhookSecret();
  res.json(out);
});
r.put('/system', can('settings', 'edit'), asyncH((req, res) => {
  // the API key only changes through "Regenerate" (a form saved with an older copy must not put the old key back)
  const url = req.body.website_webhook_url;
  if (url && !/^https:\/\/[^\s/?#]+\.[^\s]*$/i.test(String(url).trim())) throw bad('The webhook URL must be a full https:// address');
  if (req.body.brand_color !== undefined) {
    const c = checkBrandColor(req.body.brand_color);
    if (!c.ok) throw bad(c.error);
    req.body.brand_color = c.hex;
  }
  if (req.body.staff_login_path !== undefined) req.body.staff_login_path = cleanStaffPath(req.body.staff_login_path);
  for (const k of SETTING_KEYS) if (k !== 'website_api_key' && req.body[k] !== undefined) setSetting(k, k === 'website_webhook_url' ? String(req.body[k] || '').trim() : req.body[k]);
  if (req.body.print_social !== undefined) { const v = jparse(req.body.print_social, null); if (!Array.isArray(v)) throw bad('Social handles must be a list'); }
  if (req.body.agent_targets) { if (!jparse(req.body.agent_targets)) throw bad('Agent targets must be valid JSON'); }
  audit(req, 'Updated system settings', 'settings', null, Object.keys(req.body).join(', '));
  res.json({ ok: true });
}));
/** Company logo for printed receipts, vouchers and statements (public image, stored with listing media). */
const logoUp = uploader('media', 'image', 5);
r.post('/branding/logo', can('settings', 'edit'), logoUp.single('logo'), asyncH((req, res) => {
  if (!req.file) throw bad('Choose an image file');
  setSetting('print_logo', `media/${req.file.filename}`);
  audit(req, 'Updated company logo', 'settings');
  res.json({ print_logo: `media/${req.file.filename}` });
}));
r.delete('/branding/logo', can('settings', 'edit'), asyncH((req, res) => {
  setSetting('print_logo', '');
  audit(req, 'Removed company logo', 'settings');
  res.json({ ok: true });
}));
/** Logo shown at the top left of the workspace (separate from the print logo). PNG/JPG/WebP, up to 1 MB. */
const appLogoUp = uploader('media', 'image', 1);
r.post('/branding/app-logo', can('settings', 'edit'), appLogoUp.single('logo'), asyncH((req, res) => {
  if (!req.file) throw bad('Choose an image file');
  if (!/\.(png|jpe?g|webp)$/i.test(req.file.filename)) { fs.rm(req.file.path, { force: true }, () => {}); throw bad('Use a PNG, JPG or WebP logo'); }
  setSetting('brand_logo', `media/${req.file.filename}`);
  audit(req, 'Updated workspace logo', 'settings');
  res.json({ brand_logo: `media/${req.file.filename}` });
}));
r.delete('/branding/app-logo', can('settings', 'edit'), asyncH((req, res) => {
  setSetting('brand_logo', '');
  audit(req, 'Removed workspace logo', 'settings');
  res.json({ ok: true });
}));
r.post('/system/regenerate-api-key', can('settings', 'edit'), asyncH((req, res) => {
  const key = 'emd_' + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  setSetting('website_api_key', key);
  audit(req, 'Regenerated website API key', 'settings');
  res.json({ key });
}));

r.post('/system/regenerate-webhook-secret', can('settings', 'edit'), asyncH((req, res) => {
  setSetting('website_webhook_secret', '');
  const secret = webhookSecret();
  audit(req, 'Regenerated website webhook signing secret', 'settings');
  res.json({ secret });
}));

// ---- Users
r.get('/users', can('settings', 'view'), (req, res) => {
  res.json(all(`SELECT u.id,u.name,u.email,u.phone,u.active,u.role_id,r.name role,u.last_login,u.is_demo,u.created_at,u.totp_enabled,u.email_verified
    FROM users u JOIN roles r ON r.id=u.role_id WHERE r.portal=0 ORDER BY u.id`));
});
r.post('/users', can('settings', 'create'), asyncH(async (req, res) => {
  const { name, email, phone, password, role_id } = req.body;
  if (!name || !email || !role_id) throw bad('Name, email and role are required');
  await assertEmailAllowed(email);
  if (!password || String(password).length < 8) throw bad('Password must be at least 8 characters');
  if (get('SELECT id FROM users WHERE lower(email)=lower(?)', email)) throw bad('A user with this email already exists');
  const role = get('SELECT * FROM roles WHERE id=?', role_id);
  if (!role) throw bad('Role not found');
  assertSeatAvailable(req.tenant);
  if (role.name === 'Super Admin' && !req.user.isSuper) throw bad('Only a Super Admin can create Super Admins');
  const rr = run('INSERT INTO users(name,email,phone,password_hash,role_id,created_at) VALUES(?,?,?,?,?,?)', name, email, phone ?? null, bcrypt.hashSync(String(password), 10), role_id, now());
  audit(req, 'Created user', 'user', rr.lastInsertRowid, `${email} as ${role.name}`);
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));
// ---- Invitations (an emailed one-time link replaces choosing someone else's password)
r.get('/invites', can('settings', 'view'), (_req, res) => res.json(pendingInvites()));
r.post('/invites', can('settings', 'create'), asyncH(async (req, res) => {
  const { email, name, role_id } = req.body || {};
  const role = get('SELECT * FROM roles WHERE id=?', role_id);
  if (!role || role.portal) throw bad('Choose a staff role');
  if (role.name === 'Super Admin' && !req.user.isSuper) throw bad('Only a Super Admin can invite Super Admins');
  const inv = await createInvite(req, { email, name, roleId: role.id });
  audit(req, 'Invited user', 'user', null, `${String(email).toLowerCase()} as ${role.name}`);
  res.status(201).json(inv);
}));
r.delete('/invites/:id', can('settings', 'delete'), asyncH((req, res) => {
  if (!revokeInvite(Number(req.params.id))) throw notFound('Invitation not found');
  audit(req, 'Revoked invitation', 'user', req.params.id);
  res.json({ ok: true });
}));
/** The workspace's own database as a file (Super Admin only): a consistent copy that can be kept offline. Uploaded files are not in it. */
r.get('/backup', can('settings', 'edit'), asyncH((req, res) => {
  if (!req.user.isSuper) throw bad('Only a Super Admin can download a backup');
  const f = snapshotCurrent();
  audit(req, 'Downloaded a database backup', 'settings', null);
  res.download(f, `${(req.tenant?.slug || 'workspace')}-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rmSync(path.dirname(f), { recursive: true, force: true }));
}));
/** A locked-out colleague (lost phone and recovery codes): an admin switches their 2FA off so they can sign in and set it up again. */
r.post('/users/:id/2fa/reset', can('settings', 'edit'), asyncH((req, res) => {
  const u = get('SELECT id,email FROM users WHERE id=?', req.params.id);
  if (!u) throw bad('User not found');
  run('UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery_codes=NULL, token_version=token_version+1 WHERE id=?', u.id);
  audit(req, 'Reset two-factor sign-in', 'user', u.id, u.email);
  res.json({ ok: true });
}));
r.put('/users/:id', can('settings', 'edit'), asyncH((req, res) => {
  const u = get('SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', req.params.id);
  if (!u) throw notFound();
  const { name, email, phone, password, role_id, active } = req.body;
  if (u.role === 'Super Admin' && !req.user.isSuper) throw bad('Only a Super Admin can modify a Super Admin');
  if (u.id === req.user.id && active === false) throw bad('You cannot deactivate your own account');
  const newRole = role_id ? get('SELECT * FROM roles WHERE id=?', role_id) : null;
  if (newRole?.name === 'Super Admin' && !req.user.isSuper) throw bad('Only a Super Admin can grant Super Admin');
  if (active === true && !u.active) assertSeatAvailable(req.tenant); // reactivating takes a seat
  tx(() => {
    run(`UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone), role_id=COALESCE(?,role_id), active=COALESCE(?,active) WHERE id=?`,
      name ?? null, email ?? null, phone ?? null, role_id ?? null, active === undefined ? null : active ? 1 : 0, u.id);
    if (password) {
      if (String(password).length < 8) throw bad('Password must be at least 8 characters');
      run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(String(password), 10), u.id);
    }
    if (role_id || password || active === false) run('UPDATE users SET token_version=token_version+1 WHERE id=?', u.id);
    if (role_id && role_id !== u.role_id) audit(req, 'Changed user role', 'user', u.id, `${u.email}: ${u.role} → ${newRole.name}`);
    else audit(req, 'Edited user', 'user', u.id, u.email);
  });
  res.json({ ok: true });
}));

// ---- Roles & permissions
r.get('/roles', can('settings', 'view'), (req, res) => {
  res.json(all('SELECT * FROM roles WHERE portal=0 ORDER BY id').map((role) => ({
    ...role, perms: all('SELECT module,action FROM role_permissions WHERE role_id=?', role.id).map((p) => `${p.module}:${p.action}`),
    user_count: get('SELECT COUNT(*) n FROM users WHERE role_id=?', role.id).n,
  })));
});
function saveRole(id, body, req) {
  const perms = (body.perms || []).filter((p) => { const [m, a] = p.split(':'); return MODULES.includes(m) && ACTIONS.includes(a); });
  tx(() => {
    run('DELETE FROM role_permissions WHERE role_id=?', id);
    for (const p of perms) { const [m, a] = p.split(':'); run('INSERT INTO role_permissions(role_id,module,action) VALUES(?,?,?)', id, m, a); }
    run('UPDATE users SET token_version=token_version+1 WHERE role_id=?', id);
  });
  audit(req, 'Changed role permissions', 'role', id, `${body.name || ''}: ${perms.length} permissions`);
}
r.post('/roles', can('settings', 'create'), asyncH((req, res) => {
  if (!req.body.name) throw bad('Role name is required');
  const rr = run('INSERT INTO roles(name,description,own_scope) VALUES(?,?,?)', req.body.name, req.body.description ?? null, req.body.own_scope ? 1 : 0);
  saveRole(Number(rr.lastInsertRowid), req.body, req);
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));
r.put('/roles/:id', can('settings', 'edit'), asyncH((req, res) => {
  const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!role) throw notFound();
  if (role.name === 'Super Admin') throw bad('The Super Admin role always has full access and cannot be edited');
  run('UPDATE roles SET description=COALESCE(?,description), own_scope=COALESCE(?,own_scope) WHERE id=?', req.body.description ?? null, req.body.own_scope === undefined ? null : req.body.own_scope ? 1 : 0, role.id);
  saveRole(role.id, { ...req.body, name: role.name }, req);
  res.json({ ok: true });
}));
r.delete('/roles/:id', can('settings', 'delete'), asyncH((req, res) => {
  const role = get('SELECT * FROM roles WHERE id=?', req.params.id);
  if (!role) throw notFound();
  if (role.is_system) throw bad('Built-in roles cannot be deleted — you can only delete roles you created');
  const users = all('SELECT id FROM users WHERE role_id=?', role.id);
  const to = req.query.reassign_to ? get('SELECT * FROM roles WHERE id=? AND portal=0', req.query.reassign_to) : null;
  if (users.length && !to) throw bad(`${users.length} user(s) still have this role — choose a role to move them to`, { users: users.length });
  if (to && to.id === role.id) throw bad('Choose a different role');
  tx(() => {
    if (to) run('UPDATE users SET role_id=?, token_version=token_version+1 WHERE role_id=?', to.id, role.id);
    run('DELETE FROM role_permissions WHERE role_id=?', role.id);
    run('DELETE FROM roles WHERE id=?', role.id);
  });
  audit(req, 'Deleted role', 'role', role.id, `${role.name}${to ? ` (users moved to ${to.name})` : ''}`);
  res.json({ ok: true, moved: users.length });
}));

// ---- Lookups (stages, sources, property types, amenities, methods, categories ...)
const LOOKUP_TYPES = ['lead_stage', 'lead_source', 'lead_type', 'property_type', 'amenity', 'payment_method', 'expense_category', 'income_category',
  'vendor_category', 'department', 'designation', 'leave_type', 'document_category', 'dev_item_template', 'construction_activity', 'employment_type', 'asset_category'];
const lk = Router();
crud(lk, {
  table: 'lookups', module: 'settings', cols: ['type', 'value', 'color', 'meta', 'sort_order', 'active'], search: ['value'], filters: ['type'], json: ['meta'],
  orderBy: 'lookups.type, lookups.sort_order, lookups.id', required: ['type', 'value'], label: 'setting option',
  before: (d) => { if (d.type && !LOOKUP_TYPES.includes(d.type)) throw bad('Unknown option type'); },
  canDelete: (row) => {
    if (row.type === 'lead_stage' && get('SELECT 1 FROM contacts WHERE stage_id=?', row.id)) throw bad('Stage is used by contacts — deactivate it instead');
  },
});
r.use('/lookups', lk);

// ---- Custom fields
const cf = Router();
crud(cf, {
  table: 'custom_fields', module: 'settings', cols: ['entity', 'label', 'key', 'type', 'options', 'required', 'sort_order'], filters: ['entity'], json: ['options'],
  required: ['entity', 'label', 'key'], orderBy: 'custom_fields.sort_order, custom_fields.id', label: 'custom field',
  before: (d) => { if (d.key) d.key = String(d.key).toLowerCase().replace(/[^a-z0-9_]/g, '_'); },
});
r.use('/custom-fields', cf);

export default r;
