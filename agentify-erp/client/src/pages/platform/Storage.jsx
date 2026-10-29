// Storage & quotas: what every workspace uses against its limit, the plans' storage, and the bucket against its total.
// Plan storage is edited here (same plan record as Plans & pricing); a workspace's own limit is an override on top of its plan.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, Modal, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const GB = 1024 ** 3, MB = 1024 ** 2;
export const bytesText = (b) => (b == null ? '—' : b >= GB ? `${(b / GB).toFixed(b >= 10 * GB ? 0 : 2)} GB` : b >= MB ? `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1)} MB` : `${Math.round(b / 1024)} KB`);
const mbText = (mb) => (mb == null ? 'Unlimited' : mb >= 1024 ? `${+(mb / 1024).toFixed(2)} GB` : `${mb} MB`);
const when = (s) => (s ? new Date(s).toLocaleString() : 'never');

function Meter({ pct, label }) {
  const p = pct == null ? 0 : Math.min(100, Math.round(pct * 100));
  const tone = pct == null ? '#94a3b8' : pct >= 1 ? '#dc2626' : pct >= 0.8 ? '#d97706' : '#0e7c6b';
  return (
    <div role="img" aria-label={label} style={{ minWidth: 90 }}>
      <div style={{ height: 8, background: 'var(--grey-bg, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${p}%`, height: '100%', background: tone }} /></div>
      <div className="cell-sub">{pct == null ? 'No limit' : `${Math.round(pct * 100)}%`}</div>
    </div>
  );
}

function PlanRow({ plan, canEdit, reload }) {
  const toast = useToast();
  const [gb, setGb] = useState(plan.storage_mb == null ? '' : String(+(plan.storage_mb / 1024).toFixed(3)));
  const [busy, setBusy] = useState(false);
  const changed = (plan.storage_mb == null ? '' : String(+(plan.storage_mb / 1024).toFixed(3))) !== gb.trim();
  const save = async () => {
    setBusy(true);
    try { await api.put(`${A}/plans/${plan.id}`, { storage_mb: gb.trim() === '' ? null : Math.round(Number(gb) * 1024) }); toast(`${plan.name} storage saved`); reload(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <tr>
      <td>{plan.name} <span className="muted">{plan.id}</span>{!plan.active && <span className="pill grey" style={{ marginLeft: 6 }}>inactive</span>}</td>
      <td>{plan.product}</td>
      <td className="num">{plan.subscribers}</td>
      <td className="num">{mbText(plan.storage_mb)}</td>
      <td>{canEdit ? <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ width: 110 }} type="number" min="0.001" step="any" value={gb} onChange={(e) => setGb(e.target.value)} placeholder="Unlimited" aria-label={`${plan.name} storage in GB`} />
        <span className="muted">GB</span><button className="btn sm" disabled={!changed || busy} onClick={save}>Save</button></div> : <span className="muted">View only</span>}</td>
    </tr>
  );
}

function QuotaModal({ t, onClose, reload }) {
  const toast = useToast();
  const [mode, setMode] = useState(t.override_mb === undefined ? 'plan' : t.override_mb === null ? 'unlimited' : 'custom');
  const [gb, setGb] = useState(t.override_mb ? String(+(t.override_mb / 1024).toFixed(3)) : '');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const storage_mb = mode === 'plan' ? 'plan' : mode === 'unlimited' ? 'unlimited' : Math.round(Number(gb) * 1024);
      await api.put(`${A}/storage/workspaces/${t.id}`, { storage_mb, reason });
      toast(`${t.name}: storage limit saved`); onClose(); reload();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Storage limit · ${t.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (mode === 'custom' && !(Number(gb) > 0)) || reason.trim().length < 5} onClick={save}>Save limit</button></>}>
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>{t.plan_name} plan includes {mbText(t.plan_mb)}. Using {bytesText(t.used_bytes)} now.</p>
      <div role="radiogroup" aria-label="Storage limit" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {[['plan', `Use the plan's limit (${mbText(t.plan_mb)})`], ['custom', 'Set a limit for this workspace'], ['unlimited', 'No limit']].map(([k, l]) => (
          <label key={k} className="row" style={{ gap: 8 }}><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>))}
      </div>
      {mode === 'custom' && <Field label="Limit in GB" hint="For example 3 or 12.5"><input className="input" type="number" min="0.001" step="any" value={gb} onChange={(e) => setGb(e.target.value)} /></Field>}
      <Field label="Reason" required hint="Kept in the workspace history"><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
    </Modal>
  );
}

