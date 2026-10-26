import { useEffect, useState } from 'react';
import { Card, PageHead } from '../components/ui.jsx';
import TwoFactor from '../components/TwoFactor.jsx';
import { api, download } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const MODES = [['off', 'Off', 'Staff sign in with their password only (or password plus authenticator app).'], ['new_device', 'New browsers only', 'A code is emailed when someone signs in from a browser we have not seen for them. Recommended.'], ['always', 'Every sign-in', 'A code is emailed every time, after the password.']];
function EmailCode() {
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/api/auth/login-otp').then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const set = async (mode) => { try { setS(await api.put('/api/auth/login-otp', { mode })); toast('Saved'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Email sign-in code">
      <p className="muted">After the password, staff must type a 6-digit code we email to them. It proves the person really owns the mailbox, so nobody can sign in with an address that is not theirs. People who use an authenticator app below are asked for that instead.</p>
      {!s.can_send && <div className="alert warn" role="status">Email sending is not set up on this platform yet, so codes cannot be delivered and this stays off. Ask your Agentify administrator to connect email.</div>}
      <div className="stack">
        {MODES.map(([k, label, hint]) => (
          <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input type="radio" name="login-otp" checked={s.mode === k} disabled={!s.can_edit || (!s.can_send && k !== 'off')} onChange={() => set(k)} style={{ width: 'auto', marginTop: 4 }} />
            <span><b>{label}</b><div className="muted">{hint}</div></span>
          </label>
        ))}
      </div>
      {!s.can_edit && <p className="muted" style={{ marginBottom: 0 }}>Only an administrator can change this.</p>}
      <p className="muted" style={{ marginBottom: 0 }}>You also get an email whenever your account is signed in from a new address and browser.</p>
    </Card>
  );
}

const when = (ts) => String(ts || '').slice(0, 16).replace('T', ' ');
function Devices() {
  const toast = useToast();
  const [list, setList] = useState(null);
  useEffect(() => { api.get('/api/auth/devices').then(setList).catch(() => setList([])); }, []);
  if (!list) return null;
  const signOutAll = async () => { if (!window.confirm('Sign out of every device? This browser stays signed in.')) return; try { await api.post('/api/auth/devices/sign-out-all'); toast('Every other device was signed out'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Where you have signed in">
      <p className="muted">Browsers and addresses used to sign in to your account. If you see one you do not recognise, sign out everywhere and change your password.</p>
      {list.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Browser</th><th>Addresses</th><th>Last used</th></tr></thead><tbody>
          {list.map((d, i) => <tr key={i}><td><b>{d.browser}</b>{d.current && <span className="muted"> (this browser)</span>}</td><td>{d.ips.join(', ')}</td><td>{when(d.last_seen)}</td></tr>)}
        </tbody></table></div>
      )}
      <button className="btn" onClick={signOutAll}>Sign out of every other device</button>
    </Card>
  );
}

export default function Security() {
  const { user } = useAuth();
  const toast = useToast();
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHead title="Security" sub="Protect your sign-in" />
      <TwoFactor base="/api/auth/2fa" />
      <EmailCode />
      <Devices />
      {user?.isSuper && (
        <Card title="Download a backup">
          <p className="muted">A copy of your workspace database, taken right now. Keep it somewhere safe and private. Uploaded files and documents are not inside this file.</p>
          <button className="btn" onClick={() => download('/api/settings/backup', {}, `backup-${new Date().toISOString().slice(0, 10)}.db`).catch((e) => toast(e.message, 'err'))}>Download database backup</button>
        </Card>
      )}
    </div>
  );
}
