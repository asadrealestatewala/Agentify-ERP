// Brand groups: one owner runs several workspaces that share a logo and colours. Only the look is shared; each workspace keeps
// its own data, staff, clients, deals, fees and accounts. A workspace with no brand is independent, exactly as before.
// The brand's logo and primary colour are written into each member workspace's own settings (brand_logo / brand_color), so the
// app, receipts and emails use them with no extra lookups, and the workspace's Branding page shows them as set by the brand.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { platformDb, getTenant, withTenant } from '../platform.js';
import { setSetting } from '../db.js';
import { bad, notFound } from '../util.js';
import { isEmail } from '../validation.js';
import { checkBrandColor } from '../../../shared/brandColor.js';

const pdb = () => platformDb();
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_LOGO = 150_000; // characters of the data address; the console shrinks the image first
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

const members = (brandId) => pdb().prepare('SELECT id, slug, name, status, plan, owner_email FROM tenants WHERE brand_id=? ORDER BY id').all(brandId);
const present = (b) => b && {
  id: b.id, name: b.name, owner_email: b.owner_email || null, logo: b.logo || null, primary_color: b.primary_color || null, accent_color: b.accent_color || null,
  main_tenant_id: b.main_tenant_id || null, created_at: b.created_at, updated_at: b.updated_at,
  workspaces: members(b.id).map((t) => ({ ...t, main: t.id === b.main_tenant_id })),
};
export function getBrand(id) { return present(pdb().prepare('SELECT * FROM brands WHERE id=?').get(Number(id))); }
export const listBrands = () => pdb().prepare('SELECT * FROM brands ORDER BY name').all().map(present);

/** The brand a workspace belongs to, with the fields that lock its own Branding page; null for an independent workspace. */
export function brandOfTenant(tenantId) {
  const t = pdb().prepare('SELECT brand_id FROM tenants WHERE id=?').get(Number(tenantId));
  if (!t?.brand_id) return null;
  const b = pdb().prepare('SELECT id, name, logo, primary_color FROM brands WHERE id=?').get(t.brand_id);
  return b ? { id: b.id, name: b.name, locks_color: !!b.primary_color, locks_logo: !!b.logo } : null;
}

function clean(b, prev = {}) {
  const name = String(b.name ?? prev.name ?? '').trim();
  if (name.length < 2 || name.length > 80) throw bad('Give the brand a name of 2 to 80 characters');
  const owner = b.owner_email === undefined ? prev.owner_email || null : (String(b.owner_email || '').trim().toLowerCase() || null);
  if (owner && !isEmail(owner)) throw bad('Enter a valid owner email address');
  const colour = (v, label, was) => {
    if (v === undefined) return was || null;
    const c = checkBrandColor(v);
    if (!c.ok) throw bad(`${label}: ${c.error}`);
    return c.hex || null;
  };
  let logo = prev.logo || null;
  if (b.logo !== undefined) {
    logo = b.logo || null;
    if (logo && (!LOGO_RE.test(logo) || logo.length > MAX_LOGO)) throw bad('The logo must be a PNG, JPG or WebP image of about 100 KB or less');
  }
  return { name, owner_email: owner, logo, primary_color: colour(b.primary_color, 'Primary colour', prev.primary_color), accent_color: colour(b.accent_color, 'Accent colour', prev.accent_color) };
}

export function createBrand(b, by) {
  const v = clean(b);
  if (pdb().prepare('SELECT 1 FROM brands WHERE name=?').get(v.name)) throw bad('A brand with that name already exists');
  const id = Number(pdb().prepare('INSERT INTO brands(name, owner_email, logo, primary_color, accent_color, created_by, updated_at) VALUES(?,?,?,?,?,?,datetime(\'now\'))')
    .run(v.name, v.owner_email, v.logo, v.primary_color, v.accent_color, by || null).lastInsertRowid);
  return getBrand(id);
}

export function updateBrand(id, b) {
  const prev = pdb().prepare('SELECT * FROM brands WHERE id=?').get(Number(id));
  if (!prev) throw notFound('Brand not found');
  const v = clean(b, prev);
  const dup = pdb().prepare('SELECT id FROM brands WHERE name=? AND id<>?').get(v.name, prev.id);
  if (dup) throw bad('A brand with that name already exists');
  pdb().prepare("UPDATE brands SET name=?, owner_email=?, logo=?, primary_color=?, accent_color=?, updated_at=datetime('now') WHERE id=?")
    .run(v.name, v.owner_email, v.logo, v.primary_color, v.accent_color, prev.id);
  return { brand: getBrand(prev.id), sync: syncBrand(prev.id) };
}

