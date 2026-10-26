// Settings > WhatsApp: connect the workspace's own Botlinkd account (official WhatsApp Cloud API), copy the webhook address into
// Botlinkd, send one test message. The keys are saved encrypted and never shown again.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Loading, PageHead, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc } from '../format.js';

const TONE = { connected: 'green', configured: 'amber', error: 'red', not_configured: 'grey' };
const LABEL = { connected: 'Connected', configured: 'Saved, not confirmed yet', error: 'Problem', not_configured: 'Not connected' };

function QrCard({ q, reload, edit }) {
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [st, setSt] = useState(null);
  const live = q.active || st?.state === 'qr' || st?.state === 'connecting';
  useEffect(() => {
    if (!q.accepted || !edit) return undefined;
    let stop = false;
    const tick = () => api.get('/api/whatsapp/qr/status').then((r) => { if (!stop) setSt(r); }).catch(() => {});
    tick();
    const h = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(h); };
  }, [q.accepted, edit]);
  if (!q.platform_ready) return null;
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) toast(ok, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const state = st?.state || q.state;
  return (
    <Card title="QR connection (optional, unofficial)" actions={<StatusBadge tone={state === 'connected' ? 'green' : q.accepted ? 'amber' : 'grey'} label={state === 'connected' ? 'Linked' : q.accepted ? 'On, not linked' : 'Off'} />}>
      {!q.allowed ? <p className="muted" style={{ margin: 0 }}>QR connection is not part of your plan.</p> : <>
        <div className="alert warn">{q.risk_text}</div>
        {!q.accepted ? (edit ? <>
          <label className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>I understand that my number can be banned and that this is against WhatsApp's terms for business use.</span></label>
          <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={!ack || busy === 'on'} onClick={() => run('on', () => api.post('/api/whatsapp/qr/enable', { acknowledge: true }), 'QR connection switched on')}>Switch on QR connection</button></div>
        </> : <p className="muted">Only people who can edit settings can switch this on.</p>) : edit && <>
          {state === 'connected' ? <p style={{ marginBottom: 0 }}>Linked number: <span className="mono">{st?.number || q.number ? `+${st?.number || q.number}` : 'unknown'}</span>. Customer messages arrive in the WhatsApp inbox and replies go out through this link.</p>
            : st?.qr_image ? <div><p style={{ marginTop: 10 }}>On the phone: WhatsApp &gt; Linked devices &gt; Link a device, then scan this code. It refreshes by itself.</p><img src={st.qr_image} alt="WhatsApp QR code to scan" width="240" height="240" style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }} /></div>
            : st?.state === 'error' ? <div className="alert err" style={{ marginTop: 10 }}>The gateway is not answering: {st.error}</div>
            : state === 'disconnected' ? <div className="alert err" style={{ marginTop: 10 }}>The phone unlinked this session. Start again to get a new QR code.</div>
            : live ? <p className="muted" style={{ marginTop: 10 }}>Waiting for the QR code…</p> : null}
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {state !== 'connected' && <button className="btn primary" disabled={busy === 'start'} onClick={() => run('start', () => api.post('/api/whatsapp/qr/start'), 'Session started. Scan the QR code when it appears.')}>{busy === 'start' ? 'Starting…' : 'Show QR code'}</button>}
            {q.active && <button className="btn" onClick={() => run('off', () => api.post('/api/whatsapp/qr/disconnect'), 'Unlinked')}>Unlink</button>}
            <button className="btn danger" onClick={() => window.confirm('Switch QR connection off for this workspace? The link is removed and the official connection is used again.') && run('del', () => api.post('/api/whatsapp/qr/disable'), 'QR connection switched off')}>Switch QR connection off</button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>The same rules apply: one-to-one replies within 24 hours of the customer's message, no bulk sending, STOP blocking and your daily and monthly limits.</p>
        </>}
      </>}
    </Card>
  );
}

