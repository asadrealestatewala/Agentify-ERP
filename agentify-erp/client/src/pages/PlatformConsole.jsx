import { useCallback, useEffect, useState } from 'react';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, StatusBadge, Tabs, TextInput, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import TwoFactor from '../components/TwoFactor.jsx';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Workspaces, WorkspaceDetail, Expiry, FILTERS } from './SuperAdmin.jsx';
import AdminShell, { PageTitle, Allowed, useCan } from './platform/AdminShell.jsx';
import MobileAppPage from './platform/MobileApp.jsx';
import TrainingVideosPage from './platform/TrainingVideos.jsx';
import CostProfitPage from './platform/CostProfit.jsx';
import AiUsagePage from './platform/AiUsage.jsx';
import StoragePage from './platform/Storage.jsx';
import ContentCalendarPage from './platform/ContentCalendar.jsx';
import { AdminsPage, SessionsPage, LoginsPage, AuditPage, MaintenancePage, EmailSafetyPage } from './platform/Security.jsx';
import { ReportsPage, ReconciliationPage } from './platform/Reports.jsx';
import { Dashboard, HealthPage, NotificationsPage, SetupPage } from './platform/Dashboard.jsx';
import { PlansPage, TransactionsPage, SubscriptionHistoryPage } from './platform/Billing.jsx';
import { FinancePage } from './platform/Finance.jsx';
import { AnalyticsPage, WebsitePage, DemoRequestsPage, AnnouncementsPage, IntegrationsPage, ReviewsPage } from './platform/Content.jsx';
import LandingEditorPage from './platform/LandingEditor.jsx';
import { MailboxPage, SentLogPage, MailboxSettingsPage } from './platform/Mailbox.jsx';
import BillingMailPage from './platform/BillingMail.jsx';
import EmailOps from './platform/EmailOps.jsx';
import { RegionsPage } from "./platform/Regions.jsx";
import WhatsNew from './WhatsNew.jsx';
import FreeSitesPage from './platform/FreeSites.jsx';

const A = '/api/platform/admin';
const LINK = { background: 'none', border: 0, padding: 0, color: 'var(--primary)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' };

/** Password box with an eye button that shows or hides what was typed; the value itself is never changed. */
function PasswordInput({ value, onChange, autoComplete = 'current-password', ...p }) {
  const [shown, setShown] = useState(false);
  const label = shown ? 'Hide password' : 'Show password';
  return (
    <div style={{ position: 'relative' }}>
      <TextInput type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} style={{ paddingRight: 40 }} {...p} />
      <button type="button" className="btn ghost" title={label} aria-label={label} aria-pressed={shown} onClick={() => setShown((v) => !v)}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
      </button>
    </div>
  );
}

/** Forgotten password: asks for the email and always shows the same confirmation. */
function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post(`${A}/password/forgot`, { email }); setSent(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (sent) return (
    <div>
      <p>If that email belongs to a console account, a reset link is on its way. It works once and expires in 30 minutes.</p>
      <button type="button" className="btn" style={{ width: '100%' }} onClick={onBack}>Back to sign in</button>
    </div>
  );
  return (
    <form onSubmit={go}>
      {err && <div className="alert err">{err}</div>}
      <p className="muted">Enter your console email and we will send you a link to choose a new password.</p>
      <Field label="Email"><TextInput type="email" autoComplete="email" value={email} onChange={setEmail} autoFocus /></Field>
      <button className="btn primary" style={{ width: '100%' }} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      <p style={{ textAlign: 'center', marginTop: 12 }}><button type="button" style={LINK} onClick={onBack}>Back to sign in</button></p>
    </form>
  );
}

