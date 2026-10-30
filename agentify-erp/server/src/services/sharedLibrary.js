// Shared template library: reusable wording kept once for the whole platform (contract templates, clauses, brochure layouts, email
// templates). Every workspace reads the active items by default; a workspace can replace an item with its own text, which only that
// workspace sees. A workspace's effective set is the library with its own versions substituted.
import { platformDb } from '../platform.js';
import { bad, notFound } from '../util.js';

const pdb = () => platformDb();
export const LIBRARY_TYPES = {
  contract_template: 'Contract template',
  clause: 'Standard clause',
  brochure_layout: 'Brochure layout',
  email_template: 'Email template',
};
const MAX_CONTENT = 50_000;

function fields(b, prev = {}) {
  const type = b.type ?? prev.type;
  if (!LIBRARY_TYPES[type]) throw bad('Choose what kind of item this is');
  const title = String(b.title ?? prev.title ?? '').trim();
  if (title.length < 2 || title.length > 140) throw bad('Give the item a title of 2 to 140 characters');
  const content = String(b.content ?? prev.content ?? '');
  if (!content.trim()) throw bad('The item needs some text');
  if (content.length > MAX_CONTENT) throw bad(`The text is too long (${MAX_CONTENT.toLocaleString()} characters at most)`);
  return { type, title, content };
}

export const getItem = (id) => pdb().prepare('SELECT * FROM library_items WHERE id=?').get(Number(id));

export function listItems() {
  return pdb().prepare(`SELECT i.*, (SELECT COUNT(*) FROM workspace_library_overrides o WHERE o.library_item_id=i.id) overrides
    FROM library_items i ORDER BY i.status, i.type, i.title`).all();
}

export function createItem(b, by) {
  const v = fields(b);
  const id = Number(pdb().prepare('INSERT INTO library_items(type, title, content, created_by, updated_by) VALUES(?,?,?,?,?)').run(v.type, v.title, v.content, by || null, by || null).lastInsertRowid);
  return getItem(id);
}

/** An edit of the wording is a new version, so workspaces that replaced the item can see the shared text has moved on. */
export function updateItem(id, b, by) {
  const prev = getItem(id);
  if (!prev) throw notFound('Library item not found');
  const v = fields(b, prev);
  const changed = v.content !== prev.content || v.title !== prev.title || v.type !== prev.type;
  if (changed) pdb().prepare("UPDATE library_items SET type=?, title=?, content=?, version=version+1, updated_by=?, updated_at=datetime('now') WHERE id=?").run(v.type, v.title, v.content, by || null, prev.id);
  return getItem(prev.id);
}

export function setStatus(id, status, by) {
  if (!getItem(id)) throw notFound('Library item not found');
  pdb().prepare("UPDATE library_items SET status=?, updated_by=?, updated_at=datetime('now') WHERE id=?").run(status === 'retired' ? 'retired' : 'active', by || null, Number(id));
  return getItem(id);
}

/** What one workspace sees: active items, each with the workspace's own version substituted when it has one. */
export function effectiveFor(tenantId) {
  const rows = pdb().prepare(`SELECT i.id, i.type, i.title, i.content AS shared_content, i.version, i.updated_at, o.override_content, o.base_version, o.updated_at AS override_updated_at
    FROM library_items i LEFT JOIN workspace_library_overrides o ON o.library_item_id=i.id AND o.tenant_id=? WHERE i.status='active' ORDER BY i.type, i.title`).all(Number(tenantId));
  return rows.map((r) => ({
    id: r.id, type: r.type, type_label: LIBRARY_TYPES[r.type], title: r.title, version: r.version, updated_at: r.updated_at,
    overridden: r.override_content != null, content: r.override_content ?? r.shared_content, shared_content: r.shared_content,
    // the shared text was edited after this workspace made its own copy
    shared_changed: r.override_content != null && r.version > (r.base_version || 1),
  }));
}

export function setOverride(tenantId, itemId, content, by) {
  const item = getItem(itemId);
  if (!item || item.status !== 'active') throw notFound('Library item not found');
  const text = String(content ?? '');
  if (!text.trim()) throw bad('The text cannot be empty. To go back to the shared wording, choose "Use the shared version".');
  if (text.length > MAX_CONTENT) throw bad(`The text is too long (${MAX_CONTENT.toLocaleString()} characters at most)`);
  pdb().prepare(`INSERT INTO workspace_library_overrides(tenant_id, library_item_id, override_content, base_version, updated_by, updated_at) VALUES(?,?,?,?,?,datetime('now'))
    ON CONFLICT(tenant_id, library_item_id) DO UPDATE SET override_content=excluded.override_content, base_version=excluded.base_version, updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run(Number(tenantId), item.id, text, item.version, by || null);
  return effectiveFor(tenantId).find((x) => x.id === item.id);
}

export function clearOverride(tenantId, itemId) {
  pdb().prepare('DELETE FROM workspace_library_overrides WHERE tenant_id=? AND library_item_id=?').run(Number(tenantId), Number(itemId));
  return effectiveFor(tenantId).find((x) => x.id === Number(itemId)) || null;
}

/** For the platform owner: which workspaces replaced which items, and whether the shared text has moved on since. */
export function driftReport() {
  return pdb().prepare(`SELECT i.id AS item_id, i.title, i.type, i.version, i.status, t.id AS tenant_id, t.name AS workspace, t.slug, o.base_version, o.updated_at
    FROM workspace_library_overrides o JOIN library_items i ON i.id=o.library_item_id JOIN tenants t ON t.id=o.tenant_id ORDER BY i.title, t.name`).all()
    .map((r) => ({ ...r, type_label: LIBRARY_TYPES[r.type], behind: r.version > (r.base_version || 1) }));
}
