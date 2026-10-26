// Settings > Email: sender domain and addresses, allowance and usage, delivery history, suppressions. Everything shown is this
// workspace's own; provider credentials never reach the browser.
import { useState } from 'react';
import { Card, Empty, Field, Loading, PageHead, StatusBadge, ProgressBar } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';

const STATE_TONE = { ok: 'green', warning: 'amber', exhausted: 'red', daily_limit: 'amber', paused: 'red', not_configured: 'grey' };
const STATUS_TONE = { queued: 'grey', sending: 'blue', accepted: 'blue', delivered: 'green', bounced: 'red', complained: 'red', failed: 'red', suppressed: 'amber', cancelled: 'grey', ambiguous: 'amber' };
const CAT = { operational: 'Appointments and receipts', marketing: 'Campaigns and follow-up sequences' };

function Allowance({ a }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
      {Object.entries(a.categories).map(([k, c]) => (
        <Card key={k} title={CAT[k]} actions={<StatusBadge tone={STATE_TONE[c.state]} label={{ ok: 'Sending', warning: 'Nearly used', exhausted: 'Paused', daily_limit: 'Daily limit', paused: 'Paused', not_configured: 'Not set up' }[c.state]} />}>
          {c.monthly_allowance != null ? <>
            <ProgressBar value={Math.min(100, c.percent || 0)} tone={c.percent >= 90 ? 'red' : c.percent >= 70 ? 'amber' : undefined} />
            <p style={{ margin: '8px 0 0' }}><strong>{c.used}</strong> of {c.monthly_allowance} used{c.topup ? ` (includes ${c.topup} added)` : ''} · {c.remaining} left · {c.reserved} waiting to send</p>
          </> : <p style={{ margin: 0 }}>{c.configured ? `${c.used} used this period. No monthly limit.` : 'No allowance set for your plan.'}</p>}
          {c.daily_limit != null && <p className="muted" style={{ margin: '4px 0 0' }}>Daily limit {c.daily_limit}; {c.today} today.</p>}
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>Resets {a.period.resets_at.slice(0, 10)} (UTC). Counted per recipient, once the provider accepts the message.</p>
          {c.message && <div className="alert warn" style={{ marginTop: 8 }}>{c.message}</div>}
        </Card>))}
    </div>
  );
}

