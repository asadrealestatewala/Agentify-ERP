// Console: social posting through Zernio. The key is written here and never shown again (only its last 4). Also: billing mode, platform
// limits, which workspaces are switched on, the webhook, and the owner's own Facebook and Instagram for testing end to end first.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const LABEL = { facebook: 'Facebook', instagram: 'Instagram' };

function Connection({ o, can, reload }) {
  const toast = useToast(); const [key, setKey] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(null);
  const act = async (name, fn, msg) => { setBusy(name); setErr(''); try { const r = await fn(); if (msg) toast(msg); return r; } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const save = async () => { const r = await act('save', () => api.put(`${A}/social/zernio`, { key: key || undefined }), 'Saved'); if (r) { setKey(''); reload(); } };
  const test = async () => { const r = await act('test', () => api.post(`${A}/social/zernio/test`)); if (r) setOk(r.accounts); };
  return (
    <Card title="Zernio connection">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>{o.key.set ? <><span className="pill green">Key added</span> ending {o.key.hint}. </> : <><span className="pill grey">No key yet</span> </>}Posts to Facebook and Instagram go through Zernio. The key is stored encrypted and is never shown again.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        <Field label={o.key.set ? 'Replace key (optional)' : 'Zernio API key'} hint="Starts with sk_"><TextInput type="password" value={key} onChange={setKey} placeholder="sk_…" autoComplete="off" /></Field>
        <Field label="Who pays Zernio" hint="Zernio bills per connected account on one team.">
          <select className="input" value={o.mode} disabled={!can} onChange={(e) => act('mode', () => api.put(`${A}/social/zernio`, { mode: e.target.value }), 'Saved').then(reload)}>
            <option value="platform">Agentify pays (one key, shared)</option>
            <option value="workspace">Each workspace pays (its own key)</option>
          </select></Field>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>{o.note}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={!can || !!busy || !key.trim()} onClick={save}>Save key</button>
        <button className="btn" disabled={!can || !!busy || !o.key.set} onClick={test}>{busy === 'test' ? 'Testing…' : 'Test the connection'}</button>
        {o.key.set && <button className="btn danger" disabled={!can || !!busy} onClick={() => window.confirm('Remove the Zernio key? Scheduled posts will not go out until a key is added again.') && act('rm', () => api.del(`${A}/social/zernio/key`), 'Key removed').then(reload)}>Remove key</button>}
        {ok != null && <span className="pill green">Connection works ({ok} account{ok === 1 ? '' : 's'} in this Zernio team)</span>}
      </div>
    </Card>
  );
}

function Webhook({ o, can, reload }) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const setup = async () => { setBusy(true); setErr(''); try { await api.post(`${A}/social/zernio/webhook`); toast('Webhook registered'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Card title="Webhook (posting results)">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Zernio tells us when a post is published or fails. It needs this site to be reachable on the internet, so register it on the live site. Address: <code>{o.webhook.url}</code></p>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn" disabled={!can || busy || !o.key.set} onClick={setup}>{busy ? 'Registering…' : o.webhook.secret_saved ? 'Register again (new secret)' : 'Register the webhook'}</button>
        {o.webhook.secret_saved && <span className="pill green">Registered {o.webhook.registered_at ? o.webhook.registered_at.slice(0, 10) : ''}</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Without it posts still go out; their final status is found by checking Zernio every minute.</p>
    </Card>
  );
}

function Caps({ o, can, reload }) {
  const toast = useToast(); const [f, setF] = useState(() => Object.fromEntries(Object.keys(o.platforms).map((k) => [k, o.caps[k] ?? '']))); const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await api.put(`${A}/social/zernio/caps`, f); toast('Limits saved'); reload(); } catch (e) { setErr(e.message); } };
  return (
    <Card title="Posting limits per account">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>The most posts one connected account may publish in any 24 hours. A post over the limit stays in the calendar and goes out when the limit allows. Zernio's own page states 100 for Instagram; 25 is the starting value here. Empty means no limit from us.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
        {Object.entries(o.platforms).map(([k, l]) => <Field key={k} label={l}><input className="input" type="number" min={1} max={1000} value={f[k]} disabled={!can} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
      </div>
      <button className="btn primary" disabled={!can} onClick={save}>Save limits</button>
    </Card>
  );
}

function Workspaces({ o, can, reload }) {
  const toast = useToast(); const [on, setOn] = useState(() => new Set(o.workspaces.filter((w) => w.on).map((w) => w.id))); const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await api.put(`${A}/social/zernio/workspaces`, { ids: [...on] }); toast('Saved'); reload(); } catch (e) { setErr(e.message); } };
  const flip = (id) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Card title="Workspaces with posting switched on">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Off for everyone until you tick a workspace. Switched-off workspaces keep the manual "tick it off" flow. Start with your own test workspace.</p>
      <div className="stack" style={{ maxHeight: 260, overflow: 'auto' }}>
        {o.workspaces.map((w) => <label key={w.id} className="row" style={{ gap: 8 }}><input type="checkbox" checked={on.has(w.id)} disabled={!can} onChange={() => flip(w.id)} />{w.name} <span className="muted">({w.slug})</span></label>)}
        {!o.workspaces.length && <span className="muted">No workspaces yet.</span>}
      </div>
      <button className="btn primary" disabled={!can} onClick={save} style={{ marginTop: 8 }}>Save</button>
    </Card>
  );
}

