import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Field, Loading } from '../components/ui.jsx';
import { useAuth } from '../context.jsx';
import { api } from '../api.js';
import EmailCodeStep from '../components/EmailCodeStep.jsx';

/** Shared frame for the account pages (signup, forgot/reset password, accept invitation). */
function Shell({ eyebrow, title, lead, children, side }) {
  return (
    <div className="auth2">
      <div className="auth2-copy">
        <div className="brand"><div className="brand-mark"><Icon name="home" size={18} stroke={2.2} /></div><div className="brand-name">Agentify ERP<small>Real estate, end to end</small></div></div>
        <div className="eyebrow"><i />{eyebrow}</div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
        {side}
      </div>
      <div className="auth2-card stack">{children}</div>
    </div>
  );
}

const TIMEZONES = [['Asia/Karachi', 'Pakistan (PKT)'], ['Asia/Dubai', 'UAE (GST)'], ['Asia/Riyadh', 'Saudi Arabia (AST)'], ['Asia/Kolkata', 'India (IST)'], ['Asia/Dhaka', 'Bangladesh (BST)'], ['Europe/London', 'United Kingdom'], ['America/New_York', 'US Eastern'], ['UTC', 'UTC']];
const CURRENCIES = ['PKR', 'AED', 'SAR', 'INR', 'BDT', 'GBP', 'USD', 'EUR'];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

