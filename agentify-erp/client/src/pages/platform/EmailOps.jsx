// Super Admin console: Email operations. Provider health and usage, platform and per-workspace consumption, delivery health,
// failures, provider limits and manual commercial notes, onboarding-email schedule. Tenant data shown here is aggregate counts.
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);

export default function EmailOps() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState(null);
  const load = useCallback(() => api.get(`${A}/email/summary`).then((x) => { setD(x); setF({ monthly: x.provider.limits?.monthly ?? '', daily: x.provider.limits?.daily ?? '', reserve: x.provider.limits?.reserve_for_service ?? '', pkg: x.provider.commercial?.package_name || '', cost: x.provider.commercial?.monthly_cost ?? '', cur: x.provider.commercial?.currency || '', notes: x.provider.commercial?.notes || '', inbound: x.settings.inbound_reply_domain || '' }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <ErrorBox error={err} />;
  if (!d || !f) return <Loading />;
  const save = async () => {
    try {
      await api.put(`${A}/email/settings`, { provider_limits: { monthly: f.monthly, daily: f.daily, reserve_for_service: f.reserve }, commercial: { package_name: f.pkg, monthly_cost: f.cost, currency: f.cur, notes: f.notes }, inbound_reply_domain: f.inbound });
      toast('Saved'); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const sync = async () => { const r = await api.post(`${A}/email/sync-usage`); toast(r.ok ? 'Usage refreshed' : r.error, r.ok ? 'ok' : 'err'); load(); };
  const u = d.provider.usage?.data;
  return (
    <div>
      <PageTitle title="Email operations" sub="Tenant email: provider health, consumption, delivery quality and the queue. Account and security email is counted separately." />
      <div className="pa-grid2">
        <Card title="Provider" actions={<StatusBadge tone={d.provider.connected ? 'green' : 'red'} label={d.provider.connected ? 'Connected' : 'Not connected'} />}>
          <p style={{ margin: 0 }}>Last successful usage sync: <strong>{d.provider.last_success_at ? d.provider.last_success_at.replace('T', ' ').slice(0, 19) : 'never'}</strong></p>
          {d.provider.usage_error && <div className="alert warn" style={{ marginTop: 8 }}>Last sync problem: {d.provider.usage_error}</div>}
          {u ? <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{JSON.stringify(u, null, 2)}</pre> : <p className="muted">No usage reading yet.</p>}
          <p className="muted" style={{ fontSize: 12.5 }}>Shown exactly as the provider returns it. It does not include plan names, invoices or prices.</p>
          <button className="btn" onClick={sync}>Refresh usage now</button>
        </Card>
        <Card title="Queue and delivery health">
          <p style={{ margin: 0 }}>Waiting: <strong>{d.queue.queued}</strong> · Unconfirmed: <strong>{d.queue.ambiguous}</strong> · Failed (30 days): <strong>{d.queue.failed_30d}</strong>{d.queue.paused_until ? ` · Paused until ${d.queue.paused_until}` : ''}</p>
          <p style={{ margin: '6px 0 0' }}>Accepted (30 days): <strong>{d.health.accepted_30d}</strong> · Bounce rate <strong>{pct(d.health.bounce_rate)}</strong> · Complaint rate <strong>{pct(d.health.complaint_rate)}</strong></p>
          <p className="muted" style={{ fontSize: 12.5 }}>Account and security email in the last 30 days: {d.service_mail_30d}. Tenant mail yields to it when provider limits are close.</p>
        </Card>
      </div>
      <Card title="Provider limits (entered by hand) and commercial notes">
        <p className="muted" style={{ marginTop: 0 }}>These are your own figures, used to protect capacity for account email and to label estimated cost. Nothing here is read from the provider's billing.</p>
        <div className="pa-grid3">
          <Field label="Monthly send limit"><TextInput type="number" value={f.monthly} onChange={(v) => setF({ ...f, monthly: v })} /></Field>
          <Field label="Daily send limit"><TextInput type="number" value={f.daily} onChange={(v) => setF({ ...f, daily: v })} /></Field>
          <Field label="Keep free for account email" hint="Marketing stops this far below the limit"><TextInput type="number" value={f.reserve} onChange={(v) => setF({ ...f, reserve: v })} /></Field>
          <Field label="Package name (note)"><TextInput value={f.pkg} onChange={(v) => setF({ ...f, pkg: v })} /></Field>
          <Field label="Estimated monthly cost"><TextInput type="number" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} /></Field>
          <Field label="Currency"><TextInput value={f.cur} onChange={(v) => setF({ ...f, cur: v })} /></Field>
          <Field label="Reply domain" hint="Domain that receives replies to follow-up emails (needs inbound email set up with the provider). Empty = reply detection off."><TextInput value={f.inbound} onChange={(v) => setF({ ...f, inbound: v })} /></Field>
        </div>
        <Field label="Notes"><TextInput value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
        <button className="btn primary" onClick={save}>Save</button>
      </Card>
      <Card title="Workspace consumption (last 30 days)" flush>
        {d.tenants.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Workspace</th><th>Type</th><th>Queued/used</th><th>Accepted</th><th>Delivered</th><th>Bounced</th><th>Complained</th><th>Failed</th><th>Stopped</th></tr></thead><tbody>
          {d.tenants.map((t) => <tr key={`${t.tenant_id}${t.category}`}><td>{t.name}</td><td>{t.category}</td><td>{t.used}</td><td>{t.accepted}</td><td>{t.delivered}</td><td>{t.bounced}</td><td>{t.complained}</td><td>{t.failed}</td><td>{t.stopped}</td></tr>)}
        </tbody></table></div> : <Empty title="No tenant email yet" />}
      </Card>
      <Card title="Recent failures and unconfirmed sends" flush>
        {d.recent_failures.length ? <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Workspace</th><th>To</th><th>Status</th><th>Detail</th><th /></tr></thead><tbody>
          {d.recent_failures.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.tenant_id}</td><td>{r.to_addr}</td><td>{r.status}</td><td>{r.last_error}</td><td>{r.status === 'ambiguous' || r.status === 'failed' ? <button className="btn sm" onClick={async () => { await api.post(`${A}/email/queue/${r.id}/release`); load(); }}>Release quota</button> : null}</td></tr>)}
        </tbody></table></div> : <Empty title="No failures" />}
      </Card>
      <Card title="Setup email schedule">
        <p className="muted" style={{ marginTop: 0 }}>Sent to workspace owners from Agentify, only inside their local {d.onboarding.hours[0]}:00–{d.onboarding.hours[1]}:00, at most {d.onboarding.max_per_week} a week, skipped when a step is already done.</p>
        <Toggle value={d.onboarding.enabled} onChange={async (v) => { await api.put(`${A}/email/onboarding`, { enabled: v }); load(); }} label="Onboarding emails on" />
        <div className="pa-grid3" style={{ marginTop: 8 }}>
          {Object.entries(d.onboarding.messages).map(([k, m]) => <Toggle key={k} value={m.enabled} onChange={async (v) => { await api.put(`${A}/email/onboarding`, { messages: { [k]: { enabled: v } } }); load(); }} label={`${k.replace('_', ' ')}${m.day ? ` (day ${m.day})` : ''}`} />)}
        </div>
      </Card>
    </div>
  );
}
