// Super Admin console: Email operations. Provider health and usage, platform and per-workspace consumption, delivery health,
// failures, provider limits and manual commercial notes, onboarding-email schedule. Tenant data shown here is aggregate counts.
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);


const CHECK = { domains: 'Domains (verify sender domains)', webhooks: 'Webhooks (delivery events)', usage: 'Usage and limits' };
function ResendConnection() {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api.get(`${A}/email/resend`).then(setC).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!c) return null;
  const run = async (key, path, ok) => { setBusy(key); try { const r = await api.post(`${A}/email/resend/${path}`); toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); load(); } };
  const t = c.last_test;
  const [sec, setSec] = useState('');
  const saveSecret = async () => { try { await api.post(`${A}/email/resend/webhook-secret`, { secret: sec }); setSec(''); toast('Signing secret saved', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } };
  const reg = c.webhook.registered;
  const domains = t?.checks?.domains?.list || [];
  return (
    <Card title="Resend connection" actions={<StatusBadge tone={!c.key.saved ? 'red' : t?.ok ? 'green' : t ? 'amber' : 'grey'} label={!c.key.saved ? 'No key saved' : t?.ok ? 'Connected' : t ? 'Needs attention' : 'Not tested yet'} />}>
      <p style={{ marginTop: 0 }}>{c.key.saved ? <>API key saved{c.key.last4 ? <> (ends in <span className="mono">{c.key.last4}</span>)</> : null}, from the {c.key.source}. It is stored encrypted and is never shown again.</> : 'Paste your Resend API key under Integrations > Email. It is stored encrypted and is never shown again.'} <a href="/platform/integrations">Open Integrations</a></p>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!c.key.saved || busy === 'test'} onClick={() => run('test', 'test', (r) => (r.ok ? 'Connection works' : r.summary))}>Test connection</button>
        <button className="btn" disabled={!c.key.saved || busy === 'wh'} onClick={() => run('wh', 'webhook', (r) => (r.outcome === 'created' ? 'Webhook created at Resend' : r.outcome === 'adopted_updated' ? `Existing webhook adopted; added ${r.added_events.join(', ')}` : 'Existing webhook adopted, nothing to change') + (r.needs_secret ? '. Now save its signing secret below.' : ''))}>Register webhook</button>
        <button className="btn" disabled={!c.key.saved || busy === 'mail'} onClick={() => run('mail', 'test-email', (r) => `Test email sent to ${r.to}`)}>Send a test email to me</button>
      </div>
      {t && <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 4 }}>
        {Object.entries(t.checks).map(([k, v]) => <li key={k}>{v.ok ? '✓' : '✗'} <strong>{CHECK[k] || k}</strong>{v.ok ? (v.count != null ? ` · ${v.count} found${v.verified != null ? `, ${v.verified} verified` : ''}` : '') : <span className="muted"> · {v.error}</span>}</li>)}
        <li className="muted" style={{ fontSize: 12.5 }}>{t.summary} Checked {String(t.at).replace('T', ' ').slice(0, 19)} UTC by {t.by}.</li>
      </ul>}
      <div style={{ marginTop: 12 }}>
        <strong>Webhook</strong>
        <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{c.webhook.url}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>Signing secret: {c.webhook.secret_saved ? 'saved' : 'not saved (events are refused until it is)'} · Last event: {c.webhook.last_event_at ? `${c.webhook.last_event_type} at ${String(c.webhook.last_event_at).replace('T', ' ').slice(0, 19)}` : 'none yet'}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>Subscribed to: {c.webhook.events.join(', ')}. Opens and clicks are not used.</div>
        {reg && <div className="muted" style={{ fontSize: 12.5 }}>Last registration: {reg.outcome === 'created' ? 'created a new webhook' : reg.outcome === 'adopted_updated' ? `adopted the existing webhook and added ${reg.added_events.join(', ')}` : 'adopted the existing webhook unchanged'}{reg.duplicates ? ` (${reg.duplicates} more at the same address were left alone)` : ''}.</div>}
        <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: 'end' }}>
          <Field label="Signing secret (starts with whsec_)" hint="Saved encrypted on the server over HTTPS and never shown again. You can rotate the secret in the Resend dashboard first, then paste the new one here."><TextInput type="password" autoComplete="off" value={sec} onChange={setSec} /></Field>
          <button className="btn" disabled={!sec} onClick={saveSecret}>Save secret</button>
        </div>
      </div>
      {domains.length > 0 && <div style={{ marginTop: 12 }}>
        <strong>Domains already at Resend</strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>{domains.map((d) => <li key={d.name} className="muted" style={{ fontSize: 12.5 }}>{d.name} · {d.status}{d.sending ? ' · sending on' : ''}{d.receiving ? ' · receiving on' : ''}. Used as it is; nothing is created or changed.</li>)}</ul>
      </div>}
      <div style={{ marginTop: 12 }}>
        <strong>Replies (inbound)</strong>
        <div className="muted" style={{ fontSize: 12.5 }}>{c.inbound.domain ? `Reply domain ${c.inbound.domain}. Last inbound message: ${c.inbound.last_mail_at ? String(c.inbound.last_mail_at).replace('T', ' ').slice(0, 19) : 'none yet'}.` 
: `Reply detection is off. ${c.inbound.receiving_domains.length ? `Resend already receives mail for ${c.inbound.receiving_domains.join(', ')}. Choose the reply address under Provider limits > Reply domain to turn it on (a separate name such as reply.<your domain> keeps ordinary mail on the main domain untouched).` : 'Choose a reply domain that Resend receives mail for to turn it on.'} Until then staff can pause a sequence or record a reply by hand.`}</div>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>Live smoke test (about 10 minutes)</summary>
        <ol style={{ paddingInlineStart: 18, margin: '8px 0 0', display: 'grid', gap: 4 }}>
          <li>Press <strong>Test connection</strong>. All three lines should show a tick.</li>
          <li>Press <strong>Send a test email to me</strong> and check your own inbox (and spam).</li>
          <li>Press <strong>Register webhook</strong>, then in Resend open Webhooks and use <em>Send test event</em>. "Last event" above should update.</li>
          <li>In a test workspace, add one sending domain under Settings &gt; Email, publish the DNS records and press Check until it says verified.</li>
          <li>From that workspace send one test email to your own address, and confirm it moves from queued to delivered.</li>
          <li>Reply detection is only live once a reply domain is chosen and Resend receives mail for it.</li>
        </ol>
      </details>
    </Card>
  );
}

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
      <ResendConnection />
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