/** Self-serve signup: creates a new company workspace with its own database. */
export function Signup() {
  const [f, setF] = useState({ company_name: '', slug: '', admin_name: '', admin_email: '', admin_password: '', timezone: 'Asia/Karachi', currency: 'PKR', accept_terms: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const timer = useRef();
  const [regions, setRegions] = useState([]);
  const [codeOn, setCodeOn] = useState(false);
  const [proof, setProof] = useState('');
  const [mode, setMode] = useState(null); // null while checking, false when the server runs in single-company mode
  useEffect(() => { api.get('/api/platform/site').then((s) => { setMode(s.landing || s.multi_tenant); setRegions(s.regions || []); setCodeOn(!!s.signup_email_code); }).catch(() => setMode(undefined)); }, []);
  useEffect(() => {
    if (!f.slug) { setAvail(null); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { try { setAvail(await api.get(`/api/platform/slug-available/${encodeURIComponent(f.slug)}`)); } catch { setAvail(null); } }, 350);
    return () => clearTimeout(timer.current);
  }, [f.slug]);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.accept_terms) { setErr('Please accept the Terms of Service and Privacy Policy to create a workspace'); return; }
    if (codeOn && !proof) { setErr('Confirm your email address with the code we email you first'); return; }
    setBusy(true);
    try { setDone(await api.post('/api/platform/signup', { ...f, email_proof: proof || undefined })); } catch (er) { setErr(/^Endpoint not found$/i.test(er.message) ? 'This server is an older version without workspace signup. Stop it and start the new project with run-agentify-erp.bat, then open http://localhost:4000/signup.' : er.message); } finally { setBusy(false); }
  };
  // straight into the new workspace, already signed in (the one-time code lasts two minutes, so do it now)
  const [checking, setChecking] = useState(false);
  const enter = async () => {
    if (!done?.login_url) return;
    setChecking(true); setUnreachable(false);
    const ok = await fetch(`${done.login_url}/health`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
    setChecking(false);
    if (ok) window.location.replace(done.enter_url || `${done.login_url}/login`);
    else setUnreachable(true);
  };
  useEffect(() => {
    if (!done?.enter_url) return;
    enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  if (done) {
    return (
      <Shell eyebrow="You’re in" title={<>Your workspace is <em>ready.</em></>} lead="Your company has its own private database. Sign in with the email and password you just chose.">
        <h2>{done.tenant.name}</h2>
        <div className="muted">Free trial until {String(done.tenant.trial_ends_at || '').slice(0, 10)}. We emailed you a link to confirm your address.</div>
        {unreachable && <div className="alert warn" role="alert">Your workspace was created at <b>{String(done.login_url || '').replace(/^https?:\/\//, '')}</b>, but that address cannot be opened from this browser yet. Check that a wildcard address (like <b>*.localhost</b>) points at this computer, or open it by its IP. Your data is safe.</div>}
        {done.login_url
          ? <button type="button" className="btn primary" onClick={enter} disabled={checking}>{checking ? 'Checking the address…' : unreachable ? 'Check again' : 'Open your workspace'}</button>
          : <Link className="btn primary" to="/login">Go to sign in</Link>}
      </Shell>
    );
  }
  return (
    <Shell eyebrow="Start free" title={<>Run your whole real estate business <em>in one place.</em></>}
      lead="CRM, sales, installments, accounting, HR, vendors and your own website. Set up your company in a minute."
      side={<div className="auth2-feats">{[['users', 'blue', 'Leads & CRM'], ['badge', 'violet', 'Sales & bookings'], ['wallet', 'green', 'Accounts & vouchers'], ['briefcase', 'orange', 'HR & attendance']].map(([ic, tone, l]) => <div key={l} className="auth2-feat"><span className={`ic-tile sm ic-${tone}`}><Icon name={ic} size={15} /></span>{l}</div>)}</div>}>
      <form className="stack" onSubmit={submit}>
        <div><h2>Create your workspace</h2><div className="muted" style={{ marginTop: 4 }}>14-day free trial. No card needed.</div></div>
        {mode === false && <div className="alert warn" role="alert">Workspace signup is off because this server runs in single-company mode. Close it and start the project with <b>run-agentify-erp.bat</b>, then open <b>http://localhost:4000/signup</b>.</div>}
        {mode === undefined && <div className="alert warn" role="alert">This server does not offer workspace signup (an older version is running, or this page is not talking to the new server). Stop it, start the project with <b>run-agentify-erp.bat</b>, and open <b>http://localhost:4000/signup</b>.</div>}
        {err && <div className="alert err" role="alert">{err}</div>}
        <Field label="Company name" required><input className="input" autoFocus value={f.company_name} required onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, company_name: v, slug: slugTouched ? s.slug : slugify(v) })); }} /></Field>
        <Field label="Workspace address" required hint={avail ? (avail.available ? 'Available' : avail.reason) : 'Letters, digits and hyphens'} error={avail && !avail.available ? avail.reason : undefined}>
          <input className="input" value={f.slug} required onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: slugify(e.target.value) })); }} placeholder="your-company" />
        </Field>
        <Field label="Your name" required><input className="input" value={f.admin_name} required onChange={set('admin_name')} autoComplete="name" /></Field>
        <Field label="Work email" required><input className="input" type="email" value={f.admin_email} required onChange={set('admin_email')} autoComplete="email" /></Field>
        {codeOn && <EmailCodeStep email={f.admin_email} onProof={setProof} />}
        <Field label="Password" required hint="At least 8 characters"><input className="input" type="password" minLength={8} value={f.admin_password} required onChange={set('admin_password')} autoComplete="new-password" /></Field>
        {regions.length > 1 ? (() => {
          const reg = regions.find((x) => x.code === (f.region || 'PK')) || regions[0];
          return (
            <>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Country / region"><select className="input" value={reg.code} onChange={(e) => setF((x) => ({ ...x, region: e.target.value, sub_region: '', language: '' }))}>{regions.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
                {reg.sub_regions?.length > 0 && <Field label={reg.sub_region_label || 'State'}><select className="input" value={f.sub_region || ''} onChange={set('sub_region')}><option value="">Choose…</option>{reg.sub_regions.map((x) => <option key={x}>{x}</option>)}</select></Field>}
              </div>
              <div className="muted" style={{ marginTop: -4 }}>Currency {reg.currency}{reg.languages?.length > 1 ? '' : ''}. Dates, units and terms follow the region.</div>
              {reg.languages?.length > 1 && <Field label="Language"><select className="input" value={f.language || reg.languages[0]} onChange={set('language')}>{reg.languages.map((x) => <option key={x} value={x}>{{ en: 'English', fr: 'Français', ar: 'العربية' }[x] || x}</option>)}</select></Field>}
            </>
          );
        })() : (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Country / timezone"><select className="input" value={f.timezone} onChange={set('timezone')}>{TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Currency"><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
          <input type="checkbox" checked={!!f.accept_terms} onChange={set('accept_terms')} style={{ width: 'auto', marginTop: 4 }} />
          <span>I agree to the <Link to="/legal/terms" target="_blank">Terms of Service</Link>, <Link to="/legal/subscription" target="_blank">Subscription Terms</Link> and <Link to="/legal/privacy" target="_blank">Privacy Policy</Link>.</span>
        </label>
        <button className="btn primary" disabled={busy || (avail && !avail.available)}>{busy ? 'Creating…' : 'Create workspace'}</button>
        <div className="center muted">Already have one? <Link to="/login">Sign in</Link></div>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api.post('/api/auth/forgot-password', { email }); setSent(true); } catch (er) { setErr(er.message); } finally { setBusy(false); } };
  return (
    <Shell eyebrow="Account help" title={<>Forgot your password? <em>It happens.</em></>} lead="Enter your work email and we’ll send you a one-time link to choose a new password.">
      {sent ? (
        <><h2>Check your email</h2><div className="muted">If an account exists for <b>{email}</b>, a reset link is on its way. It works once and expires in 2 hours.</div><Link className="btn" to="/login">Back to sign in</Link></>
      ) : (
        <form className="stack" onSubmit={submit}>
          <div><h2>Reset password</h2></div>
          {err && <div className="alert err" role="alert">{err}</div>}
          <Field label="Email" required><input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <div className="center muted"><Link to="/login">Back to sign in</Link></div>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const { token } = useParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (pw !== pw2) return setErr('The two passwords do not match');
    setBusy(true);
    try { await api.post('/api/auth/reset-password', { token, password: pw }); setOk(true); setTimeout(() => nav('/login', { replace: true }), 1800); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Shell eyebrow="Account help" title={<>Choose a <em>new password.</em></>} lead="You’ll be signed out of every other device once it’s changed.">
      {ok ? <><h2>Password changed</h2><div className="muted">Taking you to sign in…</div></> : (
        <form className="stack" onSubmit={submit}>
          <div><h2>New password</h2></div>
          {err && <div className="alert err" role="alert">{err} {err.includes('expired') && <Link to="/forgot-password">Request a new link</Link>}</div>}
          <Field label="New password" required hint="At least 8 characters"><input className="input" type="password" minLength={8} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" /></Field>
          <Field label="Repeat password" required><input className="input" type="password" minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      )}
    </Shell>
  );
}

/** Landing page for the link in the confirmation email. */
export function VerifyEmail() {
  const { token } = useParams();
  const [state, setState] = useState('working');
  const [msg, setMsg] = useState('');
  useEffect(() => { api.post('/api/auth/verify-email', { token }).then(() => setState('ok')).catch((e) => { setMsg(e.message); setState('err'); }); }, [token]);
  return (
    <Shell eyebrow="Email" title={state === 'ok' ? <>Email <em>confirmed.</em></> : state === 'err' ? <>That link <em>did not work.</em></> : <>Confirming…</>}
      lead={state === 'ok' ? 'Thank you. You can sign in and invite your team.' : state === 'err' ? msg : 'One moment.'}>
      {state !== 'working' && <Link className="btn primary" to="/login">Go to sign in</Link>}
    </Shell>
  );
}

/** Staff invitation: shows the company and role, then signs the new user in once they pick a password. */
export function AcceptInvite() {
  const { token } = useParams();
  const { adopt } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [bad, setBad] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/api/auth/invite/${encodeURIComponent(token)}`).then((i) => { setInfo(i); setName(i.name || ''); }).catch((e) => setBad(e.message)); }, [token]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const u = await api.post('/api/auth/invite/accept', { token, name, password: pw }); await adopt(u); nav('/', { replace: true }); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  if (!info && !bad) return <Loading />;
  return (
    <Shell eyebrow="Invitation" title={info ? <>Join <em>{info.company}.</em></> : <>This invitation <em>isn’t valid.</em></>} lead={info ? `You’ve been invited as ${info.role}. Choose a password to get started.` : undefined}>
      {bad ? <><h2>Invitation unavailable</h2><div className="alert err">{bad}</div><Link className="btn" to="/login">Go to sign in</Link></> : (
        <form className="stack" onSubmit={submit}>
          <div><h2>Create your account</h2><div className="muted" style={{ marginTop: 4 }}>{info.email}</div></div>
          {err && <div className="alert err" role="alert">{err}</div>}
          <Field label="Your name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></Field>
          <Field label="Password" required hint="At least 8 characters"><input className="input" type="password" minLength={8} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Accept invitation'}</button>
        </form>
      )}
    </Shell>
  );
}
