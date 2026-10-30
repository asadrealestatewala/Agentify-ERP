import { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { inNativeApp } from '../installApp.js';
import { useAuth } from '../context.jsx';
import { api } from '../api.js';
import { useBrand } from '../brand.js';
import { t, getLanguage, chooseLanguage } from '../i18n.js';
import { getRegion } from '../format.js';

export default function Login({ portal = false, vendor = false, staff = false }) {
  const { login, loginMfa, loginOtp, resendOtp, adopt } = useAuth();
  const brand = useBrand();
  // on a company's own address the page speaks for that company, never for the Agentify product
  const own = brand.workspace;
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '';
  const native = inNativeApp();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [otp, setOtp] = useState(null); // { token, hint } while the emailed code is awaited
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  // returning from Google or Apple: trade the one-time code for a session
  useEffect(() => {
    const code = sp.get('sso'), bad = sp.get('oauth_error');
    if (bad) setErr({ no_account: 'There is no account for that email in this workspace. Ask an administrator to invite you, then try again.', email_not_verified: 'That account\'s email address is not verified with the provider.', cancelled: 'Sign-in cancelled.' }[bad] || 'That sign-in did not complete. Please try again.');
    if (!code) return;
    api.post('/api/auth/sso/exchange', { code }).then(async (u) => { if (u.mfa_required) { setMfa(u.mfa_token); setCode(''); return; } await adopt(u); nav(next || '/', { replace: true }); }).catch((e) => setErr(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const done = () => nav(portal ? (new RegExp(vendor ? '^/vendor(/|$)' : '^/portal(/|$)').test(next) && !next.includes('//') ? next : '/portal') : '/', { replace: true });
    try {
      const u = await (mfa ? loginMfa(mfa, code) : otp ? loginOtp(otp.token, code) : login(id, pw, portal));
      if (u.mfa_required) { setMfa(u.mfa_token); setCode(''); } else if (u.otp_required) { setOtp({ token: u.otp_token, hint: u.email_hint }); setCode(''); } else done();
    } catch (er) { setErr(er.message); if (mfa && /expired/i.test(er.message)) setMfa(null); if (otp && /sign-in expired/i.test(er.message)) setOtp(null); } finally { setBusy(false); }
  };
  const again = async () => { setErr(''); setNote(''); try { await resendOtp(otp.token); setNote('A new code is on its way.'); } catch (er) { setErr(er.message); } };
  const FEATS = portal
    ? (vendor ? [['wallet', 'green', 'Payments & balance'], ['history', 'blue', 'Account ledger'], ['file', 'violet', 'Open contracts & bids'], ['badge', 'orange', 'Your registration']] : [['building', 'violet', 'Your properties'], ['wallet', 'green', 'Installments & receipts'], ['hardhat', 'orange', 'Site progress'], ['file', 'blue', 'Documents & offers']])
    : [['users', 'blue', 'Leads & CRM'], ['badge', 'violet', 'Sales & bookings'], ['wallet', 'green', 'Accounts & vouchers'], ['briefcase', 'orange', 'HR & attendance']];
  return (
    <div className="auth2">
      <div className="auth2-copy">
        <div className="brand">{own && brand.logo ? <img src={/^(https?:|data:|\/)/.test(brand.logo) ? brand.logo : `/uploads/${brand.logo}`} alt="" style={{ height: 40, maxWidth: 160, objectFit: 'contain' }} /> : <div className="brand-mark"><Icon name="home" size={18} stroke={2.2} /></div>}<div className="brand-name">{brand.name}<small>{vendor ? 'Vendor portal' : portal ? 'Customer portal' : own ? '' : 'ERP'}</small></div></div>
        <div className="eyebrow"><i />{vendor ? 'Vendor portal' : portal ? 'Customer portal' : staff ? 'Team sign in' : own ? 'Welcome' : 'One connected system'}</div>
        <h1>{vendor ? <>Your payments, ledger and new contracts — <em>in one calm place.</em></> : portal ? <>Your property, payments and progress — <em>in one calm place.</em></> : own ? (staff ? <>Welcome back, <em>team.</em></> : <>Welcome to <em>{brand.name}.</em></>) : <>From lead to ledger, <em>in one calm place.</em></>}</h1>
        <p>{vendor ? 'Sign in to see what you have been paid and what is still due, download your ledger, view your registration and bid on contracts the company announces.' : portal ? 'Sign in to see your purchased properties, installment schedule, receipts and the latest site updates.' : own ? (staff ? `Sign in to the ${brand.name} workspace.` : 'Customers and partners can reach their own portal below. Sign in with the email and password you were given.') : 'CRM, inventory, projects, installments, receipts, vendors, HR and accounting — all working together, on your desk and in your pocket.'}</p>
        {!(own && !portal) && <div className="auth2-feats">{FEATS.map(([ic, tone, l]) => <div key={l} className="auth2-feat"><span className={`ic-tile sm ic-${tone}`}><Icon name={ic} size={15} /></span>{l}</div>)}</div>}
      </div>
      <form className="auth2-card stack" onSubmit={submit}>
        {native && !mfa && !otp && <div className="row" role="tablist" aria-label="Sign in as" style={{ gap: 6 }}>
          {[['Employee', '/login', !portal], ['Customer', '/portal/login', portal && !vendor], ['Vendor', '/vendor/login', vendor]].map(([l, to, on]) => <Link key={l} to={to} role="tab" aria-selected={on} className={`btn${on ? ' primary' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>{l}</Link>)}
        </div>}
        <div><h2>{vendor ? t('auth.vendor_sign_in', 'Vendor sign in') : portal ? t('auth.customer_sign_in', 'Customer sign in') : t('auth.sign_in', 'Sign in')}</h2><div className="muted" style={{ marginTop: 4 }}>{vendor ? 'Use the e-mail address you registered with the company.' : portal ? 'Use the email or phone number registered with us.' : 'Welcome back. Enter your work email and password.'}</div></div>
        {(getRegion().config.languages || []).length > 1 && <label className="muted" style={{ fontSize: 13 }}>{t('lang.label', 'Language')}: <select className="input" style={{ width: 'auto', display: 'inline-block' }} value={getLanguage()} onChange={(e) => chooseLanguage(e.target.value)}>{getRegion().config.languages.map((l) => <option key={l} value={l}>{{ en: 'English', fr: 'Français', ar: 'العربية' }[l] || l}</option>)}</select></label>}
        {err && <div className="alert err" role="alert">{err}</div>}
        {note && <div className="alert ok" role="status">{note}</div>}
        {otp ? <><Field label="Code from your email" hint={`We sent a 6-digit code to ${otp.hint}. It expires in 10 minutes.`}><input className="input" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
          <button type="button" className="btn ghost" onClick={again}>Send a new code</button></> : mfa ? <Field label="Authenticator code" hint="Open your authenticator app and enter the 6-digit code, or use a recovery code."><input className="input" autoFocus inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></Field> : <>
        <Field label={portal ? t('auth.email_or_phone', 'Email or phone') : t('auth.email', 'Email')}><input className="input" autoFocus value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required /></Field>
        <Field label={t('auth.password', 'Password')}><PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        </>}
        <button className="btn primary" disabled={busy}>{busy ? t('auth.signing_in', 'Signing in…') : mfa || otp ? t('auth.verify', 'Verify') : t('auth.sign_in', 'Sign in')}</button>
        <div className="center muted"><Link to="/forgot-password">{t('auth.forgot', 'Forgot password?')}</Link>{!portal && !own && <> · <Link to="/signup">{t('auth.create_workspace', 'Create a workspace')}</Link></>}</div>
        <div className="center muted">{portal ? <>{!own && <><Link to="/login">{t('auth.staff_sign_in', 'Staff sign in')}</Link> · </>}{vendor ? <Link to="/portal/login">Customer portal</Link> : <Link to="/vendor/login">Vendor portal</Link>}</> : <><Link to="/portal/login">Customer portal →</Link> · <Link to="/vendor/login">Vendor portal →</Link></>}</div>
        {!portal && !vendor && !mfa && !otp && brand.sso.length > 0 && (
          <div className="stack" style={{ marginTop: 4 }}>
            <div className="center muted" style={{ fontSize: 13 }}>or continue with</div>
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              {brand.sso.includes('google') && <a className="btn" href="/api/auth/sso/google/start"><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style={{ marginRight: 8 }}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Google</a>}
              {brand.sso.includes('apple') && <a className="btn" href="/api/auth/sso/apple/start"><svg width="15" height="16" viewBox="0 0 384 512" aria-hidden="true" style={{ marginRight: 8 }}><path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>Apple</a>}
            </div>
          </div>)}
        {!portal && brand.demo_logins.length > 0 && (
          <div className="demo-box">
            <b>Demo accounts</b> <span className="muted">(password <code>Demo@12345</code>)</span>
            {brand.demo_logins.map(({ role: r, email: e }) => <button type="button" key={e} onClick={() => { setId(e); setPw('Demo@12345'); }}>{r} — {e}</button>)}
          </div>
        )}
        {vendor && brand.demo_logins.length > 0 && <div className="demo-box"><b>Demo vendors</b><button type="button" onClick={() => { setId('abc.bricks@example.com'); setPw('Demo@12345'); }}>ABC Bricks — abc.bricks@example.com</button><button type="button" onClick={() => { setId('wood@example.com'); setPw('Demo@12345'); }}>Expert Wood Suppliers — wood@example.com</button></div>}
        {portal && !vendor && brand.demo_logins.length > 0 && <div className="demo-box"><b>Demo customer</b><button type="button" onClick={() => { setId('m.ali@example.com'); setPw('Demo@12345'); }}>m.ali@example.com / Demo@12345</button></div>}
      </form>
    </div>
  );
}