const blankTpl = () => ({ name: '', language: 'en', params: '', preview: '', approved: false });
/** Templates created and approved in the workspace's Botlinkd account. Botlinkd has no call that lists them, so they are recorded here. */
function TemplatesCard({ c, reload }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => (c.templates || []).map((x) => ({ ...x, params: (x.params || []).join(', ') })));
  const [busy, setBusy] = useState(false);
  const set = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try { await api.put('/api/whatsapp/templates', { templates: rows.map((x) => ({ ...x, params: String(x.params || '').split(',').map((v) => v.trim()).filter(Boolean) })) }); toast('Templates saved', 'ok'); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title="Message templates">
      <p className="muted" style={{ marginTop: 0 }}>WhatsApp only lets a business start a chat, or write again after 24 hours of silence, with a template that WhatsApp has approved. Create the template in your Botlinkd account, wait until it is approved, then list it here exactly as named there and tick Approved. Agentify cannot check the approval itself, so a template you tick that is not really approved will be rejected when sent. Staff send one template to one person at a time from the inbox.</p>
      {rows.map((x, i) => (
        <div key={i} className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--line, #e5e7eb)' }}>
          <Field label="Template name" hint="As in Botlinkd, e.g. viewing_reminder"><input className="input" value={x.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
          <Field label="Language"><input className="input" value={x.language} onChange={(e) => set(i, { language: e.target.value })} /></Field>
          <Field label="Values, in order" hint="Names of the placeholders, comma-separated, e.g. Customer name, Time"><input className="input" value={x.params} onChange={(e) => set(i, { params: e.target.value })} /></Field>
          <Field label="Preview text (optional)" hint="Use {{1}}, {{2}} for the values"><input className="input" value={x.preview} onChange={(e) => set(i, { preview: e.target.value })} /></Field>
          <label className="row" style={{ alignItems: 'center', gap: 6 }}><input type="checkbox" checked={x.approved} onChange={(e) => set(i, { approved: e.target.checked })} /> Approved in Botlinkd</label>
          <div><button className="btn sm danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button></div>
        </div>))}
      {!rows.length && <p className="muted">No templates yet.</p>}
      <div className="row"><button className="btn" onClick={() => setRows([...rows, blankTpl()])} disabled={rows.length >= 20}>Add a template</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save templates'}</button></div>
    </Card>
  );
}