/** The page behind the emailed link. */
function ResetPassword({ token }) {
  const [info, setInfo] = useState(undefined);
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const nav = useNavigate();
  useEffect(() => { api.get(`${A}/password/reset/${token}`).then(setInfo).catch((e) => { setInfo(null); setErr(e.message); }); }, [token]);
  if (info === undefined) return <Loading />;
  const go = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) { setErr('The two passwords do not match'); return; }
    try { await api.post(`${A}/password/reset`, { token, password: f.password }); setDone(true); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <div style={{ width: 380, maxWidth: '92vw', textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center' }}>Choose a new password</h2>
        {err && <div className="alert err">{err}</div>}
        {done ? <><p>Your password is changed and other sessions were signed out. Sign in with {info?.email || 'your email'}.</p><button className="btn primary" style={{ width: '100%' }} onClick={() => nav('/platform')}>Go to sign in</button></>
          : info ? (
            <form onSubmit={go}>
              <p>New password for <b>{info.email}</b>.</p>
              <Field label="New password" required hint="10+ characters using at least three of: lower case, capitals, digits, symbols."><PasswordInput autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoFocus /></Field>
              <Field label="Repeat password" required><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} /></Field>
              <button className="btn primary" style={{ width: '100%' }}>Change password</button>
            </form>
          ) : <button className="btn" style={{ width: '100%' }} onClick={() => nav('/platform')}>Back to sign in</button>}
      </div>
    </div>
  );
}
const SLOT_LABEL = (s) => s.replace('_', ' · ').replace(/^./, (c) => c.toUpperCase());

