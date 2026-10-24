import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable, { SearchBar, useTable } from '../components/DataTable.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { NotificationCentre } from '../components/Notifications.jsx';
import { Card, Check, ConfirmDialog, DateRangeFilter, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge, Tabs, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useMeta, useToast } from '../context.jsx';
import PushToggle from '../components/Push.jsx';
import Icon from '../components/Icon.jsx';
import { dateTime, titleCase, cur, money } from '../format.js';

// ---------------------------------------------------------------- Users
export function Users() {
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/settings/users');
  const roles = useFetch('/api/settings/roles');
  const invites = useFetch('/api/settings/invites');
  const [edit, setEdit] = useState(null);
  const [invite, setInvite] = useState(null);
  const [sentLink, setSentLink] = useState(null);
  const roleOpts = (roles.data || []).map((r) => ({ value: r.id, label: r.name }));
  const staffRoleOpts = (roles.data || []).filter((r) => !r.portal).map((r) => ({ value: r.id, label: r.name }));
  return (
    <div>
      <PageHead title="Users" sub="Staff accounts and their roles">{can('settings', 'create') && <><button className="btn" onClick={() => setInvite({ role_id: (roles.data || []).find((r) => r.name === 'Sales Agent')?.id })}>Invite by email</button><button className="btn primary" onClick={() => setEdit({ active: true })}>Add user</button></>}</PageHead>
      <Card flush>
        {!data ? <Loading /> : <table className="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((u) => <tr key={u.id}><td className="cell-main">{u.name}{u.is_demo ? <span className="demo-chip">DEMO</span> : null}</td><td>{u.email}</td><td><span className="tag">{u.role}</span></td><td>{u.last_login ? dateTime(u.last_login) : 'Never'}</td><td><StatusBadge status={u.active ? 'active' : 'inactive'} /></td>
            <td className="right nowrap">{can('settings', 'edit') && u.totp_enabled ? <button className="btn sm" title="For someone who lost their phone and recovery codes" onClick={async () => { if (!window.confirm(`Turn off two-factor sign-in for ${u.name}? They will be signed out and can set it up again.`)) return; try { await api.post(`/api/settings/users/${u.id}/2fa/reset`); reload(); toast('Two-factor sign-in reset', 'ok'); } catch (e) { toast(e.message, 'err'); } }}>Reset 2FA</button> : null}{' '}{can('settings', 'edit') && <button className="btn sm" onClick={() => setEdit({ ...u, password: '' })}>Edit</button>}</td></tr>)}</tbody></table>}
      </Card>
      {invites.data?.length > 0 && (
        <Card title="Pending invitations" flush>
          <table className="t"><thead><tr><th>Email</th><th>Role</th><th>Invited by</th><th>Expires</th><th /></tr></thead>
            <tbody>{invites.data.map((i) => <tr key={i.id}><td className="cell-main">{i.email}</td><td><span className="tag">{i.role}</span></td><td>{i.invited_by}</td><td>{dateTime(i.expires_at)}</td>
              <td className="right">{can('settings', 'delete') && <button className="btn sm" onClick={async () => { try { await api.del(`/api/settings/invites/${i.id}`); invites.reload(); toast('Invitation revoked', 'ok'); } catch (e) { toast(e.message, 'err'); } }}>Revoke</button>}</td></tr>)}</tbody></table>
        </Card>
      )}
      {invite && <FormModal title="Invite a team member" size="sm" initial={invite}
        fields={[{ name: 'email', label: 'Email', type: 'email', required: true }, { name: 'name', label: 'Name (optional)', person: true }, { name: 'role_id', label: 'Role', type: 'select', number: true, required: true, options: staffRoleOpts, allowEmpty: false }]}
        onClose={() => setInvite(null)} onSave={async (f) => { const r = await api.post('/api/settings/invites', f); setInvite(null); invites.reload(); setSentLink({ email: f.email, ...r }); }} />}
      {sentLink && (
        <Modal title="Invitation created" size="sm" onClose={() => setSentLink(null)} footer={<button className="btn primary" onClick={() => setSentLink(null)}>Done</button>}>
          <div className="stack">
            <div>{sentLink.email_sent ? <>We emailed <b>{sentLink.email}</b>.</> : <>Email delivery is not set up on this server, so share the link yourself.</>} It works once and expires in {sentLink.expires_in_days} days.</div>
            <input className="input" readOnly value={sentLink.link} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(sentLink.link); toast('Link copied', 'ok'); }}>Copy link</button>
          </div>
        </Modal>
      )}
      {edit && <FormModal title={edit.id ? 'Edit user' : 'Add user'} size="sm" initial={edit}
        fields={[{ name: 'name', label: 'Full name', required: true, person: true }, { name: 'email', label: 'Email (login)', type: 'email', required: true }, { name: 'phone', label: 'Phone' }, { name: 'role_id', label: 'Role', type: 'select', number: true, required: true, options: roleOpts, allowEmpty: false },
          { name: 'password', label: edit.id ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !edit.id, hint: 'Minimum 8 characters' }, ...(edit.id && edit.id !== user.id ? [{ name: 'active', label: 'Account active', type: 'bool' }] : [])]}
        onClose={() => setEdit(null)} onSave={async (f) => { const body = { ...f, active: f.active === undefined ? undefined : !!f.active }; if (!body.password) delete body.password; if (edit.id) await api.put(`/api/settings/users/${edit.id}`, body); else await api.post('/api/settings/users', body); setEdit(null); reload(); toast('Saved', 'ok'); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Roles & permissions
export function Roles() {
  const { meta } = useMeta();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/settings/roles');
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [moveTo, setMoveTo] = useState('');
  const role = (data || []).find((r) => r.id === sel);
  useEffect(() => { if (data && !sel) setSel(data[0]?.id); }, [data, sel]);
  useEffect(() => { if (role) setPerms(new Set(role.perms)); }, [role?.id, data]); // eslint-disable-line
  if (!meta || !data) return <Loading />;
  const mods = meta.modules, acts = meta.actions;
  const isSuper = role?.name === 'Super Admin';
  const toggle = (m, a) => setPerms((s) => { const n = new Set(s); const k = `${m}:${a}`; n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleRow = (m) => setPerms((s) => { const n = new Set(s); const all = acts.every((a) => n.has(`${m}:${a}`)); acts.forEach((a) => (all ? n.delete(`${m}:${a}`) : n.add(`${m}:${a}`))); return n; });
  return (
    <div>
      <PageHead title="Roles & permissions" sub="View · Create · Edit · Delete · Approve · Export · Print — per module">{can('settings', 'create') && <button className="btn primary" onClick={() => setCreating(true)}>Add role</button>}</PageHead>
      <div className="grid" style={{ gridTemplateColumns: '240px minmax(0,1fr)', alignItems: 'start' }}>
        <Card flush><div style={{ padding: 6 }}>{data.map((r) => <button key={r.id} className={`role-item ${r.id === sel ? 'active' : ''}`} onClick={() => setSel(r.id)}>{r.name}{r.own_scope ? <span className="tag" style={{ marginLeft: 'auto' }}>own records</span> : null}{!r.is_system && !r.own_scope ? <span className="tag" style={{ marginLeft: 'auto' }}>custom</span> : null}</button>)}</div></Card>
        {role && (
          <Card title={role.name} actions={<>{can('settings', 'delete') && !role.is_system && <button className="btn danger sm" onClick={() => { setMoveTo(''); setDeleting(role); }}><Icon name="trash" size={13} />Delete role</button>}{can('settings', 'edit') && !isSuper && <button className="btn primary sm" onClick={async () => { try { await api.put(`/api/settings/roles/${role.id}`, { perms: [...perms], own_scope: role.own_scope }); toast('Permissions saved — signed-in users of this role will re-authenticate', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } }}>Save permissions</button>}</>} flush>
            <div style={{ padding: '10px 16px' }} className="muted">{role.description}{role.own_scope ? ' · Row access is limited to the user’s own leads, customers, sales and commission.' : ''}{isSuper ? ' · Super Admin always has full access.' : ''}</div>
            <div className="table-wrap"><table className="t"><thead><tr><th>Module</th>{acts.map((a) => <th key={a} className="center" style={{ textTransform: 'capitalize' }}>{a}</th>)}<th /></tr></thead>
              <tbody>{mods.map((m) => <tr key={m}><td className="cell-main" style={{ textTransform: 'capitalize' }}>{m}</td>{acts.map((a) => <td key={a} className="center"><input type="checkbox" aria-label={`${m} ${a}`} checked={isSuper || perms.has(`${m}:${a}`)} disabled={isSuper || !can('settings', 'edit')} onChange={() => toggle(m, a)} /></td>)}
                <td><button className="btn sm ghost" disabled={isSuper || !can('settings', 'edit')} onClick={() => toggleRow(m)}>All</button></td></tr>)}</tbody></table></div>
          </Card>
        )}
      </div>
      {deleting && (
        <Modal title={`Delete role “${deleting.name}”`} size="sm" onClose={() => setDeleting(null)}
          footer={<><button className="btn" onClick={() => setDeleting(null)}>Cancel</button><button className="btn danger" disabled={deleting.user_count > 0 && !moveTo}
            onClick={async () => { try { await api.del(`/api/settings/roles/${deleting.id}${moveTo ? `?reassign_to=${moveTo}` : ''}`); toast('Role deleted', 'ok'); setDeleting(null); setSel(null); reload(); } catch (e) { toast(e.message, 'err'); } }}>Delete role</button></>}>
          <div className="stack">
            {deleting.user_count > 0 ? (<>
              <div className="alert warn"><b>{deleting.user_count} user{deleting.user_count === 1 ? '' : 's'}</b> currently {deleting.user_count === 1 ? 'has' : 'have'} this role. Choose a role to move {deleting.user_count === 1 ? 'them' : 'them'} to — they will be signed out and sign back in with the new permissions.</div>
              <Field label="Move users to" required><Select value={moveTo} onChange={setMoveTo} placeholder="Choose a role…" options={data.filter((r) => r.id !== deleting.id).map((r) => ({ value: r.id, label: r.name }))} /></Field>
            </>) : <div>No users have this role. This cannot be undone.</div>}
          </div>
        </Modal>)}
      {creating && <FormModal title="Add role" size="sm" fields={[{ name: 'name', label: 'Role name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'own_scope', label: 'Restrict to own records (like Sales Agent)', type: 'bool', full: true }]}
        onClose={() => setCreating(false)} onSave={async (f) => { const r = await api.post('/api/settings/roles', { ...f, own_scope: !!f.own_scope, perms: [] }); setCreating(false); await reload(); setSel(r.id); toast('Role created — now tick its permissions', 'ok'); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Lookups
export function LookupSettings({ type, title, sub, color, metaFields = [] }) {
  const names = metaFields.map((m) => m.name);
  return (
    <ResourcePage title={title} sub={sub} endpoint="/api/settings/lookups" module="settings" noun="option" tableId={`lk-${type}`} filters={{ type }} limit={100}
      fields={[{ name: 'value', label: 'Name', required: true }, ...(color ? [{ name: 'color', label: 'Colour', type: 'color' }] : []), { name: 'sort_order', label: 'Order', type: 'number' }, ...metaFields, { name: 'active', label: 'Active', type: 'bool' }]}
      defaults={{ type, active: 1, sort_order: 10, color: '#2563eb' }}
      toForm={(r) => ({ ...r, ...(r.meta || {}) })}
      transformSave={(f) => ({ type, value: f.value, color: f.color, sort_order: f.sort_order, active: f.active ? 1 : 0, meta: { ...(f.meta || {}), ...Object.fromEntries(names.map((n) => [n, f[n]])) } })}
      columns={[{ key: 'value', label: 'Name', render: (r) => <span className="row">{color && <span style={{ width: 12, height: 12, borderRadius: 3, background: r.color || '#94a3b8' }} />}<b>{r.value}</b></span> }, { key: 'sort_order', label: 'Order', num: true }, { key: 'meta', label: 'Details', render: (r) => Object.entries(r.meta || {}).map(([k, v]) => <span key={k} className="tag">{k}: {String(v)}</span>) }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }]} />
  );
}

export function LeadStages() {
  const toast = useToast();
  const { reload } = useMeta();
  return (
    <ResourcePage title="Lead stages" sub="Configure the pipeline. Colours are shown on badges and the Kanban board." endpoint="/api/settings/lookups" module="settings" noun="stage" tableId="lk-stages" filters={{ type: 'lead_stage' }} sort="sort_order" dir="asc" limit={50}
      fields={[{ name: 'value', label: 'Stage name', required: true }, { name: 'color', label: 'Colour', type: 'color' }, { name: 'sort_order', label: 'Order', type: 'number' },
        { name: 'kind', label: 'Meaning', type: 'select', options: [{ value: 'new', label: 'New' }, { value: 'open', label: 'In progress' }, { value: 'lost', label: 'Lost (counts as lost lead)' }, { value: 'won', label: 'Won (set when a sale closes)' }], allowEmpty: false }, { name: 'active', label: 'Active', type: 'bool' }]}
      defaults={{ active: 1, sort_order: 50, color: '#6366f1', kind: 'open' }}
      transformSave={(f) => ({ type: 'lead_stage', value: f.value, color: f.color, sort_order: f.sort_order, active: f.active ? 1 : 0, id: undefined, meta: { kind: f.kind } })}
      toForm={(r) => ({ ...r, kind: r.meta?.kind || 'open' })}
      columns={[{ key: 'value', label: 'Stage', render: (r) => <span className="pill" style={{ background: (r.color || '#94a3b8') + '1f', color: r.color }}><i />{r.value}</span> }, { key: 'sort_order', label: 'Order', num: true }, { key: 'kind', label: 'Meaning', render: (r) => r.meta?.kind || '—' }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }]} />
  );
}

export function PropertySettings() {
  const [tab, setTab] = useState('property_type');
  const tabs = [['property_type', 'Property types'], ['amenity', 'Amenities']];
  return (
    <div>
      <PageHead title="Property settings" sub="Custom property types and amenities used on listings" />
      <div className="top-tabs">{tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      <LookupSettings key={tab} type={tab} title={tabs.find((t) => t[0] === tab)[1]} />
    </div>
  );
}

export function CategorySettings() {
  const [tab, setTab] = useState('expense_category');
  const tabs = [['expense_category', 'Expense categories'], ['income_category', 'Income categories'], ['vendor_category', 'Vendor categories'], ['department', 'Departments'], ['designation', 'Designations'], ['lead_source', 'Lead sources'], ['lead_type', 'Lead types'], ['leave_type', 'Leave types'], ['document_category', 'Document categories']];
  return (
    <div>
      <PageHead title="Categories & lists" sub="Reference lists used across forms" />
      <div className="top-tabs">{tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      <LookupSettings key={tab} type={tab} title={tabs.find((t) => t[0] === tab)[1]} metaFields={tab === 'leave_type' ? [{ name: 'quota', label: 'Annual quota (days, 0 = unlimited)', type: 'number' }] : []} />
    </div>
  );
}

const PM_KINDS = ['Cash', 'Bank', 'Wallet', 'Online', 'Cheque', 'Other'];
export function PaymentMethods() {
  const bank = (f) => f.kind === 'Bank', acct = (f) => ['Bank', 'Wallet', 'Online'].includes(f.kind);
  const META = ['kind', 'bank_name', 'account_title', 'account_number', 'iban', 'branch', 'swift', 'wallet_number', 'instructions'];
  return (
    <ResourcePage title="Payment methods" sub="Methods available on receipts and vouchers. Bank and wallet details here are shown to customers in their portal under “How to pay”." endpoint="/api/settings/lookups" module="settings" noun="payment method" tableId="lk-payment_method" filters={{ type: 'payment_method' }} limit={100}
      fields={[{ name: 'value', label: 'Method name', required: true, placeholder: 'e.g. Meezan Bank — Main account' }, { name: 'kind', label: 'Type', type: 'select', options: PM_KINDS, allowEmpty: false }, { name: 'sort_order', label: 'Order', type: 'number' },
        { name: 'bank_name', label: 'Bank name', showIf: bank }, { name: 'account_title', label: 'Account title', showIf: acct }, { name: 'account_number', label: 'Account number', showIf: bank }, { name: 'iban', label: 'IBAN', showIf: bank },
        { name: 'branch', label: 'Branch / branch code', showIf: bank }, { name: 'swift', label: 'SWIFT / BIC (optional)', showIf: bank }, { name: 'wallet_number', label: 'Wallet / mobile number', showIf: (f) => f.kind === 'Wallet' },
        { name: 'instructions', label: 'Instructions for the payer', type: 'textarea', full: true, hint: 'e.g. “Send the slip on WhatsApp after paying.”' }, { name: 'active', label: 'Active', type: 'bool' }]}
      defaults={{ type: 'payment_method', active: 1, sort_order: 10, kind: 'Bank' }}
      toForm={(r) => ({ ...r, ...(r.meta || {}), kind: r.meta?.kind || (r.value === 'Cash' ? 'Cash' : 'Other') })}
      transformSave={(f) => ({ type: 'payment_method', value: f.value, sort_order: f.sort_order, active: f.active ? 1 : 0, meta: Object.fromEntries(META.map((k) => [k, f[k]]).filter(([k, v]) => v !== undefined && v !== '' && (k === 'kind' || k === 'instructions' || (bank(f) || (k === 'account_title' && acct(f)) || (k === 'wallet_number' && f.kind === 'Wallet'))))) })}
      columns={[{ key: 'value', label: 'Method', render: (r) => <b>{r.value}</b> }, { key: 'kind', label: 'Type', render: (r) => r.meta?.kind || '—' },
        { key: 'details', label: 'Account details', render: (r) => { const m = r.meta || {}; const parts = [m.bank_name, m.account_title, m.account_number && `A/c ${m.account_number}`, m.iban && `IBAN ${m.iban}`, m.wallet_number && `Wallet ${m.wallet_number}`, m.branch].filter(Boolean); return parts.length ? <span style={{ fontSize: 12.5 }}>{parts.join(' · ')}</span> : <span className="muted">—</span>; } },
        { key: 'sort_order', label: 'Order', num: true }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }]} />
  );
}

export function CustomFields() {
  return (
    <ResourcePage title="Custom fields" sub="Extra fields that appear on the Add Contact form and the contact workspace" endpoint="/api/settings/custom-fields" module="settings" noun="field" tableId="custom-fields"
      fields={[{ name: 'entity', label: 'Applies to', type: 'select', options: ['contact'], allowEmpty: false }, { name: 'label', label: 'Label', required: true }, { name: 'key', label: 'Key (letters, numbers, underscore)', required: true }, { name: 'type', label: 'Type', type: 'select', options: ['text', 'number', 'date', 'select', 'checkbox', 'textarea'], allowEmpty: false },
        { name: 'optionsText', label: 'Options (comma-separated, for "select")', showIf: (f) => f.type === 'select', full: true }, { name: 'required', label: 'Required', type: 'bool' }, { name: 'sort_order', label: 'Order', type: 'number' }]}
      defaults={{ entity: 'contact', type: 'text', sort_order: 10 }} toForm={(r) => ({ ...r, optionsText: (r.options || []).join(', ') })}
      transformSave={(f) => ({ entity: f.entity, label: f.label, key: f.key, type: f.type, required: f.required ? 1 : 0, sort_order: f.sort_order, options: f.type === 'select' ? String(f.optionsText || '').split(',').map((s) => s.trim()).filter(Boolean) : [] })}
      columns={[{ key: 'label', label: 'Label', render: (r) => <b>{r.label}</b> }, { key: 'key', label: 'Key' }, { key: 'type', label: 'Type' }, { key: 'entity', label: 'Entity' }, { key: 'required', label: 'Required', render: (r) => (r.required ? 'Yes' : '') }]} />
  );
}

export function CommissionRules() {
  const { projects, list } = useLookups();
  return (
    <ResourcePage title="Commission rules" sub="Most specific rule wins: property → project → property type → general. Falls back to the default % in System settings." endpoint="/api/commission-rules" module="settings" noun="rule" tableId="comm-rules"
      fields={[{ name: 'name', label: 'Rule name', required: true }, { name: 'type', label: 'Type', type: 'select', options: [{ value: 'percentage', label: 'Percentage of sale' }, { value: 'fixed', label: 'Fixed amount' }, { value: 'tier', label: 'Tier-based (by sale value)' }], allowEmpty: false },
        { name: 'value', label: `Value (% or ${cur()})`, type: 'number', hint: 'For tier rules this is the fallback %' }, { name: 'project_id', label: 'Only for project', type: 'select', number: true, options: projects.map((p) => ({ value: p.id, label: p.name })) }, { name: 'sale_kind', label: 'Only for', type: 'select', options: [{ value: 'property', label: 'Property sales' }, { value: 'construction', label: 'Construction contracts' }], placeholder: 'All sales' }, { name: 'property_type', label: 'Only for property type', type: 'select', lookup: 'property_type' },
        { name: 'tiersText', label: 'Tiers: min:max:rate per line (e.g. 0:5000000:1.5)', type: 'textarea', showIf: (f) => f.type === 'tier', full: true }, { name: 'active', label: 'Active', type: 'bool' }]}
      defaults={{ type: 'percentage', value: 2, active: 1 }} toForm={(r) => ({ ...r, tiersText: (r.tiers || []).map((t) => `${t.min}:${t.max ?? ''}:${t.rate}`).join('\n') })}
      transformSave={(f) => ({ name: f.name, type: f.type, value: Number(f.value) || 0, project_id: f.project_id || null, property_type: f.property_type || null, sale_kind: f.sale_kind || null, active: f.active ? 1 : 0,
        tiers: f.type === 'tier' ? String(f.tiersText || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [min, max, rate] = l.split(':'); return { min: Number(min), max: max === '' ? null : Number(max), rate: Number(rate) }; }) : [] })}
      columns={[{ key: 'name', label: 'Rule', render: (r) => <b>{r.name}</b> }, { key: 'type', label: 'Type' }, { key: 'value', label: 'Value', render: (r) => (r.type === 'fixed' ? money(r.value) : `${r.value}%`) }, { key: 'project_id', label: 'Scope', render: (r) => [r.sale_kind && (r.sale_kind === 'construction' ? 'Construction' : 'Property'), projects.find((p) => p.id === r.project_id)?.name || r.property_type].filter(Boolean).join(' · ') || 'All sales' }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }]} />
  );
}

// ---------------------------------------------------------------- System settings
export function SystemSettings() {
  const toast = useToast();
  const { reload } = useMeta();
  const { can } = useAuth();
  const { data, reload: rl } = useFetch('/api/settings/system');
  const [f, setF] = useState(null);
  const [key, setKey] = useState(null);
  const [secret, setSecret] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ro = !can('settings', 'edit');
  const apiKey = key || f.website_api_key;
  const hookSecret = secret || f.website_webhook_secret;
  const base = window.location.origin;
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead title="System settings"><button className="btn primary" disabled={saving || ro} onClick={async () => { setSaving(true); try { await api.put('/api/settings/system', f); toast('Settings saved', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setSaving(false); } }}>Save settings</button></PageHead>
      <div className="stack">
        <Card title="Company"><div className="form-grid">
          <Field label="Company name"><input className="input" disabled={ro} value={f.company_name || ''} onChange={(e) => set('company_name', e.target.value)} /></Field>
          <Field label="Logo URL"><input className="input" disabled={ro} value={f.logo_url || ''} onChange={(e) => set('logo_url', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" disabled={ro} value={f.company_phone || ''} onChange={(e) => set('company_phone', e.target.value)} /></Field>
          <Field label="Email"><input className="input" disabled={ro} value={f.company_email || ''} onChange={(e) => set('company_email', e.target.value)} /></Field>
          <Field label="Address" className="full"><input className="input" disabled={ro} value={f.company_address || ''} onChange={(e) => set('company_address', e.target.value)} /></Field>
          <Field label="Currency" hint="Set by the workspace region"><input className="input" disabled value={f.currency || cur()} /></Field>
          <Field label="Date format"><input className="input" disabled value="DD-MMM-YYYY (Asia/Karachi)" /></Field>
        </div></Card>
        <Card title="Commission & targets"><div className="form-grid">
          <Field label="Default commission %" hint="Used when no commission rule matches"><input className="input" type="number" step="0.1" disabled={ro} value={f.default_commission_pct || ''} onChange={(e) => set('default_commission_pct', e.target.value)} /></Field>
          <Field label="Agent tier targets (JSON: tier → lifetime sales)" className="full"><textarea className="textarea" disabled={ro} value={f.agent_targets || ''} onChange={(e) => set('agent_targets', e.target.value)} /></Field>
        </div></Card>
        <Card title="Website API"><div className="stack">
          <div className="muted">The company website reads properties and posts leads through the ERP API. Send the key in an <code>X-API-Key</code> header.</div>
          <div className="alert info">Connecting a new website? Use <a href="/settings/website-integrations">Website integrations</a> instead: every website gets its own key and permissions, signed events and hosted forms. This single key keeps working for sites that already use it.</div>
          <Field label="API key"><div className="row"><input className="input mono" readOnly value={apiKey || ''} /><button className="btn" disabled={ro} onClick={async () => { const r = await api.post('/api/settings/system/regenerate-api-key'); setKey(r.key); toast('New key generated — update your website', 'ok'); }}>Regenerate</button></div></Field>
          <Field label="Webhook URL (optional)" hint="ERP POSTs property.published / featured / sold / hidden events here (https only)"><input className="input" disabled={ro} value={f.website_webhook_url || ''} onChange={(e) => set('website_webhook_url', e.target.value)} placeholder="https://www.example.com/api/erp-webhook" /></Field>
          <Field label="Webhook signing secret" hint="Each delivery carries an Agentify-Signature header: t=<unix time>,v1=<HMAC-SHA256 of “t.body” with this secret>. Check it and reject anything older than 5 minutes. The API key is never sent to your webhook."><div className="row"><input className="input mono" readOnly value={hookSecret || ''} /><button className="btn" disabled={ro} onClick={async () => { const r = await api.post('/api/settings/system/regenerate-webhook-secret'); setSecret(r.secret); toast('New signing secret generated — update your website', 'ok'); }}>Regenerate</button></div></Field>
          <div className="sum-box" style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7, overflow: 'auto' }}>GET {base}/api/public/properties<br />GET {base}/api/public/properties/featured<br />GET {base}/api/public/property/:id<br />GET {base}/api/public/projects · /api/public/project/:id<br />POST {base}/api/public/lead · /inquiry · /contact</div>
        </div></Card>
      </div>
    </div>
  );
}

export function NotificationSettings() {
  const toast = useToast();
  const { data } = useFetch('/api/settings/system');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const chk = (k) => f[k] === '1' || f[k] === 1 || f[k] === true;
  return (
    <div style={{ maxWidth: 760 }}>
      <PageHead title="Notifications"><button className="btn primary" onClick={async () => { await api.put('/api/settings/system', { installment_reminder_days: f.installment_reminder_days, notify_email_enabled: chk('notify_email_enabled') ? 1 : 0, notify_sms_enabled: chk('notify_sms_enabled') ? 1 : 0, notify_whatsapp_enabled: chk('notify_whatsapp_enabled') ? 1 : 0 }); toast('Saved', 'ok'); }}>Save</button></PageHead>
      <div className="stack">
        <Card title="In-app notifications (always on)"><div className="muted">Installment due/overdue, new lead assigned, follow-up due, property sold, payment received, commission approved, vendor payment due, leave requested, development update published.</div>
          <div style={{ marginTop: 12 }}><Field label="Remind about installments due within (days)"><input className="input" style={{ width: 120 }} type="number" min="1" value={f.installment_reminder_days || 7} onChange={(e) => setF({ ...f, installment_reminder_days: e.target.value })} /></Field></div></Card>
        <Card title="External channels (optional integration layer)"><div className="alert info" style={{ marginBottom: 12 }}>E-mail: when it is switched on and the platform has its Resend sender connected, each in-app notification is also e-mailed to the person it is for (confirmed staff addresses only, at most five every ten minutes). SMS and WhatsApp plug in through a provider adapter: those switches record your preference until a provider is connected.</div>
          <div className="stack">{[['notify_email_enabled', 'E-mail'], ['notify_sms_enabled', 'SMS'], ['notify_whatsapp_enabled', 'WhatsApp']].map(([k, l]) => <div key={k} className="row between"><span>{l}</span><Toggle value={chk(k)} onChange={(v) => setF({ ...f, [k]: v ? 1 : 0 })} /></div>)}</div></Card>
      </div>
    </div>
  );
}

export function AuditLog() {
  const t = useTable('/api/audit', { limit: 50 });
  return (
    <div>
      <PageHead title="Audit log" sub="Every login, create, edit, delete, payment, voucher, status change and permission change" />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search user, action, record…" width={320} />
          <div style={{ width: 160 }}><Select value={t.extra.entity || ''} onChange={(v) => t.setFilter({ entity: v })} placeholder="All records" options={['user', 'contact', 'property', 'sale', 'receipt', 'expense', 'commission', 'journal', 'role', 'payroll', 'settings']} /></div></div>
        <DataTable {...t.tableProps} limit={50} columns={[{ key: 'created_at', label: 'When (PKT)', render: (r) => dateTime(r.created_at) }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action', render: (r) => <b>{r.action}</b> }, { key: 'entity', label: 'Record', render: (r) => (r.entity ? `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` : '') }, { key: 'detail', label: 'Detail', render: (r) => <span style={{ maxWidth: 420, display: 'inline-block' }}>{r.detail}</span> }, { key: 'ip', label: 'IP', hidden: true }]} />
      </Card>
    </div>
  );
}

export function NotificationsPage() {
  return (
    <div>
      <PageHead title="Notifications" sub="Everything that needs your eyes, newest first."><PushToggle /></PageHead>
      <NotificationCentre />
    </div>
  );
}