function Domains({ data, can, reload }) {
  const toast = useToast();
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(null);
  const [s, setS] = useState({ domain_id: '', local_part: '', display_name: '', reply_to: '' });
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) toast(ok, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); } };
  return (
    <Card title="Sender domain and addresses">
      <p className="muted" style={{ marginTop: 0 }}>Add a domain your company owns, publish the DNS records below at your domain provider, then check. Only addresses on a verified domain can send.</p>
      {data.domains.map((d) => (
        <div key={d.id} style={{ borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 10, marginTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{d.domain}</strong>
            <span className="row"><StatusBadge tone={d.verified ? 'green' : d.status === 'failed' ? 'red' : 'amber'} label={d.verified ? 'Verified' : d.status === 'failed' ? 'Failed' : 'Waiting for DNS'} />
              {can && !d.verified && <button className="btn sm" disabled={busy === `c${d.id}`} onClick={() => run(`c${d.id}`, () => api.post(`/api/email/domains/${d.id}/check`), 'Checked')}>{busy === `c${d.id}` ? 'Checking…' : 'Check now'}</button>}
              {can && <button className="btn sm danger" onClick={() => window.confirm(`Remove ${d.domain}? Its sender addresses stop working.`) && run(`r${d.id}`, () => api.del(`/api/email/domains/${d.id}`))}>Remove</button>}</span>
          </div>
          {d.error && !d.verified && <div className="alert warn" style={{ marginTop: 8 }}>{d.error}</div>}
          {!d.verified && <div className="table-wrap"><table className="t"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th></tr></thead><tbody>
            {d.records.map((r, i) => <tr key={i}><td>{r.type}</td><td className="mono">{r.name}</td><td className="mono" style={{ wordBreak: 'break-all' }}>{r.priority != null ? `${r.priority} ` : ''}{r.value}</td><td>{String(r.status).replace('_', ' ')}</td></tr>)}
          </tbody></table></div>}
        </div>))}
      {can && <div className="row" style={{ marginTop: 12 }}>
        <input className="input" placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} style={{ maxWidth: 260 }} aria-label="Domain" />
        <button className="btn primary" disabled={!domain || busy === 'add'} onClick={() => run('add', async () => { await api.post('/api/email/domains', { domain }); setDomain(''); }, 'Domain added. Publish the DNS records, then check.')}>Add domain</button>
      </div>}
      <h4 style={{ margin: '18px 0 6px' }}>Sender addresses</h4>
      {data.senders.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Address</th><th>Name</th><th>Reply-To</th><th>State</th><th /></tr></thead><tbody>
        {data.senders.map((x) => <tr key={x.id}><td className="mono">{x.address}{x.is_default ? ' (default)' : ''}</td><td>{x.display_name || '—'}</td><td>{x.reply_to || '—'}</td>
          <td><StatusBadge tone={x.can_send ? 'green' : 'amber'} label={x.can_send ? 'Can send' : x.domain_status !== 'verified' ? 'Domain not verified' : 'Off'} /></td>
          <td>{can && <span className="row"><button className="btn sm" onClick={() => run(`a${x.id}`, () => api.put(`/api/email/senders/${x.id}`, { active: !x.active }))}>{x.active ? 'Turn off' : 'Turn on'}</button>
            {!x.is_default && <button className="btn sm" onClick={() => run(`d${x.id}`, () => api.put(`/api/email/senders/${x.id}`, { is_default: true }))}>Make default</button>}
            <button className="btn sm danger" onClick={() => run(`x${x.id}`, () => api.del(`/api/email/senders/${x.id}`))}>Delete</button></span>}</td></tr>)}
      </tbody></table></div> : <Empty title="No sender address yet" hint="Add a domain, verify it, then create an address such as hello@yourcompany.com." />}
      {can && data.domains.length > 0 && <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginTop: 10 }}>
        <Field label="Domain"><select className="input" value={s.domain_id} onChange={(e) => setS({ ...s, domain_id: e.target.value })}><option value="">Choose…</option>{data.domains.map((d) => <option key={d.id} value={d.id}>{d.domain}{d.verified ? '' : ' (not verified)'}</option>)}</select></Field>
        <Field label="Address (before @)"><input className="input" value={s.local_part} onChange={(e) => setS({ ...s, local_part: e.target.value })} placeholder="hello" /></Field>
        <Field label="Sender name"><input className="input" value={s.display_name} onChange={(e) => setS({ ...s, display_name: e.target.value })} placeholder="Your company" /></Field>
        <Field label="Reply-To (optional)"><input className="input" value={s.reply_to} onChange={(e) => setS({ ...s, reply_to: e.target.value })} placeholder="sales@yourcompany.com" /></Field>
        <div style={{ alignSelf: 'end' }}><button className="btn primary" disabled={!s.domain_id || !s.local_part} onClick={() => run('sender', async () => { await api.post('/api/email/senders', s); setS({ domain_id: '', local_part: '', display_name: '', reply_to: '' }); }, 'Address added')}>Add address</button></div>
      </div>}
    </Card>
  );
}

