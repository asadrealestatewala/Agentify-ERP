import { useState } from 'react';
import { Field } from './ui.jsx';
import PasswordInput from './PasswordInput.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

/** Shows an account recovery code once; the person must tick that they saved it before going on. */
export function RecoveryCode({ code, onContinue, label = 'Continue' }) {
  const [saved, setSaved] = useState(false);
  const toast = useToast();
  return (
    <div className="stack">
      <p>This is your account recovery code. It is shown <b>only once</b>. Save it somewhere safe, such as a password manager: with your email it lets you set a new password if you forget it.</p>
      <p className="mono" style={{ fontSize: 20, letterSpacing: 1, textAlign: 'center', padding: 12, border: '1px dashed currentColor', borderRadius: 8, userSelect: 'all' }}>{code}</p>
      <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(code); toast('Recovery code copied', 'ok'); }}>Copy code</button>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery code</label>
      <button type="button" className="btn primary" disabled={!saved} onClick={onContinue}>{label}</button>
    </div>
  );
}

/** Sign-in with a temporary password: choose your own password, then see the recovery code. `onSession(result)` continues the sign-in. */
export default function FirstPassword({ token, onSession }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (pw !== pw2) { setErr('The two passwords do not match'); return; }
    setBusy(true);
    try { setOut(await api.post('/api/auth/login/first-password', { change_token: token, password: pw })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (out) return <><h2>Save your recovery code</h2><RecoveryCode code={out.recovery_code} onContinue={() => { const { recovery_code, ...rest } = out; onSession(rest); }} /></>;
  return (
    <form className="stack" onSubmit={submit}>
      <div><h2>Choose your own password</h2><div className="muted">Your temporary password worked once. Pick a password only you know.</div></div>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Field label="New password" hint="At least 8 characters." required><PasswordInput autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Field label="Repeat new password" required><PasswordInput autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
    </form>
  );
}