export default function WhatsAppSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: c, loading, reload } = useFetch('/api/whatsapp/connection');
  const [f, setF] = useState({ appkey: '', authkey: '', number: '', signing_secret: '' });
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const edit = can('settings', 'edit');
  if (loading || !c) return <Loading />;
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) toast(ok, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const save = () => run('save', async () => { await api.put('/api/whatsapp/connection', Object.fromEntries(Object.entries(f).filter(([, v]) => v))); setF({ appkey: '', authkey: '', number: '', signing_secret: '' }); }, 'Saved. Now copy the webhook address into Botlinkd, then send a test.');
  const copy = async () => { try { await navigator.clipboard.writeText(c.webhook_url); toast('Copied', 'ok'); } catch { toast('Select the address and copy it', 'err'); } };
  return (
    <div>
      <PageHead title="WhatsApp" sub="Answer your customers' WhatsApp chats inside the CRM, through your own Botlinkd account." />
      {!c.access.enabled && <div className="alert warn" style={{ marginBottom: 12 }}>{c.access.message}</div>}
      <Card title="Connection" actions={<StatusBadge tone={TONE[c.state]} label={LABEL[c.state]} />}>
        {c.last_error && c.state === 'error' && <div className="alert err">{c.last_error}</div>}
        <p className="muted" style={{ marginTop: 0 }}>Botlinkd connects your own WhatsApp Business number to the official WhatsApp Cloud API. Agentify never sees your number's password, and customers' chats stay in your workspace only. {c.keys ? <>Saved keys: App key <span className="mono">{c.keys.appkey}</span>, Auth key <span className="mono">{c.keys.authkey}</span>{c.number ? <>, number <span className="mono">+{c.number}</span></> : null}.</> : null}</p>
        <ol className="steps">
          <li>Create your Botlinkd account and connect your WhatsApp Business number there (Botlinkd walks you through the Meta sign-in; this is the official route, no QR code or WhatsApp Web session is used).</li>
          <li>Copy the <b>App key</b> and <b>Auth key</b> from Botlinkd and paste them below with the number.</li>
          <li>In Botlinkd open your platform's <b>Auto Reply Settings</b>, enable auto reply, choose <b>External Webhook</b>, paste the webhook address shown here and choose <b>Events Only</b>. If you switch on signing there, paste Botlinkd's secret below.</li>
          <li>Ask someone to send a WhatsApp message to your number. It appears in the <Link to="/whatsapp">WhatsApp inbox</Link> and this page turns to Connected.</li>
        </ol>
        {edit && <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <Field label="App key" hint={c.keys ? 'Leave blank to keep the saved key' : ''}><input className="input" type="password" autoComplete="off" value={f.appkey} onChange={(e) => setF({ ...f, appkey: e.target.value })} /></Field>
            <Field label="Auth key" hint={c.keys ? 'Leave blank to keep the saved key' : ''}><input className="input" type="password" autoComplete="off" value={f.authkey} onChange={(e) => setF({ ...f, authkey: e.target.value })} /></Field>
            <Field label="WhatsApp number" hint="International digits, e.g. 447700900123"><input className="input" inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder={c.number || ''} /></Field>
            <Field label="Signing secret (optional)" hint={c.signing_secret_saved ? 'A secret is saved. Leave blank to keep it.' : 'Only if signing is switched on in Botlinkd'}><input className="input" type="password" autoComplete="off" value={f.signing_secret} onChange={(e) => setF({ ...f, signing_secret: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={busy === 'save' || !Object.values(f).some(Boolean)} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            {c.configured && <button className="btn danger" onClick={() => window.confirm('Disconnect WhatsApp? Your conversations stay, but nothing can be sent or received until you connect again.') && run('off', () => api.del('/api/whatsapp/connection'), 'Disconnected')}>Disconnect</button>}</div>
        </>}
      </Card>
      {c.configured && <>
        <div style={{ height: 12 }} />
        <Card title="Webhook address for Botlinkd">
          {c.webhook_url ? <>
            <p className="muted" style={{ marginTop: 0 }}>Paste this into Botlinkd as the External Webhook. It contains a secret, so only share it with Botlinkd.{!c.signing_secret_saved && ' Signing is off: only this secret address protects the webhook. Turn on signing in Botlinkd and paste its secret above for stronger protection.'}</p>
            <div className="row"><input className="input mono" readOnly value={c.webhook_url} aria-label="Webhook address" onFocus={(e) => e.target.select()} /><button className="btn" onClick={copy}>Copy</button>
              {edit && <button className="btn" onClick={() => window.confirm('Create a new address? Update it in Botlinkd straight away or incoming messages stop arriving.') && run('rot', () => api.post('/api/whatsapp/connection/rotate-webhook'), 'New address created. Paste it into Botlinkd.')}>Create a new address</button>}</div>
          </> : <Empty title="Only people who can edit settings see this address" />}
          <p className="muted" style={{ marginBottom: 0 }}>{c.last_inbound_at ? `Last customer message received ${dateTimeUtc(c.last_inbound_at)}.` : 'No customer message has arrived yet.'}</p>
        </Card>
        {edit && <>
          <div style={{ height: 12 }} />
          <Card title="Send a test message">
            <p className="muted" style={{ marginTop: 0 }}>Botlinkd has no read-only check, so the test sends one real message to the number you type. Use your own phone. It counts toward your WhatsApp limit.</p>
            <div className="row"><input className="input" inputMode="numeric" style={{ maxWidth: 240 }} placeholder="Your own number, digits only" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Number to test" /><button className="btn primary" disabled={!to || busy === 'test' || !c.access.enabled} onClick={() => run('test', () => api.post('/api/whatsapp/connection/test', { to }), 'Test message accepted by Botlinkd')}>{busy === 'test' ? 'Sending…' : 'Send test'}</button></div>
          </Card>
          <div style={{ height: 12 }} />
          <TemplatesCard key={JSON.stringify(c.templates)} c={c} reload={reload} />
        </>}
      </>}
      <div style={{ height: 12 }} />
      <QrCard q={c.qr} reload={reload} edit={edit} />
      <div style={{ height: 12 }} />
      <Card title="This month">
        {c.usage.monthly != null ? <><ProgressBar value={Math.min(100, Math.round((c.usage.month / Math.max(1, c.usage.monthly)) * 100))} /><p style={{ margin: '8px 0 0' }}><b>{c.usage.month}</b> of {c.usage.monthly} replies sent this month · <b>{c.usage.day}</b> of {c.usage.daily} today</p></> : <p style={{ margin: 0 }}>{c.usage.month} replies sent this month.</p>}
        <p className="muted" style={{ marginBottom: 0 }}>These count replies sent from Agentify. Botlinkd and WhatsApp have their own conversation charges on your Botlinkd bill.</p>
      </Card>
      <div style={{ height: 12 }} />
      <Card title="Rules that protect your number">
        <ul className="plain" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Free-text replies are one-to-one, written by your team, and only within {c.safeguards.window_hours} hours of the customer's last message. After that, or to start a chat, staff send one approved template to one person at a time. There is no bulk or campaign sending.</li>
          <li>If a customer writes STOP, UNSUBSCRIBE or similar, they are blocked automatically until they write START or you record why messaging is allowed again.</li>
          <li>Each person can send {c.safeguards.per_user_per_minute} messages a minute, and your plan caps the day and the month.</li>
          <li>Only message people who contacted you or agreed to be contacted. WhatsApp can restrict or ban numbers that get blocked or reported, and Agentify cannot reverse a ban. Messages that start a conversation need templates approved by WhatsApp, which are not part of this release.</li>
        </ul>
      </Card>
    </div>
  );
}
