// Connected accounts for the content calendar: connect Facebook and Instagram through the posting service, see what is connected,
// disconnect. In workspaces that pay the posting service themselves, it also holds their key (write-only; only the last 4 are shown).
import { useEffect, useState } from 'react';
import { Modal } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

const LABEL = { facebook: 'Facebook', instagram: 'Instagram' };

export default function ConnectedAccounts({ posting, canManage, onClose, onChanged }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState(posting?.accounts || []);
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState(''); const [hint, setHint] = useState(posting?.key_hint || null);
  const ready = posting?.enabled;
  const sync = async (quiet) => {
    setBusy('sync');
    try { const r = await api.post('/api/content/posting/sync'); setAccounts(r.accounts); onChanged?.(); if (!quiet) toast('Accounts refreshed'); }
    catch (e) { if (!quiet) toast(e.message, 'err'); } finally { setBusy(''); }
  };
  useEffect(() => { if (ready) sync(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const connect = async (platform) => {
    setBusy(platform);
    try { const r = await api.post('/api/content/posting/connect', { platform }); window.location.href = r.url; }
    catch (e) { toast(e.message, 'err'); setBusy(''); }
  };
  const remove = async (a) => {
    if (!window.confirm(`Disconnect ${a.username ? `@${a.username}` : a.name}? Scheduled posts for it will not go out.`)) return;
    try { await api.del(`/api/content/posting/accounts/${encodeURIComponent(a.account_id)}`); setAccounts((x) => x.filter((y) => y.account_id !== a.account_id)); onChanged?.(); } catch (e) { toast(e.message, 'err'); }
  };
  const saveKey = async () => {
    setBusy('key');
    try { const r = await api.put('/api/content/posting/key', { key }); setHint(r.key_hint); setKey(''); toast(key ? 'Key saved' : 'Key removed'); onChanged?.(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  return (
    <Modal title="Connected accounts" size="md" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack" data-tour="connected-accounts">
        {!posting?.listed && <div className="alert info">Posting through the calendar is not switched on for your workspace yet.</div>}
        {posting?.listed && posting.mode === 'workspace' && (
          <div>
            <label className="field"><span>Your posting service key</span>
              <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hint ? `Saved (${hint}). Paste a new key to replace it.` : 'Paste the key that starts with sk_'} disabled={!canManage} /></label>
            <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn sm primary" disabled={!canManage || busy === 'key' || !key.trim()} onClick={saveKey}>Save key</button>{hint && <button className="btn sm" disabled={!canManage || busy === 'key'} onClick={() => { setKey(''); api.put('/api/content/posting/key', { key: '' }).then(() => { setHint(null); onChanged?.(); }).catch((e) => toast(e.message, 'err')); }}>Remove key</button>}</div>
            <p className="muted" style={{ fontSize: 12 }}>The key is stored encrypted and is never shown again. Your posting service bills you directly.</p>
          </div>)}
        {ready && (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              {Object.entries(LABEL).map(([k, l]) => <button key={k} className="btn primary" disabled={!canManage || !!busy} onClick={() => connect(k)}>{busy === k ? 'Opening…' : `Connect ${l}`}</button>)}
              <button className="btn" disabled={!!busy} onClick={() => sync(false)}>{busy === 'sync' ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            {!canManage && <p className="muted" style={{ fontSize: 12 }}>Ask someone with approval rights to connect accounts.</p>}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Instagram needs a <b>business or creator</b> account (personal accounts cannot post this way). Facebook posts go to a Page you manage. Every Instagram post needs a picture or video.</p>
            {!accounts.length ? <p>No account is connected yet.</p> : (
              <table className="sheet"><thead><tr><th>Account</th><th>Where</th><th /></tr></thead>
                <tbody>{accounts.map((a) => <tr key={a.account_id}><td>{a.username ? `@${a.username}` : a.name}</td><td>{LABEL[a.platform] || a.platform}</td><td className="right">{canManage && <button className="btn sm ghost danger" onClick={() => remove(a)}>Disconnect</button>}</td></tr>)}</tbody></table>)}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Instagram allows {posting.caps?.instagram || 25} posts per account in any 24 hours. A post that would go over stays in the calendar and goes out when the limit allows.</p>
          </>)}
      </div>
    </Modal>
  );
}