/** First run: create the Platform Owner with the one-time token from the server (no default account exists). */
function FirstRun({ onDone }) {
  const [f, setF] = useState({ token: '', name: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const go = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) { setErr('The two passwords do not match'); return; }
    setBusy(true);
    try { await api.post(`${A}/setup`, { token: f.token, name: f.name, email: f.email, password: f.password }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <form onSubmit={go} style={{ width: 380, maxWidth: '92vw', textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center' }}>Set up Agentify ERP</h2>
        <p className="muted">Create the Platform Owner account. The one-time setup token is in <code>platform-setup-token.txt</code> in the server's data folder, or run <code>npm run platform:setup-token</code> on the server.</p>
        {err && <div className="alert err">{err}</div>}
        <Field label="Setup token" required><TextInput autoComplete="off" value={f.token} onChange={set('token')} autoFocus /></Field>
        <Field label="Your name"><TextInput value={f.name} onChange={set('name')} /></Field>
        <Field label="Email" required><TextInput type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Password" required hint="10+ characters using at least three of: lower case, capitals, digits, symbols."><TextInput type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Repeat password" required><TextInput type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating…' : 'Create owner account'}</button>
        <p className="muted" style={{ fontSize: 12 }}>After signing in, turn on two-factor sign-in under Security.</p>
      </form>
    </div>
  );
}

/** A console invitation: the invitee picks their own password. */
function AcceptInvite({ token }) {
  const [info, setInfo] = useState(undefined);
  const [f, setF] = useState({ name: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const nav = useNavigate();
  useEffect(() => { api.get(`${A}/invite/${token}`).then((d) => { setInfo(d); setF((x) => ({ ...x, name: d.name || '' })); }).catch((e) => { setInfo(null); setErr(e.message); }); }, [token]);
  if (info === undefined) return <Loading />;
  const go = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) { setErr('The two passwords do not match'); return; }
    try { await api.post(`${A}/invite/accept`, { token, name: f.name, password: f.password }); setDone(true); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <div style={{ width: 380, maxWidth: '92vw', textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center' }}>Join the platform console</h2>
        {err && <div className="alert err">{err}</div>}
        {done ? <><p>Your account is ready. Sign in with {info.email}.</p><button className="btn primary" onClick={() => nav('/platform')}>Go to sign in</button></> : info && (
          <form onSubmit={go}>
            <p>You were invited as <b>{info.role}</b> with <b>{info.email}</b>.</p>
            <Field label="Your name"><TextInput value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
            <Field label="Choose a password" required hint="10+ characters using at least three of: lower case, capitals, digits, symbols."><PasswordInput autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
            <Field label="Repeat password" required><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} /></Field>
            <button className="btn primary" style={{ width: '100%' }}>Activate account</button>
          </form>
        )}
      </div>
    </div>
  );
}

function SignIn({ onDone }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const [forgot, setForgot] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const out = mfa ? await api.post(`${A}/login/mfa`, { mfa_token: mfa, code }) : await api.post(`${A}/login`, f);
      if (out.mfa_required) setMfa(out.mfa_token); else onDone();
    } catch (x) { setErr(x.message); if (mfa && /expired/i.test(x.message)) setMfa(null); } finally { setBusy(false); }
  };
  return (
    <div className="empty" style={{ paddingTop: 80 }}>
      {forgot ? <div style={{ width: 340, textAlign: 'left' }}><h2 style={{ textAlign: 'center' }}>Reset password</h2><ForgotPassword onBack={() => setForgot(false)} /></div> :
      <form onSubmit={go} style={{ width: 340, textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center' }}>Platform console</h2>
        {err && <div className="alert err">{err}</div>}
        {mfa ? <Field label="Authenticator code" hint="Or one of your recovery codes."><TextInput autoComplete="one-time-code" value={code} onChange={setCode} autoFocus /></Field> : <>
          <Field label="Email"><TextInput type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoFocus /></Field>
          <Field label="Password"><PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field></>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : mfa ? 'Verify' : 'Sign in'}</button>
        {!mfa && <p style={{ textAlign: 'center', marginTop: 12 }}><button type="button" style={LINK} onClick={() => { setErr(''); setForgot(true); }}>Reset password</button></p>}
      </form>}
    </div>
  );
}

function Payments() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState(null);
  const load = useCallback(() => api.get('/api/platform/payments').then(setRows).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  const decide = async () => {
    try { await api.post(`/api/platform/payments/${ask.s.id}/${ask.act}`, { note }); setAsk(null); setNote(''); load(); toast(ask.act === 'approve' ? 'Payment approved' : 'Payment rejected'); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card flush>
      {!rows.length ? <Empty title="No payments submitted" hint="Customers who pay by Raast, Easypaisa, JazzCash, SadaPay, NayaPay or bank transfer appear here." /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Workspace</th><th>Plan</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="nowrap">{String(s.created_at).slice(0, 10)}</td><td><b>{s.tenant_name}</b><div className="muted">{s.slug}</div></td>
              <td style={{ textTransform: 'capitalize' }}>{s.plan} / {s.interval}</td><td>{s.method}</td><td className="mono nowrap">{s.currency} {Number(s.amount).toLocaleString()}</td>
              <td className="mono">{s.reference}{s.note && <div className="muted">{s.note}</div>}{s.proof_name && <div><a href={`/api/platform/admin/payments/${s.id}/proof`} target="_blank" rel="noreferrer">Receipt file: {s.proof_name}</a></div>}</td><td><StatusBadge status={s.status} /></td>
              <td className="right nowrap">{s.status === 'pending' && <><button className="btn sm primary" onClick={() => setAsk({ s, act: 'approve' })}>Approve</button>{' '}<button className="btn sm" onClick={() => setAsk({ s, act: 'reject' })}>Reject</button></>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {ask && (
        <Modal title={`${ask.act === 'approve' ? 'Approve' : 'Reject'} payment ${ask.s.reference}`} onClose={() => setAsk(null)} footer={<><button className="btn" onClick={() => setAsk(null)}>Cancel</button><button className={`btn ${ask.act === 'approve' ? 'primary' : 'danger'}`} onClick={decide}>{ask.act === 'approve' ? 'Approve' : 'Reject'}</button></>}>
          <p>{ask.act === 'approve' ? 'Confirm the money has arrived in your account. The plan starts for one period and the customer is emailed.' : 'The customer is told this payment was not accepted.'}</p>
          <Field label="Note to customer (optional)"><TextInput value={note} onChange={setNote} /></Field>
        </Modal>
      )}
    </Card>
  );
}

const keyField = (m, k) => `${m}.${k}`;

function StripeSettings() {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [form, setForm] = useState({});
  const [result, setResult] = useState({});
  const load = useCallback(() => api.get(`${A}/settings/stripe`).then((d) => { setV(d); setForm({}); }).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Loading />;
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }));
  const save = async () => {
    const body = { mode: form.mode ?? v.mode, test: {}, live: {}, prices: { test: {}, live: {} } };
    for (const [k, val] of Object.entries(form)) {
      const [m, kind, slot] = k.split('.');
      if (kind === 'price') body.prices[m][slot] = val === '' ? null : val;
      else if (m === 'test' || m === 'live') body[m][kind] = val;
    }
    try { setV(await api.put(`${A}/settings/stripe`, body)); setForm({}); toast('Stripe settings saved'); } catch (e) { toast(e.message, 'err'); }
  };
  const test = async (m) => {
    setResult((r) => ({ ...r, [m]: { busy: true } }));
    let out;
    try { out = await api.post(`${A}/settings/stripe/test`, { mode: m }); } catch (e) { out = { ok: false, error: e.message }; }
    setResult((r) => ({ ...r, [m]: out }));
  };
  const mode = form.mode ?? v.mode;
  const dirty = Object.keys(form).length > 0;
  const keyIn = (m, k, label, ph) => (
    <Field label={label} hint={k === 'publishable_key' ? (v.modes[m][k] ? 'Saved (type to replace)' : 'Not set') : (v.modes[m][k].set ? `Saved, ends ${v.modes[m][k].hint} (leave blank to keep)` : 'Not set')}>
      <TextInput type={k === 'publishable_key' ? 'text' : 'password'} autoComplete="off" value={form[keyField(m, k)] ?? ''} placeholder={k === 'publishable_key' ? (v.modes[m][k] || ph) : ph} onChange={(val) => set(keyField(m, k), val)} />
    </Field>
  );
  return (
    <>
      <Card title="Active mode">
        <p className="muted">Test mode uses Stripe test cards and no real money. Switch to Live only after the live keys, prices and webhook are saved.</p>
        <Tabs tabs={[{ key: 'test', label: 'Test mode' }, { key: 'live', label: 'Live mode' }]} value={mode} onChange={(m) => set('mode', m)} />
        <p>Customers are charged in <b>{v.mode}</b> mode right now{form.mode && form.mode !== v.mode ? ` (will switch to ${form.mode} on save)` : ''}. {v.ready ? '' : 'Stripe is not ready: a secret key and at least one price are needed.'}</p>
      </Card>
      {['test', 'live'].map((m) => (
        <Card key={m} title={`${m === 'test' ? 'Test' : 'Live'} keys`}>
          {keyIn(m, 'secret_key', 'Secret key', `sk_${m}_…`)}
          {keyIn(m, 'publishable_key', 'Publishable key', `pk_${m}_…`)}
          {keyIn(m, 'webhook_secret', 'Webhook signing secret', 'whsec_…')}
          <h4>Price IDs</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            {Object.keys(v.modes[m].prices).map((slot) => (
              <Field key={slot} label={SLOT_LABEL(slot)}><TextInput value={form[`${m}.price.${slot}`] ?? v.modes[m].prices[slot] ?? ''} placeholder="price_…" onChange={(val) => set(`${m}.price.${slot}`, val)} /></Field>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => test(m)} disabled={result[m]?.busy || dirty} title={dirty ? 'Save first' : ''}>Test connection</button>
          {result[m] && !result[m].busy && <span style={{ marginLeft: 12 }} className={result[m].ok ? 'ok' : 'err'}>{result[m].ok ? `Connected${result[m].account ? ` to ${result[m].account}` : ''}` : result[m].error}</span>}
        </Card>
      ))}
      <Card title="Webhook">
        <p>In Stripe → Developers → Webhooks, add this endpoint and select these events, then paste its signing secret above.</p>
        <p><code>{v.webhook_url}</code></p>
        <p className="muted">{v.events.join(', ')}</p>
      </Card>
      <div style={{ padding: '16px 0' }}><button className="btn primary" disabled={!dirty} onClick={save}>Save Stripe settings</button></div>
    </>
  );
}

const GW_STATUS = { live: ['green', 'LIVE'], test: ['blue', 'Test mode'], off: ['grey', 'Keys saved, switched off'], untested: ['amber', 'Keys saved, not tested'], no_keys: ['grey', 'Not live: no keys yet'], not_built: ['grey', 'Not built yet'] };
function GatewayCard({ g, onChange }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ mode: g.mode, ...Object.fromEntries(g.fields.map((x) => [x.key, x.secret ? '' : x.value])) }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const call = async (fn) => { setBusy(true); try { onChange(await fn()); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const [tone, label] = GW_STATUS[g.status] || GW_STATUS.no_keys;
  return (
    <Card title={g.label} actions={<StatusBadge status={g.status} tone={tone} label={label} />}>
      <p className="muted" style={{ marginTop: 0 }}>{g.blurb}{g.currencies ? ` Charges in: ${g.currencies.join(', ')}.` : ''}</p>
      {!g.available ? <div className="alert info">{g.note}</div> : (
        <>
          {g.docs && <p><a className="btn sm" href={g.docs} target="_blank" rel="noreferrer">Open {g.label} dashboard ↗</a></p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            <Field label="Mode" hint="Test mode never activates a plan. Live needs live keys."><select className="input" value={f.mode} onChange={set('mode')}><option value="test">Test (sandbox)</option><option value="live">Live (real money)</option></select></Field>
            {g.fields.map((x) => <Field key={x.key} label={x.label} hint={x.secret && x.value ? `Saved, ends ${x.value.replace('…', '')} (leave blank to keep)` : x.hint}><TextInput type={x.secret ? 'password' : 'text'} autoComplete="off" value={f[x.key] ?? ''} onChange={(v) => setF({ ...f, [x.key]: v })} /></Field>)}
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>Webhook address to add at {g.label}: <code>{g.webhook_url}</code></p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => { if (f.mode === 'live' && !window.confirm(`Use ${g.label} in LIVE mode? Real customer payments will activate plans.`)) return; call(() => api.put(`${A}/settings/gateways/${g.id}`, f)); }}>{busy ? 'Checking with provider…' : 'Save and test'}</button>
            {g.status !== 'no_keys' && <button className="btn" disabled={busy || g.status === 'untested'} onClick={() => call(() => api.post(`${A}/settings/gateways/${g.id}/enabled`, { enabled: !g.enabled }))}>{g.enabled ? 'Switch off' : 'Switch on for customers'}</button>}
            {g.status !== 'no_keys' && <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm(`Remove the ${g.label} keys?`)) call(() => api.del(`${A}/settings/gateways/${g.id}`)); }}>Remove keys</button>}
          </div>
        </>)}
    </Card>
  );
}
function PlatformGateways() {
  const toast = useToast();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`${A}/settings/gateways`).then(setD).catch((e) => toast(e.message, 'err')); }, [toast]);
  if (!d) return <Loading />;
  return (
    <>
      <div className="alert info">Nothing here is live until you add keys and switch a gateway on. Card subscriptions through Stripe are configured on the Stripe tab. Gateways here take one payment per period (monthly or yearly); a confirmed payment activates the plan exactly like an approved bank transfer. Customers whose plan currency a gateway cannot charge simply do not see it.</div>
      {d.gateways.map((g) => <GatewayCard key={`${g.id}-${g.status}-${g.mode}`} g={g} onChange={setD} />)}
      <Card title="Recent online plan payments" flush>
        {!d.payments.length ? <Empty title="None yet" hint="Online plan payments appear here." /> : (
          <table className="t"><thead><tr><th>When</th><th>Workspace</th><th>Gateway</th><th>Amount</th><th>Status</th></tr></thead><tbody>{d.payments.map((k) => <tr key={k.id}><td>{k.created_at}</td><td>{k.tenant} <span className="muted">({k.slug})</span></td><td>{k.provider_label}{k.sandbox ? ' (test)' : ''}</td><td>{k.currency} {k.amount}</td><td>{k.status}{k.error ? <div className="muted">{k.error}</div> : null}</td></tr>)}</tbody></table>)}
      </Card>
    </>
  );
}

function LocalAccounts() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const load = useCallback(() => api.get(`${A}/payment-accounts`).then(setD).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const save = async () => {
    const { id, label, ...body } = edit;
    try { if (id) await api.put(`${A}/payment-accounts/${id}`, body); else await api.post(`${A}/payment-accounts`, body); setEdit(null); load(); toast('Saved'); } catch (e) { toast(e.message, 'err'); }
  };
  const flip = async (a) => { try { await api.put(`${A}/payment-accounts/${a.id}`, { active: !a.active }); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Where customers send money" actions={<button className="btn primary sm" onClick={() => setEdit({ method: Object.keys(d.methods)[0], account: '', account_name: '', note: '', active: true })}>Add account</button>} flush>
      {!d.accounts.length ? <Empty title="No accounts yet" hint="Customers only see the local payment methods you add here." /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Method</th><th>Account / ID</th><th>Account title</th><th>Note</th><th>Shown</th><th /></tr></thead><tbody>
          {d.accounts.map((a) => (
            <tr key={a.id}>
              <td><b>{a.label}</b></td><td className="mono">{a.account}</td><td>{a.account_name || '—'}</td><td>{a.note || '—'}</td>
              <td><Toggle value={a.active} onChange={() => flip(a)} /></td>
              <td className="right nowrap"><button className="btn sm" onClick={() => setEdit({ ...a })}>Edit</button>{' '}<button className="btn sm danger" onClick={() => setDel(a)}>Delete</button></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit account' : 'Add account'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <Field label="Method"><select className="input" value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{Object.entries(d.methods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Account number / IBAN / Raast ID" required><TextInput value={edit.account} onChange={(v) => setEdit({ ...edit, account: v })} /></Field>
          <Field label="Account title"><TextInput value={edit.account_name} onChange={(v) => setEdit({ ...edit, account_name: v })} /></Field>
          <Field label="Note shown to customer"><TextInput value={edit.note} onChange={(v) => setEdit({ ...edit, note: v })} placeholder="e.g. Send from your own account and keep the receipt" /></Field>
          <Toggle value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Show to customers" />
        </Modal>
      )}
      {del && <ConfirmDialog title="Delete account?" message={`${del.label} ${del.account} will no longer be offered to customers. Past payments are unaffected.`} confirmLabel="Delete" danger onCancel={() => setDel(null)} onConfirm={async () => { try { await api.del(`${A}/payment-accounts/${del.id}`); setDel(null); load(); } catch (e) { toast(e.message, 'err'); } }} />}
    </Card>
  );
}

const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Backups() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`${A}/backups`).then(setD).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const run = async () => { setBusy(true); try { const r = await api.post(`${A}/backups/run`); toast(`Backed up ${r.tenants} workspace(s)`); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <>
      <Card title="Automatic backups" actions={<button className="btn primary sm" onClick={run} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</button>}>
        <p>{d.enabled ? `A snapshot of the platform and every workspace database is taken every ${d.every_hours} hours and the newest ${d.keep} are kept.` : 'Automatic backups are turned off (BACKUP_ENABLED=0).'} Uploaded files {d.uploads ? 'are included.' : 'are not included (set BACKUP_UPLOADS=1).'}</p>
        <p className="muted">Folder on the server: <code>{d.dir}</code>. Copy it off the server regularly. The encryption key (<code>ERP_SECRETS_KEY</code> or <code>data/.secrets-key</code>) is deliberately not inside the backups: store it separately, or the saved Stripe keys cannot be read after a restore.</p>
      </Card>
      <Card flush>
        {!d.backups.length ? <Empty title="No backups yet" hint="The first one runs about a minute after the server starts, or press Back up now." /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Backup</th><th>Taken</th><th>Workspaces</th><th>Size</th><th>Problems</th></tr></thead><tbody>
            {d.backups.map((b) => <tr key={b.name}><td className="mono">{b.name}</td><td>{b.created_at ? String(b.created_at).replace('T', ' ').slice(0, 16) : 'unfinished'}</td><td>{b.tenants ?? '—'}</td><td>{fmtBytes(b.bytes)}</td><td>{b.errors.length ? b.errors.join('; ') : 'None'}</td></tr>)}
          </tbody></table></div>
        )}
      </Card>
    </>
  );
}

/** Pages of the console, each under /platform/... so they can be linked to and bookmarked. */
function ConsoleRoutes() {
  const nav = useNavigate();
  const loc = useLocation();
  const open = (id) => nav(`/platform/workspaces/${id}${loc.search}`);
  const wsMatch = loc.pathname.match(/^\/platform\/workspaces\/(\d+)/);
  const filterLabel = FILTERS.find(([k]) => k === new URLSearchParams(loc.search).get('status'))?.[1] || 'All workspaces';
  const can = useCan();
  const page = (title, sub, el) => <><PageTitle title={title} sub={sub} />{el}</>;
  return (
    <>
      <Routes>
        <Route index element={can('dashboard.view') || !can('content.calendar') ? <Allowed perm="dashboard.view"><Dashboard /></Allowed> : <Navigate to="/platform/content" replace />} />
        <Route path="profit" element={<Allowed perm="finance.view"><CostProfitPage /></Allowed>} />
        <Route path="storage" element={<Allowed perm="billing.view"><StoragePage /></Allowed>} />
        <Route path="ai-usage" element={<Allowed perm="finance.view"><AiUsagePage /></Allowed>} />
        <Route path="content" element={<Allowed perm="content.calendar"><ContentCalendarPage /></Allowed>} />
        <Route path="whats-new" element={<WhatsNew platform />} />
        <Route path="health" element={<Allowed perm="system.view"><HealthPage /></Allowed>} />
        <Route path="notifications" element={<Allowed perm="dashboard.view"><NotificationsPage /></Allowed>} />
        <Route path="setup" element={<Allowed perm="system.view"><SetupPage /></Allowed>} />
        <Route path="workspaces/*" element={<Allowed perm="workspaces.view">{page(filterLabel, 'Every company on the platform, with setup progress, usage and access dates. Click a row to manage it.', <Workspaces onOpen={open} />)}</Allowed>} />
        <Route path="expiry" element={<Allowed perm="workspaces.view">{page('Renewals & expiry', 'Trials and paid periods by how soon they end.', <Expiry onOpen={open} />)}</Allowed>} />
        <Route path="plans" element={<Allowed perm="billing.view"><PlansPage /></Allowed>} />
        <Route path="analytics" element={<Allowed perm="analytics.view"><AnalyticsPage /></Allowed>} />
        <Route path="website/visual" element={<Allowed perm="content.manage"><LandingEditorPage /></Allowed>} />
        <Route path="website" element={<Allowed perm="content.manage"><WebsitePage /></Allowed>} />
        <Route path="free-sites" element={<Allowed perm="system.view"><FreeSitesPage /></Allowed>} />
        <Route path="reviews" element={<Allowed perm="content.manage"><ReviewsPage /></Allowed>} />
        <Route path="demo-requests" element={<Allowed perm="workspaces.view"><DemoRequestsPage /></Allowed>} />
        <Route path="announcements" element={<Allowed perm="dashboard.view"><AnnouncementsPage /></Allowed>} />
        <Route path="mailbox" element={<Allowed perm="mailbox.manage"><MailboxPage /></Allowed>} />
        <Route path="mailbox/sent" element={<Allowed perm="mailbox.manage"><SentLogPage /></Allowed>} />
        <Route path="email" element={<Allowed perm="system.view"><EmailOps /></Allowed>} />
        <Route path="mailbox/settings" element={<Allowed perm="mailbox.manage"><MailboxSettingsPage /></Allowed>} />
        <Route path="regions" element={<Allowed perm="regions.support"><RegionsPage /></Allowed>} />
        <Route path="integrations" element={<Allowed perm="system.view"><IntegrationsPage /></Allowed>} />
        <Route path="finance" element={<Allowed perm="finance.view"><FinancePage /></Allowed>} />
        <Route path="transactions" element={<Allowed perm="billing.view"><TransactionsPage /></Allowed>} />
        <Route path="subscriptions/history" element={<Allowed perm="billing.view"><SubscriptionHistoryPage /></Allowed>} />
        <Route path="billing/mail" element={<Allowed perm="billing.view">{page('Billing mail', 'Receipts and the billing@ inbox.', <BillingMailPage />)}</Allowed>} />
        <Route path="payments" element={<Allowed perm="billing.view">{page('Payment approvals', 'Bank and wallet payments waiting for you to confirm the money arrived.', <Payments />)}</Allowed>} />
        <Route path="billing/stripe" element={<Allowed perm="billing.configure">{page('Stripe configuration', 'Card payment keys, prices and webhook.', <StripeSettings />)}</Allowed>} />
        <Route path="billing/gateways" element={<Allowed perm="billing.configure">{page('Payment gateways', 'How Agentify is paid for plans: PayPal, Tap and more. Keys are write-only and encrypted.', <PlatformGateways />)}</Allowed>} />
        <Route path="billing/accounts" element={<Allowed perm="billing.view">{page('Local payment accounts', 'Where customers send Raast, Easypaisa, JazzCash, SadaPay, NayaPay and bank payments.', <LocalAccounts />)}</Allowed>} />
        <Route path="admins" element={<Allowed perm="admins.manage"><AdminsPage /></Allowed>} />
        <Route path="security" element={page('Two-factor sign-in', 'Protect your console account with an authenticator app.', <TwoFactor base={`${A}/2fa`} />)} />
        <Route path="security/sessions" element={<SessionsPage />} />
        <Route path="security/email" element={<Allowed perm="system.view"><EmailSafetyPage /></Allowed>} />
        <Route path="security/logins" element={<Allowed perm="audit.view"><LoginsPage /></Allowed>} />
        <Route path="training-videos" element={<Allowed perm="system.view"><TrainingVideosPage /></Allowed>} />
        <Route path="mobile-app" element={<Allowed perm="system.view"><MobileAppPage /></Allowed>} />
        <Route path="maintenance" element={<Allowed perm="system.view"><MaintenancePage /></Allowed>} />
        <Route path="backups" element={<Allowed perm="system.view">{page('Backups', null, <Backups />)}</Allowed>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reconciliation" element={<Allowed perm="billing.view"><ReconciliationPage /></Allowed>} />
        <Route path="audit" element={<Allowed perm="audit.view"><AuditPage /></Allowed>} />
        <Route path="*" element={<Empty title="Page not found" hint="Use the menu on the left." />} />
      </Routes>
      {wsMatch && <WorkspaceDetail id={Number(wsMatch[1])} onClose={() => nav(`/platform/workspaces${loc.search}`)} />}
    </>
  );
}

export default function PlatformConsole() {
  const loc = useLocation();
  const invite = loc.pathname.match(/^\/platform\/accept-invite\/([\w-]+)/);
  if (invite) return <AcceptInvite token={invite[1]} />;
  const reset = loc.pathname.match(/^\/platform\/reset-password\/([\w-]+)/);
  if (reset) return <ResetPassword token={reset[1]} />;
  return <ConsoleApp />;
}

function ConsoleApp() {
  const [me, setMe] = useState(undefined);
  const [firstRun, setFirstRun] = useState(false);
  const [pw, setPw] = useState(null);
  const toast = useToast();
  const loadMe = useCallback(() => api.get(`${A}/me`).then(setMe).catch(() => { setMe(null); api.get(`${A}/setup/status`).then((d) => setFirstRun(!!d.needed)).catch(() => {}); }), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { const h = () => loadMe(); window.addEventListener('pa:me', h); return () => window.removeEventListener('pa:me', h); }, [loadMe]);
  if (me === undefined) return <Loading />;
  if (!me && firstRun) return <FirstRun onDone={() => { setFirstRun(false); loadMe(); }} />;
  if (!me) return <SignIn onDone={loadMe} />;
  const out = async () => { try { await api.post(`${A}/logout`); } catch { /* ignore */ } setMe(null); };
  const changePw = async () => { try { await api.post(`${A}/change-password`, pw); setPw(null); toast('Password changed'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <AdminShell me={me} onSignOut={out} onChangePassword={() => setPw({ current: '', next: '' })}>
      <ConsoleRoutes />
      {pw && (
        <Modal title="Change password" onClose={() => setPw(null)} footer={<><button className="btn" onClick={() => setPw(null)}>Cancel</button><button className="btn primary" onClick={changePw}>Change</button></>}>
          <Field label="Current password"><TextInput type="password" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} /></Field>
          <Field label="New password (10+ characters)"><TextInput type="password" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} /></Field>
        </Modal>
      )}
    </AdminShell>
  );
}
