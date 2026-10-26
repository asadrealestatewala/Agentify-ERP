// Settings > WhatsApp: connect the workspace's own Botlinkd account (official WhatsApp Cloud API), copy the webhook address into
// Botlinkd, send one test message. The keys are saved encrypted and never shown again.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Loading, PageHead, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc } from '../format.js';

const TONE = { connected: 'green', configured: 'amber', error: 'red', not_configured: 'grey' };
const LABEL = { connected: 'Connected', configured: 'Saved, not confirmed yet', error: 'Problem', not_configured: 'Not connected' };

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
        </>}
      </>}
      <div style={{ height: 12 }} />
      <Card title="This month">
        {c.usage.monthly != null ? <><ProgressBar value={Math.min(100, Math.round((c.usage.month / Math.max(1, c.usage.monthly)) * 100))} /><p style={{ margin: '8px 0 0' }}><b>{c.usage.month}</b> of {c.usage.monthly} replies sent this month · <b>{c.usage.day}</b> of {c.usage.daily} today</p></> : <p style={{ margin: 0 }}>{c.usage.month} replies sent this month.</p>}
        <p className="muted" style={{ marginBottom: 0 }}>These count replies sent from Agentify. Botlinkd and WhatsApp have their own conversation charges on your Botlinkd bill.</p>
      </Card>
      <div style={{ height: 12 }} />
      <Card title="Rules that protect your number">
        <ul className="plain" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Replies are one-to-one, written by your team, and only within {c.safeguards.window_hours} hours of the customer's last message. There is no bulk or campaign sending.</li>
          <li>If a customer writes STOP, UNSUBSCRIBE or similar, they are blocked automatically until they write START or you record why messaging is allowed again.</li>
          <li>Each person can send {c.safeguards.per_user_per_minute} messages a minute, and your plan caps the day and the month.</li>
          <li>Only message people who contacted you or agreed to be contacted. WhatsApp can restrict or ban numbers that get blocked or reported, and Agentify cannot reverse a ban. Messages that start a conversation need templates approved by WhatsApp, which are not part of this release.</li>
        </ul>
      </Card>
    </div>
  );
}
