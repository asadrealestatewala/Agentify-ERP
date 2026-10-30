// Super-admin screens of the platform console: overview, every workspace's progress and usage, expiry tracking,
// sign-in help for workspace users, and the list of super admins.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, Field, KV, Loading, Menu, Modal, ProgressBar, StatusBadge, Tabs, TextInput, Toggle, Drawer } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { historyLine } from './platform/Billing.jsx';
import { useCan } from './platform/AdminShell.jsx';

const A = '/api/platform/admin';
const d10 = (d) => (d ? String(d).slice(0, 10) : '—');
const num = (n) => Number(n || 0).toLocaleString();
const limit = (used, max) => (max == null ? `${num(used)}` : `${num(used)} / ${max}`);
function ago(ts) {
  if (!ts) return 'Never';
  const s = (Date.now() - Date.parse(String(ts).includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`)) / 1000;
  if (!Number.isFinite(s)) return d10(ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)} days ago`;
  return d10(ts);
}

const LEVEL_TONE = { expired: 'red', urgent: 'red', soon: 'amber', ok: 'green' };
export function ExpiryBadge({ e }) {
  if (!e) return null;
  const left = e.days_left;
  const when = left == null ? '' : left < 0 ? ` · ended ${-left}d ago` : left === 0 ? ' · today' : ` · ${left}d left`;
  const label = {
    never: 'No expiry', cancelled: 'Cancelled',
    trial: e.locked ? 'Trial ended' : `Trial${when}`,
    grace: e.locked ? 'Grace ended' : `Payment failed${when}`,
    ends: e.locked ? 'Subscription ended' : `Ends${when}`,
    renews: e.date ? `Paid${when}` : 'Paid',
  }[e.kind] || e.kind;
  return <span title={e.date ? `Date: ${e.date}` : undefined}><StatusBadge status={e.level} tone={e.kind === 'never' ? 'grey' : LEVEL_TONE[e.level]} label={label} />{e.date && <div className="muted">{e.date}</div>}</span>;
}

// ---------------------------------------------------------------- workspace list
export const FILTERS = [['all', 'All workspaces'], ['active', 'Active'], ['trial', 'Free trials'], ['paying', 'Paying'], ['attention', 'Need attention'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled']];
const matches = (t, f) => {
  const e = t.expiry;
  if (f === 'trial') return e.kind === 'trial' && t.status === 'active';
  if (f === 'paying') return e.billing_status === 'active' && t.status === 'active' && !t.is_legacy;
  if (f === 'attention') return t.status === 'active' && ['expired', 'urgent', 'soon'].includes(e.level);
  if (f === 'active') return t.status === 'active';
  if (f === 'suspended') return t.status === 'suspended';
  if (f === 'cancelled') return t.status === 'cancelled';
  return true;
};

export function Workspaces({ onOpen }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [prod, setProd] = useState('');
  const [params, setParams] = useSearchParams();
  const f = FILTERS.some(([k]) => k === params.get('status')) ? params.get('status') : 'all';
  const setF = (v) => { const p = new URLSearchParams(params); if (v === 'all') p.delete('status'); else p.set('status', v); setParams(p); setPage(0); };
  const [create, setCreate] = useState(null);
  const [sort, setSort] = useState({ key: 'created', dir: -1 });
  const [page, setPage] = useState(0);
  const PER = 25;
  const blank = { slug: '', company_name: '', admin_name: '', admin_email: '', admin_password: '', trial_days: 7, demo: false, product: 'real_estate' };
  useEffect(() => { if (params.get('new') === '1') { setCreate(blank); const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(() => api.get(`${A}/workspaces`).then(setRows).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => {
    const list = (rows || []).filter((t) => matches(t, f) && (!prod || t.product === prod) && (!q || `${t.name} ${t.slug} ${t.owner_email}`.toLowerCase().includes(q.toLowerCase())));
    const val = (t) => ({ name: t.name.toLowerCase(), progress: t.progress?.percent ?? -1, users: t.stats?.seats ?? -1, active: t.stats?.last_activity || '', expiry: t.expiry.days_left ?? 99999, created: t.created_at }[sort.key]);
    return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [rows, q, f, sort, prod]);
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const pageRows = shown.slice(page * PER, page * PER + PER);
  const th = (key, label) => <th className="pa-sortable" onClick={() => setSort((x) => ({ key, dir: x.key === key ? -x.dir : 1 }))} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Workspace', 'Address', 'Owner', 'Status', 'Plan', 'Billing status', 'Access until', 'Days left', 'Users', 'Projects', 'Setup %', 'Last activity', 'Created'].map(esc).join(',')]
      .concat(shown.map((t) => [t.name, t.slug, t.owner_email, t.status, t.plan, t.expiry.billing_status, t.expiry.date, t.expiry.days_left, t.stats?.seats, t.stats?.projects, t.progress?.percent, t.stats?.last_activity, t.created_at].map(esc).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `workspaces-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  if (!rows) return <Loading />;
  const save = async () => {
    try { const t = await api.post(`${A}/workspaces`, { ...create, trial_days: Number(create.trial_days) }); setCreate(null); toast(`${t.name} created`); load(); onOpen(t.id); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card flush title={`${shown.length} workspace${shown.length === 1 ? '' : 's'}`} actions={<>
      <input className="input" style={{ width: 200 }} placeholder="Search name, address, owner" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search workspaces" />
      <select className="input" style={{ width: 170 }} value={prod} onChange={(e) => { setProd(e.target.value); setPage(0); }} aria-label="Product"><option value="">Both products</option><option value="real_estate">Real estate</option><option value="construction">Construction</option><option value="bundle">Bundle</option></select>
      <select className="input" style={{ width: 180 }} value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <button className="btn sm" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      <button className="btn primary sm" onClick={() => setCreate(blank)}>New workspace</button>
    </>}>
      {!shown.length ? <Empty title="No workspaces match" /> : (
        <div className="table-wrap"><table className="t"><thead><tr>{th('name', 'Workspace')}{th('progress', 'Setup progress')}{th('users', 'Usage')}{th('active', 'Last active')}{th('expiry', 'Plan / expiry')}<th>Status</th></tr></thead><tbody>
          {pageRows.map((t) => (
            <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
              <td><b>{t.name}</b><div className="muted">{t.slug}{t.custom_domain ? ` · ${t.custom_domain}` : ''}</div><div className="muted">{t.owner_email || ''}</div></td>
              <td style={{ minWidth: 140 }}>{t.progress ? <><ProgressBar value={t.progress.percent} tone="green" /><div className="muted">{t.progress.done} of {t.progress.total} steps</div></> : <span className="err">{t.error || '—'}</span>}</td>
              <td className="nowrap">{t.stats && <><div>{limit(t.stats.seats, t.expiry.limits?.seats)} users</div><div className="muted">{limit(t.stats.projects, t.expiry.limits?.projects)} projects · {num(t.stats.properties)} properties · {num(t.stats.sales)} sales</div></>}</td>
              <td className="nowrap">{ago(t.stats?.last_activity)}</td>
              <td><div style={{ textTransform: 'capitalize' }}>{t.is_legacy ? 'Original (unmetered)' : t.plan}</div><div className="muted">{PRODUCT_SHORT[t.product] || ''}</div><ExpiryBadge e={t.expiry} /></td>
              <td><StatusBadge status={t.status} /></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {pages > 1 && <div className="pa-pager"><span className="muted">{page * PER + 1}–{Math.min(shown.length, (page + 1) * PER)} of {shown.length}</span><span><button className="btn sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button> <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button></span></div>}
      {create && (
        <Modal title="New workspace" onClose={() => setCreate(null)} footer={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
          <p className="muted">For a customer you are onboarding yourself. Give them the address and the password, and ask them to change it after signing in.</p>
          <Field label="Company name" required><TextInput value={create.company_name} onChange={(v) => setCreate({ ...create, company_name: v, slug: create.slugTouched ? create.slug : v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) })} /></Field>
          <Field label="Workspace address" required hint="Lowercase letters, digits and hyphens"><TextInput value={create.slug} onChange={(v) => setCreate({ ...create, slug: v.toLowerCase(), slugTouched: true })} /></Field>
          <Field label="Owner name"><TextInput value={create.admin_name} onChange={(v) => setCreate({ ...create, admin_name: v })} /></Field>
          <Field label="Owner email" required><TextInput type="email" value={create.admin_email} onChange={(v) => setCreate({ ...create, admin_email: v })} /></Field>
          <Field label="Owner password" required hint="At least 8 characters"><TextInput type="text" autoComplete="off" value={create.admin_password} onChange={(v) => setCreate({ ...create, admin_password: v })} /></Field>
          <Field label="Product"><select className="input" value={create.product} onChange={(ev) => setCreate({ ...create, product: ev.target.value })}><option value="real_estate">Real Estate Brokerage</option><option value="construction">Construction Management</option><option value="bundle">Both products</option></select></Field>
          <Field label="Free trial days" hint="0 for no trial"><TextInput type="number" value={create.trial_days} onChange={(v) => setCreate({ ...create, trial_days: v })} /></Field>
          <Toggle value={create.demo} onChange={(v) => setCreate({ ...create, demo: v })} label="Fill with demo data" />
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- one workspace
const USER_ACTIONS = [
  ['reset-link', 'Create password reset link'],
  ['reset-email', 'Email password reset link'],
  ['verify-email', 'Mark email as confirmed'],
  ['resend-verify', 'Resend confirmation email'],
  ['disable-2fa', 'Turn off two-factor sign-in'],
  ['disable-login-otp', 'Turn off the workspace email sign-in code'],
  ['sign-out', 'Sign out everywhere'],
];

const fmtBytes = (n) => (n == null ? '—' : n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const PRODUCT_SHORT = { real_estate: 'Real estate', construction: 'Construction', bundle: 'Both products' };
const TRIAL_ACTIONS = [['extend', 'Extend'], ['shorten', 'Shorten'], ['end', 'End now'], ['revoke', 'Revoke (abuse)'], ['grant', 'Start a new trial']];
const TABS = [['overview', 'Overview'], ['profile', 'Company profile'], ['users', 'Users & access'], ['subscription', 'Subscription'], ['payments', 'Invoices & payments'], ['limits', 'Usage & limits'], ['activity', 'Activity'], ['notes', 'Notes & support']];

export function WorkspaceDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const can = useCan();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api.get(`${A}/workspaces/${id}`).then(setD).catch((e) => toast(e.message, 'err')), [id, toast]);
  useEffect(() => { load(); }, [load]);
  const after = (msg) => { if (msg) toast(msg); load(); onChanged?.(); };
  const post = async (url, body, msg, method = 'post') => { try { const out = await api[method](url, body); after(msg); return out || true; } catch (e) { toast(e.message, 'err'); return null; } };

  const userAct = async (u, act) => {
    const action = act === 'reset-email' ? 'reset-link' : act;
    const out = await post(`${A}/workspaces/${id}/users/${u.id}/${action}`, { email: act === 'reset-email' }, null);
    if (!out) return;
    if (out.link) setModal({ kind: 'link', user: u, ...out });
    else toast({ 'verify-email': 'Email marked as confirmed', 'resend-verify': out.email_sent ? 'Confirmation email sent' : 'Email not sent (no mail key): link printed in the server window', 'disable-2fa': 'Two-factor sign-in turned off', 'disable-login-otp': 'Email sign-in code turned off for this workspace', 'sign-out': 'Signed out everywhere', activate: 'User can sign in again', deactivate: 'User deactivated' }[act] || 'Done');
  };

  if (!d) return <Drawer title="Workspace" onClose={onClose} size="lg"><Loading /></Drawer>;
  const e = d.expiry;
  const s = d.stats || {};
  const billed = !d.is_legacy;
  const lim = e.limits || {};
  const planNames = Object.fromEntries((d.plans || []).map((p) => [p.id, p.name]));
  return (
    <Drawer title={d.name} onClose={onClose} size="lg">
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        {d.url && <a className="btn sm" href={d.url} target="_blank" rel="noreferrer">Open workspace ↗</a>}
        {billed && can('billing.manage') && <button className="btn sm" onClick={() => setModal({ kind: 'plan', plan: d.plans.some((p) => p.id === d.plan) ? d.plan : d.plans[0]?.id, sub: 'active', interval: d.billing_interval || 'month', period_end: '', reason: '' })}>Change plan</button>}
        {billed && can('billing.manage') && <button className="btn sm" onClick={() => setModal({ kind: 'pay', plan: d.plans.some((p) => p.id === d.plan) ? d.plan : d.plans[0]?.id, interval: d.billing_interval || 'month', method: 'bank', currency: 'PKR', amount: '', reference: '', note: '' })}>Record payment</button>}
        {billed && can('trials.manage') && (d.subscription_status === 'trialing' || (['expired', 'pending'].includes(d.subscription_status) && !d.current_period_end)) && <button className="btn sm" onClick={() => setModal({ kind: 'trial', action: d.subscription_status === 'trialing' ? 'extend' : 'grant', days: 7, until: '', reason: '' })}>Trial controls</button>}
        {billed && can('billing.manage') && e.kind === 'grace' && <button className="btn sm" onClick={() => setModal({ kind: 'grace', until: '', reason: '' })}>Extend grace period</button>}
        {billed && can('workspaces.edit') && d.owner_email && <button className="btn sm" onClick={() => post(`${A}/workspaces/${id}/remind`, {}, 'Billing reminder sent to the owner')}>Send billing reminder</button>}
        <Menu trigger={<button className="btn sm">More ▾</button>}>
          {can('workspaces.support') && <button onClick={() => post(`${A}/workspaces/${id}/onboarding-email`, {}, 'Confirmation email sent to the owner')}>Resend onboarding email</button>}
          {can('workspaces.edit') && <button onClick={() => setModal({ kind: 'owner', email: d.owner_email || '' })}>Change owner</button>}
          {billed && can('workspaces.suspend') && d.status !== 'active' && <button onClick={() => setAsk({ status: 'active' })}>Reactivate workspace</button>}
          {billed && can('workspaces.suspend') && d.status === 'active' && <button className="danger" onClick={() => setAsk({ status: 'suspended' })}>Suspend workspace</button>}
          {billed && can('workspaces.suspend') && d.status !== 'cancelled' && <button className="danger" onClick={() => setAsk({ status: 'cancelled' })}>Cancel workspace</button>}
          {billed && can('workspaces.suspend') && d.status === 'cancelled' && !d.data_deleted_at && <button className="danger" onClick={() => setModal({ kind: 'delete', confirm_slug: '', reason: '', owner_request: !!d.close_requested_at, keep_archive: false })}>Delete workspace data…</button>}
        </Menu>
      </div>
      {d.error && <div className="alert err">Could not read this workspace's database: {d.error}</div>}
      {d.close_requested_at && !d.data_deleted_at && <div className="alert warn">The owner asked to close this account and delete its data on {d10(d.close_requested_at)}. Confirm with them, cancel the workspace, then delete its data.</div>}
      {d.data_deleted_at && <div className="alert info">This workspace's data was deleted on {d10(d.data_deleted_at)}. Billing records are kept.</div>}
      {d.retention?.applies && !d.data_deleted_at && <div className="alert info">Cancelled on {d.retention.cancelled_on}. Data is kept until {d.retention.keep_until} ({d.retention.retention_days}-day retention){d.retention.eligible ? ': it can now be reviewed for deletion.' : '.'}</div>}
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label: key === 'users' ? `${label} (${d.users.length})` : key === 'notes' && d.notes.length ? `${label} (${d.notes.length})` : label }))} value={tab} onChange={setTab} />
      <div style={{ marginTop: 12 }} className="stack">
        {tab === 'overview' && <>
          <Card title="At a glance">
            <KV items={[['Address', d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : d.slug], ['Product', `${PRODUCT_SHORT[d.product] || d.product}${d.products ? ` (uses: ${d.products.map((x) => PRODUCT_SHORT[x]).join(', ')})` : ''}`], ...(d.trial_note ? [['Trial', d.trial_note]] : []), ['Owner', [d.owner_name, d.owner_email, d.owner_phone].filter(Boolean).join(' · ') || '—'], ['Status', <StatusBadge key="s" status={d.status} />],
              ['Plan', d.is_legacy ? 'Original install (unmetered)' : `${e.kind === 'trial' ? 'Free trial' : planNames[d.plan] || d.plan}${d.billing_interval && e.kind !== 'trial' ? ` · ${d.billing_interval}ly` : ''}`],
              ['Price', d.price ? `${d.price.currency} ${num(d.price.amount)} per ${d.price.interval}` : '—'], ['Access', <ExpiryBadge key="e" e={e} />],
              ['Account manager', d.account_manager], ['Created', d10(d.created_at)], ['Last sign-in', ago(s.last_login)], ['Last activity', ago(s.last_activity)]]} />
          </Card>
          {d.progress && <Card title={`Onboarding · ${d.progress.percent}%`}>
            <ProgressBar value={d.progress.percent} tone="green" />
            <div className="stack" style={{ marginTop: 10 }}>{d.progress.steps.map((st) => <div key={st.id}>{st.done ? '✅' : '⬜'} {st.label}</div>)}</div>
          </Card>}
          {!!d.notes.filter((n) => n.pinned).length && <Card title="Pinned notes">{d.notes.filter((n) => n.pinned).map((n) => <p key={n.id}>{n.body} <span className="muted">· {n.admin}</span></p>)}</Card>}
        </>}
        {tab === 'profile' && <><ProfileForm d={d} onSave={(body) => post(`${A}/workspaces/${id}`, body, 'Workspace updated', 'patch')} />
          {can('workspaces.edit') && <BrandCard d={d} onSave={(brandId) => post(`${A}/workspaces/${id}/brand`, { brand_id: brandId }, brandId ? 'Brand assigned: its logo and colour now apply to this workspace' : 'Removed from its brand', 'put')} />}</>}
        {tab === 'users' && <>
          <Card flush>
            <div className="table-wrap" style={{ overflow: 'visible', paddingBottom: 200 }}><table className="t"><thead><tr><th>User</th><th>Role</th><th>Sign-in</th><th>Last sign-in</th><th /></tr></thead><tbody>
              {d.users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b>{u.is_demo && <span className="muted"> · demo</span>}<div className="muted">{u.email || u.phone || '—'}</div></td>
                  <td>{u.role}{u.portal && <div className="muted">portal</div>}</td>
                  <td className="nowrap"><StatusBadge status={u.active ? 'active' : 'inactive'} />{!u.email_verified && <div><StatusBadge status="pending" label="Email not confirmed" /></div>}{u.totp_enabled && <div className="muted">2FA on</div>}</td>
                  <td className="nowrap">{ago(u.last_login)}</td>
                  <td className="right">
                    {can('workspaces.support') && <Menu trigger={<button className="btn sm">Help ▾</button>}>
                      {USER_ACTIONS.filter(([k]) => (k !== 'verify-email' && k !== 'resend-verify') || !u.email_verified).filter(([k]) => k !== 'disable-2fa' || u.totp_enabled).map(([k, l]) => <button key={k} onClick={() => userAct(u, k)}>{l}</button>)}
                      <button className={u.active ? 'danger' : ''} onClick={() => userAct(u, u.active ? 'deactivate' : 'activate')}>{u.active ? 'Deactivate (block sign-in)' : 'Activate (allow sign-in)'}</button>
                    </Menu>}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          </Card>
          {!!d.pending_invites.length && <Card title="Pending invitations" flush>
            <div className="table-wrap"><table className="t"><tbody>{d.pending_invites.map((i) => <tr key={i.id}><td>{i.email}</td><td>{i.role}</td><td className="muted">expires {d10(i.expires_at)}</td></tr>)}</tbody></table></div>
          </Card>}
        </>}
        {tab === 'subscription' && <>
          <Card title="Current subscription"><KV items={[['Plan', planNames[d.plan] || d.plan], ['Billing status', <StatusBadge key="b" status={d.subscription_status} />], ['Billing cycle', d.billing_interval ? `${d.billing_interval}ly` : '—'],
            ['Price paid', d.price ? `${d.price.currency} ${num(d.price.amount)}` : '—'], ['Trial', d.trial_started_at ? `${new Date(d.trial_started_at).toLocaleString()} → ${new Date(d.trial_ends_at).toLocaleString()}` : d10(d.trial_ends_at)], ['Cancelled on', d10(d.canceled_at)], ['Paid until / next renewal', d10(d.current_period_end)], ['Grace until', d10(d.grace_until)], ['Paid via', d.billing_provider || '—']]} /></Card>
          <Card title="History" flush>
            {!d.history.length ? <Empty title="No changes recorded yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.history.map((h) => <tr key={h.id}><td className="nowrap muted">{h.created_at.slice(0, 16)}</td><td>{historyLine(h)}</td><td>{h.actor || h.source}</td><td className="muted">{h.reason || ''}</td></tr>)}</tbody></table></div>}
          </Card>
        </>}
        {tab === 'payments' && <>
          <Card title="Payments" flush>
            {!d.payments.length ? <Empty title="No bank or wallet payments" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>For</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>{d.payments.map((p) => <tr key={p.id}><td className="nowrap">{d10(p.created_at)}</td><td>{planNames[p.plan] || p.plan} / {p.interval}</td><td>{p.method}</td><td className="mono nowrap">{p.currency} {num(p.amount)}</td><td className="mono">{p.reference}</td><td><StatusBadge status={p.status} />{p.decision_note && <div className="muted">{p.decision_note}</div>}</td></tr>)}</tbody></table></div>}
          </Card>
          <Card title="Invoices" flush>
            {!d.invoices.length ? <Empty title="No invoices yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Issued</th><th>Number</th><th>Amount</th><th>Covers</th><th>Status</th></tr></thead><tbody>{d.invoices.map((i) => <tr key={i.id}><td className="nowrap">{d10(i.created_at)}</td><td className="mono">{i.hosted_url ? <a href={i.hosted_url} target="_blank" rel="noreferrer">{i.provider_invoice_id}</a> : i.provider_invoice_id}</td><td className="mono nowrap">{i.currency} {num(i.amount)}</td><td>{d10(i.period_start)} → {d10(i.period_end)}</td><td><StatusBadge status={i.status} />{can('billing.manage') && i.status === 'paid' && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setModal({ kind: 'refund', invoice: i, amount: '', reason: '', reference: '' })}>Refund</button>}</td></tr>)}</tbody></table></div>}
          </Card>
          {!!d.refunds?.length && <Card title="Refunds" flush><div className="table-wrap"><table className="t"><tbody>{d.refunds.map((r) => <tr key={r.id}><td className="nowrap">{d10(r.created_at)}</td><td className="mono">{r.provider_invoice_id}</td><td className="mono nowrap">{r.currency} {num(r.amount)}</td><td>{r.provider}{r.reference ? ` · ${r.reference}` : ''}</td><td className="muted">{r.reason}</td></tr>)}</tbody></table></div></Card>}
        </>}
        {tab === 'limits' && billed && <AddonsBox d={d} canEdit={can('billing.manage')} onChange={(body) => post(`${A}/workspaces/${id}/addons`, body, 'Add-ons updated')} />}
        {tab === 'limits' && <LimitsForm d={d} onSave={(body) => post(`${A}/workspaces/${id}/entitlements`, body, 'Limits saved', 'put')} />}
        {tab === 'activity' && <>
          <Card title="Account history" flush>
            <div className="table-wrap"><table className="t"><tbody>{d.events.map((ev, i) => <tr key={i}><td className="nowrap muted">{String(ev.created_at).slice(0, 16)}</td><td>{ev.action}</td><td className="muted">{ev.detail && ev.detail !== 'null' ? ev.detail : ''}</td></tr>)}</tbody></table></div>
          </Card>
          <Card title="Recent activity inside the workspace" flush>
            {!d.activity.length ? <Empty title="No activity yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.activity.map((a, i) => <tr key={i}><td className="nowrap muted">{String(a.created_at).slice(0, 16).replace('T', ' ')}</td><td>{a.user_name}</td><td>{a.action}{a.entity ? <span className="muted"> · {a.entity}</span> : ''}</td></tr>)}</tbody></table></div>}
          </Card>
        </>}
        {tab === 'notes' && <>
          <Card title="Add a note" actions={<span className="muted">Only super admins see notes</span>}>
            <textarea className="input" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Calls, promises made, support requests, special terms…" aria-label="Note" />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn primary sm" disabled={!note.trim()} onClick={async () => { if (await post(`${A}/workspaces/${id}/notes`, { body: note }, 'Note added')) setNote(''); }}>Add note</button>
              <button className="btn sm" disabled={!note.trim()} onClick={async () => { if (await post(`${A}/workspaces/${id}/notes`, { body: note, pinned: true }, 'Note pinned')) setNote(''); }}>Add as pinned</button>
            </div>
          </Card>
          <Card title="Notes" flush>
            {!d.notes.length ? <Empty title="No notes yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.notes.map((n) => <tr key={n.id}><td className="nowrap muted">{n.created_at.slice(0, 16)}</td><td style={{ whiteSpace: 'pre-wrap' }}>{n.pinned ? '📌 ' : ''}{n.body}</td><td className="muted">{n.admin}</td></tr>)}</tbody></table></div>}
          </Card>
        </>}
      </div>

      {modal?.kind === 'link' && (
        <Modal title={`Password reset link · ${modal.user.name}`} onClose={() => setModal(null)} footer={<button className="btn primary" onClick={() => setModal(null)}>Done</button>}>
          <p>{modal.email_sent ? `Emailed to ${modal.user.email}. ` : ''}Send this link to the user. It works once and expires in {modal.expires_in_hours} hours.</p>
          <div className="row" style={{ gap: 8 }}><input className="input mono" readOnly value={modal.link} onFocus={(ev) => ev.target.select()} /><button className="btn" onClick={() => { navigator.clipboard?.writeText(modal.link); toast('Link copied'); }}>Copy</button></div>
        </Modal>
      )}
      {modal?.kind === 'plan' && (
        <Modal title={`Change plan · ${d.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={modal.reason.trim().length < 3} onClick={async () => { if (await post(`${A}/workspaces/${id}/subscription`, { plan: modal.plan, status: modal.sub, interval: modal.interval, period_end: modal.period_end || undefined, reason: modal.reason }, 'Subscription updated')) setModal(null); }}>Save</button></>}>
          <p className="muted">An override for exceptions (upgrades agreed by phone, corrections). To record money received, use Record payment instead: it also creates the invoice and receipt.</p>
          <Field label="Plan"><select className="input" value={modal.plan} onChange={(ev) => setModal({ ...modal, plan: ev.target.value })}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (retired)'}</option>)}</select></Field>
          <Field label="Billing status"><select className="input" value={modal.sub} onChange={(ev) => setModal({ ...modal, sub: ev.target.value })}>{[['active', 'Active (authorised manual activation)'], ['trialing', 'Trial'], ['pending', 'Pending first payment'], ['past_due', 'Payment failed (grace period)'], ['canceled', 'Cancelled at period end'], ['expired', 'Expired (read-only)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Billing cycle"><select className="input" value={modal.interval} onChange={(ev) => setModal({ ...modal, interval: ev.target.value })}><option value="month">Monthly</option><option value="year">Yearly</option></select></Field>
          <Field label="Paid until"><input type="date" className="input" value={modal.period_end} onChange={(ev) => setModal({ ...modal, period_end: ev.target.value })} /></Field>
          <Field label="Reason" required hint="Saved in the subscription history and audit log."><TextInput value={modal.reason} onChange={(v) => setModal({ ...modal, reason: v })} /></Field>
        </Modal>
      )}
      {modal?.kind === 'pay' && (
        <Modal title={`Record payment · ${d.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!modal.amount || modal.reference.trim().length < 4} onClick={async () => { if (await post(`${A}/workspaces/${id}/payments`, { ...modal, amount: Number(modal.amount) }, 'Payment recorded, plan extended and receipt sent')) setModal(null); }}>Record payment</button></>}>
          <p className="muted">For money already in your account. It creates the payment record and a paid invoice, extends the plan by one period, and emails the owner a receipt. Each reference can be recorded only once.</p>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="Plan"><select className="input" value={modal.plan} onChange={(ev) => { const p = d.plans.find((x) => x.id === ev.target.value); setModal({ ...modal, plan: ev.target.value, amount: p?.price?.[modal.currency]?.[modal.interval] ?? modal.amount }); }}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Period"><select className="input" value={modal.interval} onChange={(ev) => setModal({ ...modal, interval: ev.target.value })}><option value="month">One month</option><option value="year">One year</option></select></Field>
            <Field label="Method"><select className="input" value={modal.method} onChange={(ev) => setModal({ ...modal, method: ev.target.value })}>{[['bank', 'Bank transfer'], ['raast', 'Raast'], ['easypaisa', 'Easypaisa'], ['jazzcash', 'JazzCash'], ['sadapay', 'SadaPay'], ['nayapay', 'NayaPay']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Currency"><select className="input" value={modal.currency} onChange={(ev) => setModal({ ...modal, currency: ev.target.value })}><option>PKR</option><option>USD</option></select></Field>
            <Field label="Amount received" required hint={(() => { const p = d.plans.find((x) => x.id === modal.plan); const v = p?.price?.[modal.currency]?.[modal.interval]; return v != null ? `List price ${modal.currency} ${num(v)}` : ''; })()}><TextInput type="number" value={modal.amount} onChange={(v) => setModal({ ...modal, amount: v })} /></Field>
            <Field label="Transaction reference" required><TextInput value={modal.reference} onChange={(v) => setModal({ ...modal, reference: v })} placeholder="From the bank or wallet receipt" /></Field>
          </div>
          <Field label="Note / evidence" hint="E.g. where the slip is kept, or a discount agreed."><TextInput value={modal.note} onChange={(v) => setModal({ ...modal, note: v })} /></Field>
        </Modal>
      )}
      {modal?.kind === 'trial' && (
        <Modal title={`Trial controls · ${d.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className={`btn ${['end', 'revoke'].includes(modal.action) ? 'danger' : 'primary'}`} disabled={modal.reason.trim().length < 3} onClick={async () => { if (await post(`${A}/workspaces/${id}/trial`, { action: modal.action, ...(modal.action === 'extend' && modal.until ? { until: modal.until } : { days: Number(modal.days) }), reason: modal.reason }, 'Trial updated')) setModal(null); }}>Apply</button></>}>
          <p>Status <b>{d.subscription_status}</b>{d.trial_ends_at ? <> · trial ends <b>{new Date(d.trial_ends_at).toLocaleString()}</b> (stored in UTC)</> : ''}.</p>
          <Field label="Action"><select className="input" value={modal.action} onChange={(ev) => setModal({ ...modal, action: ev.target.value })}>{TRIAL_ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {['extend', 'shorten', 'grant'].includes(modal.action) && <Field label={modal.action === 'shorten' ? 'Remove days' : modal.action === 'grant' ? 'Trial length (days)' : 'Add days'} hint={modal.action === 'extend' ? 'Added to the current end, or from now if it already ended' : ''}><TextInput type="number" value={modal.days} onChange={(v) => setModal({ ...modal, days: v, until: '' })} /></Field>}
          {modal.action === 'extend' && <Field label="Or end on this date (end of day, UTC)"><input type="date" className="input" value={modal.until} onChange={(ev) => setModal({ ...modal, until: ev.target.value })} /></Field>}
          {['end', 'revoke'].includes(modal.action) && <p className="muted">The trial ends now and the workspace becomes read-only until it subscribes. Nothing is deleted.</p>}
          <Field label="Reason" required hint="Kept in the subscription history and audit log."><TextInput value={modal.reason} onChange={(v) => setModal({ ...modal, reason: v })} placeholder="e.g. Waiting for their accountant to finish setup" /></Field>
        </Modal>
      )}
      {modal?.kind === 'refund' && (
        <Modal title={`Refund invoice ${modal.invoice.provider_invoice_id}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" disabled={!modal.amount || modal.reason.trim().length < 3 || modal.reference.trim().length < 3} onClick={async () => { if (await post(`${A}/workspaces/${id}/refunds`, { invoice_id: modal.invoice.id, amount: Number(modal.amount), reason: modal.reason, reference: modal.reference }, 'Refund recorded')) setModal(null); }}>Record refund</button></>}>
          <p className="muted">Record money you have already returned (bank transfer). Card refunds made in Stripe arrive automatically. The invoice stays as collected; reports show refunds and net separately.</p>
          <Field label={`Amount (${modal.invoice.currency})`} required hint={`Invoice total ${num(modal.invoice.amount)}`}><TextInput type="number" value={modal.amount} onChange={(v) => setModal({ ...modal, amount: v })} /></Field>
          <Field label="Transfer reference" required><TextInput value={modal.reference} onChange={(v) => setModal({ ...modal, reference: v })} /></Field>
          <Field label="Reason" required><TextInput value={modal.reason} onChange={(v) => setModal({ ...modal, reason: v })} /></Field>
        </Modal>
      )}
      {modal?.kind === 'delete' && (
        <Modal title={`Delete data · ${d.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" disabled={modal.confirm_slug !== d.slug || modal.reason.trim().length < 5} onClick={async () => { if (await post(`${A}/workspaces/${id}/delete-data`, modal, 'Workspace data deleted')) setModal(null); }}>Delete permanently</button></>}>
          <div className="alert err">This permanently deletes the workspace's database and uploaded files. It cannot be undone. Invoices, payments and subscription history are kept.</div>
          {!d.retention?.eligible && <p>The retention period runs until <b>{d.retention?.keep_until}</b>. Delete earlier only if the customer asked for it.</p>}
          <Toggle value={modal.owner_request} onChange={(v) => setModal({ ...modal, owner_request: v })} label="The customer asked for their data to be deleted" />
          <Toggle value={modal.keep_archive} onChange={(v) => setModal({ ...modal, keep_archive: v })} label="Keep one final archive copy in the backup folder" />
          <Field label="Reason" required><TextInput value={modal.reason} onChange={(v) => setModal({ ...modal, reason: v })} /></Field>
          <Field label={`Type ${d.slug} to confirm`} required><TextInput value={modal.confirm_slug} onChange={(v) => setModal({ ...modal, confirm_slug: v.trim().toLowerCase() })} /></Field>
        </Modal>
      )}
      {modal?.kind === 'grace' && (
        <Modal title={`Extend grace period · ${d.name}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={!modal.until || modal.reason.trim().length < 3} onClick={async () => { if (await post(`${A}/workspaces/${id}/grace`, { until: modal.until, reason: modal.reason }, 'Grace period extended')) setModal(null); }}>Save</button></>}>
          <p>The workspace stays fully usable until this date, then becomes read-only if still unpaid.</p>
          <Field label="Grace until"><input type="date" className="input" value={modal.until} onChange={(ev) => setModal({ ...modal, until: ev.target.value })} /></Field>
          <Field label="Reason" required><TextInput value={modal.reason} onChange={(v) => setModal({ ...modal, reason: v })} /></Field>
        </Modal>
      )}
      {modal?.kind === 'owner' && (
        <Modal title="Change owner" onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await post(`${A}/workspaces/${id}/owner`, { email: modal.email }, 'Owner changed')) setModal(null); }}>Save</button></>}>
          <p className="muted">Billing reminders and receipts go to the owner. It must be a staff user of this workspace.</p>
          <Field label="Owner"><select className="input" value={modal.email} onChange={(ev) => setModal({ ...modal, email: ev.target.value })}>{d.users.filter((u) => !u.portal && u.email).map((u) => <option key={u.id} value={u.email}>{u.name} · {u.email}</option>)}</select></Field>
        </Modal>
      )}
      {ask && <ConfirmDialog title={{ active: 'Reactivate workspace?', suspended: 'Suspend workspace?', cancelled: 'Cancel workspace?' }[ask.status]} danger={ask.status !== 'active'}
        confirmLabel={{ active: 'Reactivate', suspended: 'Suspend', cancelled: 'Cancel workspace' }[ask.status]} reason={ask.status !== 'active'}
        message={{ active: 'Its users can sign in and work again.', suspended: 'Nobody in this workspace can sign in or use it until you reactivate it. No data is deleted.', cancelled: 'The workspace is closed: nobody can sign in. All data is kept and it can be reactivated later.' }[ask.status]}
        onCancel={() => setAsk(null)} onConfirm={async (reason) => { await post(`${A}/workspaces/${id}/status`, { status: ask.status, reason }, { active: 'Workspace reactivated', suspended: 'Workspace suspended', cancelled: 'Workspace cancelled' }[ask.status]); setAsk(null); }} />}
    </Drawer>
  );
}

function AddonsBox({ d, canEdit, onChange }) {
  const [f, setF] = useState({ addon_id: d.available_addons?.[0]?.id || '', quantity: 1, reason: '' });
  return (
    <Card title="Add-ons">
      {!d.addons?.length ? <p className="muted">No add-ons.</p> : <div className="table-wrap"><table className="t"><tbody>{d.addons.map((a) => <tr key={a.id}><td>{a.name}</td><td>x {a.quantity}</td><td><StatusBadge status={a.status === 'active' ? 'active' : 'inactive'} label={a.status} /></td><td className="muted">{d10(a.started_at)}{a.ended_at ? ` → ${d10(a.ended_at)}` : ''}</td>
        <td className="right">{canEdit && a.status === 'active' && <button className="btn sm" onClick={() => { const reason = window.prompt('Reason for removing this add-on'); if (reason) onChange({ addon_id: a.addon_id, active: false, reason }); }}>Remove</button>}</td></tr>)}</tbody></table></div>}
      {canEdit && !!d.available_addons?.length && <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        <select className="input" style={{ width: 200 }} value={f.addon_id} onChange={(e) => setF({ ...f, addon_id: e.target.value })} aria-label="Add-on">{d.available_addons.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input className="input" type="number" min="1" style={{ width: 80 }} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} aria-label="Quantity" />
        <input className="input" style={{ width: 220 }} placeholder="Reason (required)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Reason" />
        <button className="btn sm primary" disabled={f.reason.trim().length < 3} onClick={() => onChange({ addon_id: f.addon_id, quantity: Number(f.quantity), active: true, reason: f.reason })}>Switch on</button>
      </div>}
    </Card>
  );
}

function ProfileForm({ d, onSave }) {
  const [f, setF] = useState({ name: d.name, owner_name: d.owner_name || '', owner_phone: d.owner_phone || '', account_manager: d.account_manager || '', custom_domain: d.custom_domain || '', timezone: d.timezone });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <Card title="Company profile" actions={<button className="btn primary sm" onClick={() => onSave(f)}>Save changes</button>}>
      <div className="pa-grid2" style={{ marginBottom: 0 }}>
        <Field label="Company name" required><TextInput value={f.name} onChange={set('name')} /></Field>
        <Field label="Workspace address" hint="Fixed: changing it would break links and sign-ins"><TextInput value={d.slug} disabled onChange={() => {}} /></Field>
        <Field label="Owner / contact name"><TextInput value={f.owner_name} onChange={set('owner_name')} /></Field>
        <Field label="Owner email" hint="Change it with More → Change owner"><TextInput value={d.owner_email || ''} disabled onChange={() => {}} /></Field>
        <Field label="Contact phone"><TextInput value={f.owner_phone} onChange={set('owner_phone')} placeholder="+92 3xx xxxxxxx" /></Field>
        <Field label="Account manager"><TextInput value={f.account_manager} onChange={set('account_manager')} /></Field>
        <Field label="Custom domain" hint="Point the domain's DNS to this server first"><TextInput value={f.custom_domain} onChange={set('custom_domain')} placeholder="erp.company.com" /></Field>
        <Field label="Timezone"><TextInput value={f.timezone} onChange={set('timezone')} placeholder="Asia/Karachi" /></Field>
        <Field label="Currency" hint="Fixed after creation"><TextInput value={d.currency} disabled onChange={() => {}} /></Field>
      </div>
    </Card>
  );
}

/** Put the workspace in a brand group (shared logo and colour only; data, staff, fees and accounts stay separate). */
function BrandCard({ d, onSave }) {
  const [brands, setBrands] = useState(null);
  const [pick, setPick] = useState(d.brand_id ? String(d.brand_id) : '');
  useEffect(() => { api.get(`${A}/brands`).then(setBrands).catch(() => setBrands([])); }, []);
  const now = brands?.find((b) => b.id === d.brand_id);
  return (
    <Card title="Brand group" actions={<button className="btn sm" disabled={String(d.brand_id || '') === pick} onClick={() => onSave(pick ? Number(pick) : null)}>Save</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{now ? `Part of "${now.name}". ` : 'Independent workspace. '}A brand shares only its logo and colour. This workspace keeps its own data, staff, clients, fees and accounts.</p>
      <Field label="Brand"><select className="input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!brands}><option value="">None (independent)</option>{(brands || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
    </Card>
  );
}

function LimitsForm({ d, onSave }) {
  const lim = d.expiry.limits || {};
  const o = d.entitlements || {};
  const [f, setF] = useState({ seats: o.seats !== undefined ? (o.seats ?? '') : 'plan', projects: o.projects !== undefined ? (o.projects ?? '') : 'plan', modules: o.modules !== undefined ? o.modules : 'plan', reason: '' });
  const s = d.stats || {};
  const st = d.storage || {};
  const numField = (k, label, used) => (
    <Field label={label} hint={`Using ${num(used)} · ${f[k] === 'plan' ? `plan allows ${lim[k] == null ? 'unlimited' : lim[k]}` : 'workspace override'}`}>
      <div className="row" style={{ gap: 8 }}>
        <select className="input" style={{ width: 170 }} value={f[k] === 'plan' ? 'plan' : 'custom'} onChange={(ev) => setF({ ...f, [k]: ev.target.value === 'plan' ? 'plan' : '' })}><option value="plan">Use the plan's limit</option><option value="custom">Custom for this workspace</option></select>
        {f[k] !== 'plan' && <TextInput type="number" value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} placeholder="Empty = unlimited" />}
      </div>
    </Field>
  );
  const mods = f.modules === 'plan' ? null : f.modules;
  return (
    <>
      <Card title="Usage">
        <KV items={[['Team members', limit(s.seats, lim.seats)], ['Pending invitations', num(s.invited)], ['Projects', limit(s.projects, lim.projects)], ['Properties', num(s.properties)],
          ['Customers & leads', num(s.contacts)], ['Sales', num(s.sales)], ['Receipts', num(s.receipts)], ['Portal users', num(s.portal_users)],
          ['Database size', fmtBytes(st.database_bytes)], ['Uploaded files', st.upload_bytes == null ? 'Shared folder (original install)' : `${fmtBytes(st.upload_bytes)} in ${num(st.upload_files)} files`]]} />
      </Card>
      <Card title="Limits and modules for this workspace" actions={o && Object.keys(o).length ? <StatusBadge status="pending" label="Has overrides" /> : null}>
        <p className="muted">Normally a workspace gets its plan's limits. Set a custom value here for special deals or pilots. Changes apply immediately.</p>
        {numField('seats', 'Users', s.seats)}
        {numField('projects', 'Projects', s.projects)}
        <Field label="Modules">
          <select className="input" style={{ width: 240 }} value={f.modules === 'plan' ? 'plan' : 'custom'} onChange={(ev) => setF({ ...f, modules: ev.target.value === 'plan' ? 'plan' : (lim.modules || Object.keys(d.modules)) })}><option value="plan">Use the plan's modules</option><option value="custom">Choose for this workspace</option></select>
          {mods && <div className="pa-grid2" style={{ marginTop: 8, marginBottom: 0 }}>{Object.entries(d.modules).map(([k, m]) => <label key={k} className="row" style={{ gap: 8 }}><input type="checkbox" checked={mods.includes(k)} onChange={(ev) => setF({ ...f, modules: ev.target.checked ? [...mods, k] : mods.filter((x) => x !== k) })} />{m.label}</label>)}</div>}
          {!mods && <div className="muted" style={{ marginTop: 6 }}>Now: {lim.modules == null ? 'all modules' : lim.modules.map((m) => d.modules[m]?.label || m).join(', ') || 'core only'}</div>}
        </Field>
        <Field label="Reason" required><TextInput value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder="e.g. Pilot agreed with the owner until March" /></Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary sm" disabled={f.reason.trim().length < 3} onClick={() => onSave({ seats: f.seats === 'plan' ? 'plan' : f.seats === '' ? null : Number(f.seats), projects: f.projects === 'plan' ? 'plan' : f.projects === '' ? null : Number(f.projects), modules: f.modules, reason: f.reason })}>Save limits</button>
          {o && Object.keys(o).length > 0 && <button className="btn sm" disabled={f.reason.trim().length < 3} onClick={() => onSave({ clear: true, reason: f.reason })}>Remove all overrides</button>}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- expiry
const BUCKETS = [['due', 'Expired or due in 14 days'], ['all', 'All workspaces']];
export function Expiry({ onOpen }) {
  const toast = useToast();
  const [ext, setExt] = useState(null);
  const [rows, setRows] = useState(null);
  const [b, setB] = useState('due');
  const load = useCallback(() => api.get(`${A}/workspaces`).then(setRows).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  const list = rows.filter((t) => !t.is_legacy && t.status === 'active' && (b === 'all' || ['expired', 'urgent', 'soon'].includes(t.expiry.level)))
    .sort((x, y) => (x.expiry.days_left ?? 9999) - (y.expiry.days_left ?? 9999));
  const act = async (url, body, msg) => { try { await api.post(url, body); toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card flush title="Trials and subscriptions" actions={<select className="input" style={{ width: 220 }} value={b} onChange={(e) => setB(e.target.value)}>{BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}>
      <p className="muted" style={{ padding: '0 16px' }}>A trial or paid period that runs out makes the workspace read-only (nothing is deleted). A failed payment gets a 7-day grace period first.</p>
      {!list.length ? <Empty title="Nothing expiring" hint="No active workspace is expired or due in the next 14 days." /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Workspace</th><th>Plan</th><th>Access</th><th>Owner</th><th /></tr></thead><tbody>
          {list.map((t) => (
            <tr key={t.id}>
              <td><b style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>{t.name}</b><div className="muted">{t.slug}</div></td>
              <td style={{ textTransform: 'capitalize' }}>{t.expiry.kind === 'trial' ? 'Free trial' : t.plan}{t.billing_interval ? <div className="muted">{t.billing_interval}ly</div> : null}</td>
              <td><ExpiryBadge e={t.expiry} /></td>
              <td>{t.owner_email || '—'}</td>
              <td className="right nowrap">
                {t.expiry.kind === 'trial' && <><button className="btn sm" onClick={() => setExt(t)}>+7 days</button>{' '}</>}
                {t.owner_email && <><button className="btn sm" onClick={() => act(`${A}/workspaces/${t.id}/remind`, {}, `Reminder sent to ${t.owner_email}`)}>Remind</button>{' '}</>}
                <button className="btn sm" onClick={() => onOpen(t.id)}>Manage</button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {ext && <ConfirmDialog title={`Extend ${ext.name}'s trial by 7 days?`} confirmLabel="Extend" reason message={`The trial currently ends ${ext.expiry.date || 'now'}. The reason is kept in the subscription history.`}
        onCancel={() => setExt(null)} onConfirm={async (reason) => { await act(`${A}/workspaces/${ext.id}/trial`, { days: 7, reason }, 'Trial extended by 7 days'); setExt(null); }} />}
    </Card>
  );
}