function History() {
  const [status, setStatus] = useState('');
  const { data, loading } = useFetch('/api/email/history', { status, limit: 25 });
  return (
    <Card title="Sent and queued email" actions={<select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All</option>{Object.keys(STATUS_TONE).map((x) => <option key={x}>{x}</option>)}</select>}>
      {loading ? <Loading rows={3} /> : data?.rows?.length ? <div className="table-wrap"><table className="t"><thead><tr><th>To</th><th>Subject</th><th>Type</th><th>Status</th><th>When</th></tr></thead><tbody>
        {data.rows.map((r) => <tr key={r.id}><td>{r.to_addr}</td><td>{r.subject}</td><td>{r.category}</td><td><StatusBadge tone={STATUS_TONE[r.status]} label={r.status} />{r.last_error ? <div className="muted" style={{ fontSize: 12 }}>{r.last_error}</div> : null}</td><td className="nowrap">{r.created_at}</td></tr>)}
      </tbody></table></div> : <Empty title="Nothing sent yet" hint="Messages appear here with their delivery status." />}
      <p className="muted" style={{ fontSize: 12.5 }}>Accepted means the email provider took the message. Delivered, bounced and complained come from the provider afterwards. A bounced message still counts toward your allowance.</p>
    </Card>
  );
}

function Suppressions({ can }) {
  const toast = useToast();
  const { data, reload } = useFetch('/api/email/suppressions');
  const [email, setEmail] = useState('');
  const act = async (e, scope, remove) => { try { await api.post('/api/email/suppressions', { email: e, scope, remove }); setEmail(''); reload(); } catch (x) { toast(x.message, 'err'); } };
  return (
    <Card title="Do-not-email list">
      <p className="muted" style={{ marginTop: 0 }}>People who unsubscribed, complained, or whose address bounced. They are skipped automatically, including mail already waiting to send.</p>
      {data?.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Address</th><th>Blocks</th><th>Why</th><th /></tr></thead><tbody>
        {data.map((s) => <tr key={s.id}><td>{s.email}</td><td>{s.scope === 'all' ? 'All email' : 'Marketing'}</td><td>{s.reason}</td><td>{can && <button className="btn sm" onClick={() => act(s.email, s.scope, true)}>Remove</button>}</td></tr>)}
      </tbody></table></div> : <Empty title="Nobody is blocked" />}
      {can && <div className="row" style={{ marginTop: 8 }}><input className="input" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 260 }} aria-label="Address to block" /><button className="btn" disabled={!email} onClick={() => act(email, 'marketing')}>Block marketing email</button></div>}
    </Card>
  );
}

export default function EmailSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch('/api/email/overview');
  const prefs = useFetch('/api/email/preferences');
  const edit = can('settings', 'edit');
  if (loading || !data) return <Loading />;
  const test = async () => { try { await api.post('/api/email/test'); toast('Test email queued to your own address', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="Email" sub="Send appointment reminders and follow-ups from your own address. Account and security emails from Agentify are separate and never blocked by your allowance." />
      {!data.allowance.send_state.ok && <div className="alert err" style={{ marginBottom: 12 }}>Sending is paused: {({ subscription_inactive: 'your subscription is not active.', workspace_suspended: 'this workspace is suspended.', not_in_plan: 'email is not part of this workspace type.' })[data.allowance.send_state.reason]}</div>}
      <Allowance a={data.allowance} />
      <div style={{ height: 12 }} />
      <Domains data={data} can={edit} reload={reload} />
      <div style={{ height: 12 }} />
      <Card title="Replies">
        <div className={`alert ${data.reply_detection.configured ? 'info' : 'warn'}`}>{data.reply_detection.note}</div>
        {edit && <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={!data.can_send} onClick={test}>Send a test email to me</button>{!data.can_send && <span className="muted">Needs a verified sender address.</span>}</div>}
        {prefs.data && <label className="row" style={{ marginTop: 10 }}><input type="checkbox" disabled={!edit} checked={prefs.data.onboarding_emails} onChange={async (e) => { await api.put('/api/email/preferences', { onboarding_emails: e.target.checked }); prefs.reload(); }} /> Send me Agentify setup tips by email (account, security and billing emails are always sent)</label>}
      </Card>
      <div style={{ height: 12 }} />
      <History />
      <div style={{ height: 12 }} />
      <Suppressions can={edit} />
    </div>
  );
}
