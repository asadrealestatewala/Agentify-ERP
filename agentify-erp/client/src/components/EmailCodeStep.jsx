import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Signup step: email a 6-digit code to the address typed above and check it. `onProof` receives the single-use proof
 * once the code is right (and '' again if the address is edited). `variant` picks the class names of the page it sits on.
 */
export default function EmailCodeStep({ email, onProof, variant = 'app' }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const land = variant === 'landing';
  useEffect(() => { setSent(false); setOk(false); setCode(''); setErr(''); onProof(''); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  const send = async () => {
    setBusy(true); setErr('');
    try { const out = await api.post('/api/platform/signup/email-code', { email }); if (out.required === false) { setOk(true); onProof(''); return; } setSent(true); setCode(''); setWait(out.cooldown || 30); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr('');
    try { const out = await api.post('/api/platform/signup/verify-code', { email, code }); setOk(true); onProof(out.proof); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const btn = land ? 'lbtn' : 'btn';
  if (ok) return <div className={land ? 'lok' : 'alert ok'} role="status" style={land ? { background: '#e6f5ea', color: '#166534', padding: '10px 14px', borderRadius: 10 } : undefined}>Email confirmed: {email}</div>;
  return (
    <div className={land ? undefined : 'stack'} style={land ? { display: 'grid', gap: 8 } : undefined}>
      {err && <div className={land ? 'lerr' : 'alert err'} role="alert">{err}</div>}
      {!sent
        ? <button type="button" className={btn} disabled={!valid || busy} onClick={send}>{busy ? 'Sending…' : 'Email me a confirmation code'}</button>
        : <>
          {land
            ? <label>6-digit code from your email<span className="lhint">Sent to {email}. It expires in 10 minutes.</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></label>
            : <label>6-digit code from your email<div className="muted">Sent to {email}. It expires in 10 minutes.</div><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></label>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={btn} disabled={busy || code.replace(/\s/g, '').length !== 6} onClick={verify}>{busy ? 'Checking…' : 'Confirm code'}</button>
            <button type="button" className={land ? 'llink' : 'btn ghost'} disabled={busy || wait > 0} onClick={send}>{wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
          </div>
        </>}
    </div>
  );
}