/** Removing a brand frees its workspaces; they keep the logo and colour last applied and can change them again. */
export function deleteBrand(id) {
  const b = pdb().prepare('SELECT * FROM brands WHERE id=?').get(Number(id));
  if (!b) throw notFound('Brand not found');
  pdb().prepare('UPDATE tenants SET brand_id=NULL WHERE brand_id=?').run(b.id);
  pdb().prepare('DELETE FROM brands WHERE id=?').run(b.id);
  return { name: b.name };
}

/** Put a workspace in a brand (or take it out with brandId null) and apply the brand's look to it. */
export function assignTenant(tenantId, brandId) {
  const t = pdb().prepare('SELECT id, brand_id FROM tenants WHERE id=?').get(Number(tenantId));
  if (!t) throw notFound('Workspace not found');
  if (brandId == null || brandId === '') {
    if (t.brand_id) pdb().prepare('UPDATE brands SET main_tenant_id=NULL WHERE id=? AND main_tenant_id=?').run(t.brand_id, t.id);
    pdb().prepare('UPDATE tenants SET brand_id=NULL WHERE id=?').run(t.id);
    return { brand: null, sync: [] };
  }
  const b = pdb().prepare('SELECT id FROM brands WHERE id=?').get(Number(brandId));
  if (!b) throw notFound('Brand not found');
  if (t.brand_id && t.brand_id !== b.id) pdb().prepare('UPDATE brands SET main_tenant_id=NULL WHERE id=? AND main_tenant_id=?').run(t.brand_id, t.id);
  pdb().prepare('UPDATE tenants SET brand_id=? WHERE id=?').run(b.id, t.id);
  return { brand: getBrand(b.id), sync: syncBrand(b.id, [t.id]) };
}

export function setMain(brandId, tenantId) {
  const b = pdb().prepare('SELECT id FROM brands WHERE id=?').get(Number(brandId));
  if (!b) throw notFound('Brand not found');
  if (tenantId != null && !pdb().prepare('SELECT 1 FROM tenants WHERE id=? AND brand_id=?').get(Number(tenantId), b.id)) throw bad('Choose one of the brand\'s own workspaces as the main workspace');
  pdb().prepare("UPDATE brands SET main_tenant_id=?, updated_at=datetime('now') WHERE id=?").run(tenantId == null ? null : Number(tenantId), b.id);
  return getBrand(b.id);
}

/** Write the brand's logo and colour into member workspaces' own settings. One failing workspace never stops the rest. */
export function syncBrand(brandId, only = null) {
  const b = pdb().prepare('SELECT * FROM brands WHERE id=?').get(Number(brandId));
  if (!b) return [];
  const logo = b.logo ? LOGO_RE.exec(b.logo) : null;
  const out = [];
  for (const m of members(b.id)) {
    if (only && !only.includes(m.id)) continue;
    try {
      const t = getTenant(m.id);
      withTenant(t, () => {
        if (b.primary_color) setSetting('brand_color', b.primary_color);
        if (logo) {
          const buf = Buffer.from(logo[2], 'base64');
          const dir = path.join(t.upload_dir, 'media');
          fs.mkdirSync(dir, { recursive: true });
          const file = `brand-${b.id}-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10)}.${EXT[logo[1]]}`;
          for (const old of fs.readdirSync(dir).filter((f) => f.startsWith(`brand-${b.id}-`) && f !== file)) fs.rmSync(path.join(dir, old), { force: true });
          fs.writeFileSync(path.join(dir, file), buf);
          setSetting('brand_logo', `media/${file}`);
        }
      });
      out.push({ tenant_id: m.id, ok: true });
    } catch (e) { out.push({ tenant_id: m.id, ok: false, error: e.message }); }
  }
  return out;
}

/** Read-only roll-up across a brand's workspaces. `summaries` are the console's workspace rows (with stats); nothing is shared between them. */
export function rollup(brandId, summaries) {
  const ids = new Set(members(brandId).map((m) => m.id));
  const rows = summaries.filter((s) => ids.has(s.id));
  const sum = (k) => rows.reduce((n, r) => n + (r.stats?.[k] || 0), 0);
  return {
    workspaces: rows.length, active: rows.filter((r) => r.status === 'active').length, paying: rows.filter((r) => r.subscription_status === 'active').length,
    seats: sum('seats'), properties: sum('properties'), contacts: sum('contacts'), sales: sum('sales'), receipts: sum('receipts'),
    last_activity: rows.map((r) => r.stats?.last_activity).filter(Boolean).sort().pop() || null,
  };
}

/** Whether a colour or logo change by the workspace itself is blocked because its brand sets it. */
export function lockMessage(tenantId, what) {
  const b = brandOfTenant(tenantId);
  if (!b) return null;
  if (what === 'color' && b.locks_color) return `The colour is set by your brand group "${b.name}". Ask the brand owner to change it.`;
  if (what === 'logo' && b.locks_logo) return `The logo is set by your brand group "${b.name}". Ask the brand owner to change it.`;
  return null;
}