function Own({ o, can }) {
  const toast = useToast(); const [accounts, setAccounts] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [pick, setPick] = useState(''); const [text, setText] = useState('Test post from Agentify ERP'); const [img, setImg] = useState(''); const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => api.get(`${A}/social/zernio/own`).then((r) => { setAccounts(r.accounts); setPick((p) => p || r.accounts[0]?.account_id || ''); setErr(''); }).catch((e) => { setAccounts([]); setErr(e.message); }), []);
  useEffect(() => { if (o.key.set) load(); else setAccounts([]); }, [o.key.set, load]);
  useEffect(() => { try { if (new URLSearchParams(window.location.search).get('connected') === '1') load(); } catch { /* ignore */ } }, [load]);
  const connect = async (platform) => { setBusy(platform); try { const r = await api.post(`${A}/social/zernio/own/connect`, { platform }); window.location.href = r.url; } catch (e) { setErr(e.message); setBusy(''); } };
  const post = async () => { setBusy('post'); setConfirm(false); try { await api.post(`${A}/social/zernio/own/test-post`, { account_id: pick, text, image_url: img, accept: true }); toast('Test post sent. Check the account.'); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const chosen = (accounts || []).find((a) => a.account_id === pick);
  return (
    <Card title="Your own connected accounts (test first)">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Connect your own Facebook Page and Instagram here to test everything before any workspace uses it. Zernio's plan includes 2 free accounts. Instagram needs a business or creator account linked to a Facebook Page.</p>
      <div className="row wrap" style={{ gap: 8 }}>{Object.entries(LABEL).map(([k, l]) => <button key={k} className="btn primary" disabled={!can || !o.key.set || !!busy} onClick={() => connect(k)}>{busy === k ? 'Opening…' : `Connect ${l}`}</button>)}<button className="btn" disabled={!o.key.set} onClick={load}>Refresh</button></div>
      {accounts == null ? <Loading rows={1} /> : !accounts.length ? <p>{o.key.set ? 'No account connected yet.' : 'Add the key first.'}</p> : (
        <>
          <table className="sheet" style={{ marginTop: 8 }}><thead><tr><th>Account</th><th>Where</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.account_id}><td>{a.username ? `@${a.username}` : a.name}</td><td>{LABEL[a.platform] || a.platform}</td></tr>)}</tbody></table>
          <h4 style={{ marginBottom: 4 }}>Publish a real test post</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            <Field label="Account"><select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>{accounts.map((a) => <option key={a.account_id} value={a.account_id}>{LABEL[a.platform]}: {a.username ? `@${a.username}` : a.name}</option>)}</select></Field>
            <Field label="Text"><TextInput value={text} onChange={setText} maxLength={500} /></Field>
            <Field label="Public picture link (https)" hint={chosen?.platform === 'instagram' ? 'Required: Instagram cannot post text alone' : 'Optional'}><TextInput value={img} onChange={setImg} placeholder="https://…" /></Field>
          </div>
          {!confirm ? <button className="btn" disabled={!can || !!busy || !pick} onClick={() => setConfirm(true)}>Publish test post…</button>
            : <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={post}>Yes, publish this on the real account now</button><button className="btn" onClick={() => setConfirm(false)}>Cancel</button></div>}
        </>)}
    </Card>
  );
}

export default function SocialPosting() {
  const can = useCan()('integrations.manage');
  const [o, setO] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${A}/social/zernio`).then(setO).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !o) return <ErrorBox error={err} />;
  if (!o) return <Loading />;
  return (
    <>
      <PageTitle title="Social posting" sub="Publish workspace posts to Facebook and Instagram through Zernio" />
      <Connection o={o} can={can} reload={load} />
      <Own o={o} can={can} />
      <Workspaces o={o} can={can} reload={load} />
      <Caps o={o} can={can} reload={load} />
      <Webhook o={o} can={can} reload={load} />
    </>
  );
}