export default function StoragePage() {
  const can = useCan(); const toast = useToast();
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); const [syncing, setSyncing] = useState(false);
  const [total, setTotal] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(() => api.get(`${A}/storage`).then((x) => { setD(x); setTotal(String(x.bucket.total_gb)); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const { bucket: b, totals: t } = d;
  const canEditPlans = can('billing.configure'), canManage = can('billing.manage');
  const sync = async () => { setSyncing(true); try { const r = await api.post(`${A}/storage/sync`, {}); setD(r.overview); toast(`Bucket counted: ${bytesText(r.total_bytes)} in ${r.workspaces} workspace folder(s)`); } catch (e) { toast(e.message, 'error'); } setSyncing(false); };
  const saveTotal = async () => { try { setD(await api.put(`${A}/storage/total`, { total_gb: Number(total) })); toast('Bucket size saved'); } catch (e) { toast(e.message, 'error'); } };
  const bucketPct = b.used_bytes != null ? b.used_bytes / b.total_bytes : null;
  const soldPct = t.quota_sold_bytes / b.total_bytes;
  const rows = d.tenants.filter((x) => !q.trim() || `${x.name} ${x.slug}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageTitle title="Storage & quotas" sub="Each workspace's files against its limit, the storage included in each plan, and the object storage bucket against its total." />
      <div className="cc-stats">
        <Card><div className="cc-k">Bucket (last count)</div><div className="cc-v">{bytesText(b.used_bytes)} <span className="muted" style={{ fontSize: 13 }}>of {b.total_gb} GB</span></div>
          <Meter pct={bucketPct} label="Bucket usage" /><div className="cell-sub">{b.configured ? `Counted ${when(b.synced_at)}` : 'Not connected'}</div></Card>
        <Card><div className="cc-k">Used by workspaces</div><div className="cc-v">{bytesText(t.used_bytes)}</div><div className="cell-sub">{bytesText(t.private_bytes)} private files in the bucket · {bytesText(t.public_bytes)} on the server</div></Card>
        <Card><div className="cc-k">Quota promised to workspaces</div><div className="cc-v">{bytesText(t.quota_sold_bytes)}</div>
          <div className="cell-sub" style={{ color: soldPct > 1 ? '#dc2626' : undefined }}>{Math.round(soldPct * 100)}% of the bucket{t.unlimited ? ` · ${t.unlimited} workspace(s) with no limit` : ''}</div></Card>
        <Card><div className="cc-k">Workspaces near or at their limit</div><div className="cc-v">{d.tenants.filter((x) => x.pct != null && x.pct >= 0.8).length}</div><div className="cell-sub">80% or more of their quota</div></Card>
      </div>

      <Card title="Object storage bucket" actions={canManage && b.configured ? <button className="btn" disabled={syncing} onClick={sync}>{syncing ? 'Counting…' : 'Sync from bucket'}</button> : null}>
        {!b.configured ? <p style={{ margin: 0 }}><span className="pill grey">Not connected</span> Private files are still stored on the server. Set <code>S3_ENDPOINT</code>, <code>S3_REGION</code>, <code>S3_BUCKET</code>, <code>S3_ACCESS_KEY</code> and <code>S3_SECRET_KEY</code> on the server to switch to object storage.</p> : (
          <div style={{ display: 'grid', gap: 6 }}>
            <div><span className="pill green">Connected</span> bucket <b>{b.name}</b> · {b.endpoint} · region {b.region}</div>
            <div className="muted">“Sync from bucket” counts the real files in each workspace folder, so it also shows files the app does not know about. Quotas are enforced by the app; Contabo does not limit folders separately.</div>
            {b.unassigned_bytes > 0 && <div style={{ color: '#d97706' }}>{bytesText(b.unassigned_bytes)} sits in folders that belong to no workspace.</div>}
          </div>)}
        {canManage && <div className="row" style={{ gap: 8, marginTop: 12 }}><label htmlFor="tot" className="muted">Bucket size</label>
          <input id="tot" className="input" style={{ width: 110 }} type="number" min="1" value={total} onChange={(e) => setTotal(e.target.value)} /><span className="muted">GB</span>
          <button className="btn sm" disabled={Number(total) === b.total_gb} onClick={saveTotal}>Save</button></div>}
      </Card>

      <Card title="Storage included in each plan" flush>
        <div className="table-wrap"><table className="table"><thead><tr><th>Plan</th><th>Product</th><th className="num">Workspaces</th><th className="num">Now</th><th>Change{canEditPlans ? '' : ' (needs plan editing access)'}</th></tr></thead>
          <tbody>{d.plans.map((p) => <PlanRow key={p.id} plan={p} canEdit={canEditPlans} reload={load} />)}</tbody></table></div>
        <p className="muted" style={{ margin: '8px 14px 12px', fontSize: 13 }}>A new limit applies to every workspace on the plan that has no limit of its own. Empty means unlimited. The same plan appears in Plans & pricing.</p>
      </Card>

      <Card title="Workspaces" actions={<input className="input" style={{ width: 200 }} placeholder="Find a workspace" aria-label="Find a workspace" value={q} onChange={(e) => setQ(e.target.value)} />} flush>
        <div className="table-wrap"><table className="table"><thead><tr><th>Workspace</th><th>Plan</th><th className="num">Public images</th><th className="num">Private files</th><th className="num">Used</th><th className="num">Limit</th><th>Usage</th><th className="num">In bucket (counted)</th><th /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id}>
              <td>{x.name}<div className="cell-sub">{x.slug}{x.status !== 'active' ? ` · ${x.status}` : ''}</div></td>
              <td>{x.plan_name}{x.override_mb !== undefined && <div className="cell-sub">own limit (plan: {mbText(x.plan_mb)})</div>}</td>
              <td className="num">{bytesText(x.public_bytes)}</td><td className="num">{bytesText(x.private_bytes)}</td><td className="num">{bytesText(x.used_bytes)}</td>
              <td className="num">{x.quota_mb == null ? 'Unlimited' : mbText(x.quota_mb)}</td>
              <td><Meter pct={x.pct} label={`${x.name} usage`} />{x.full && <span className="pill red">full</span>}{!x.full && x.warned && <span className="pill amber">80%+</span>}</td>
              <td className="num">{x.bucket_bytes == null ? <span className="muted">not counted</span> : `${bytesText(x.bucket_bytes)} (${x.bucket_files})`}{x.bucket_bytes != null && Math.abs(x.bucket_bytes - x.private_bytes) > 1024 && <div className="cell-sub" style={{ color: '#d97706' }}>differs from app records</div>}</td>
              <td>{canManage && <button className="btn sm" onClick={() => setEdit(x)}>Edit limit</button>}</td>
            </tr>))}
            {!rows.length && <tr><td colSpan={9} className="muted">No workspaces found.</td></tr>}</tbody></table></div>
      </Card>
      {edit && <QuotaModal t={edit} onClose={() => setEdit(null)} reload={load} />}
    </>
  );
}
