// Security & access (console users with roles, sessions, sign-in history, security rules), audit log and maintenance.
import { useCallback, useContext, useEffect, useState } from 'react';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, MeContext } from './AdminShell.jsx';
import { downloadCsv } from './Billing.jsx';

const ago = (ts) => {
  if (!ts) return 'Never';
  const s = (Date.now() - Date.parse(`${String(ts).replace(' ', 'T')}${String(ts).includes('Z') ? '' : 'Z'}`)) / 1000;
  if (!Number.isFinite(s)) return String(ts).slice(0, 16);
  if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return String(ts).slice(0, 16);
};
const device = (ua) => {
  const u = String(ua || '');
  const b = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : u ? 'Browser' : 'Unknown';
  const os = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Mac OS/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '';
  return [b, os].filter(Boolean).join(' on ');
};
function useLoad(url) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); return api.get(url).then(setD).catch((e) => setErr(e.message)); }, [url]);
  useEffect(() => { load(); }, [load]);
  return { d, err, load };
}

// ---------------------------------------------------------------- console users
export function AdminsPage() {
  const toast = useToast();
  const { d, err, load } = useLoad(`${A}/admins`);
  const [add, setAdd] = useState(null);
  const [del, setDel] = useState(null);
  const [roles, setRoles] = useState(false);
  const [sec, setSec] = useState(null);
  useEffect(() => { api.get(`${A}/security-settings`).then(setSec).catch(() => {}); }, []);
  const patch = async (a, body, msg) => { try { await api.patch(`${A}/admins/${a.id}`, body); toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };
  const [link, setLink] = useState(null);
  const save = async () => { try { const out = await api.post(`${A}/admins`, { name: add.name, email: add.email, role: add.role }); setAdd(null); if (out.link) setLink(out); else toast(`Invitation emailed to ${out.email}`); load(); } catch (e) { toast(e.message, 'err'); } };
  const setRequire = async (v) => { try { setSec(await api.put(`${A}/security-settings`, { require_2fa: v })); toast(v ? 'Two-factor is now required for every console user' : 'Two-factor is now optional'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Console users & roles" sub="People who can sign in to this super admin console. Each role allows a fixed set of actions; every action is checked on the server.">
        <button className="btn sm" onClick={() => setRoles(true)}>What each role can do</button>
        <button className="btn primary sm" onClick={() => setAdd({ name: '', email: '', role: 'read_only' })}>Invite console user</button>
      </PageTitle>
      <ErrorBox error={err} />
      {sec && <Card title="Security rules">
        <Toggle value={sec.require_2fa} onChange={setRequire} label="Require two-factor sign-in for every console user" />
        <p className="muted" style={{ marginBottom: 0 }}>Users without it can only open Security to set it up until they do. You need it on your own account before switching this on.</p>
      </Card>}
      {!d ? (!err && <Loading />) : (
        <Card flush>
          <div className="table-wrap"><table className="t"><thead><tr><th>User</th><th>Role</th><th>Two-factor</th><th>Last sign-in</th><th>Access</th><th /></tr></thead><tbody>
            {d.admins.map((a) => (
              <tr key={a.id}>
                <td><b>{a.name}</b>{a.id === d.me && <span className="muted"> (you)</span>}<div className="muted">{a.email}</div>{a.status === 'invited' && <StatusBadge status="pending" label="Invitation sent" />}{a.status === 'invite_expired' && <StatusBadge status="overdue" label="Invitation expired" />}</td>
                <td>{a.id === d.me ? a.role_label : <select className="input" style={{ width: 230 }} value={a.role} aria-label={`Role of ${a.email}`} onChange={(e) => patch(a, { role: e.target.value }, 'Role changed. Their sessions were signed out.')}>{Object.entries(d.roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>}</td>
                <td><StatusBadge status={a.totp_enabled ? 'active' : 'inactive'} label={a.totp_enabled ? 'On' : 'Off'} /></td>
                <td className="nowrap">{ago(a.last_login)}</td>
                <td>{a.id === d.me ? <StatusBadge status="active" /> : <Toggle value={a.active} onChange={(v) => patch(a, { active: v }, v ? 'Access restored' : 'Access switched off and sessions ended')} label={a.active ? 'Allowed' : 'Off'} />}</td>
                <td className="right">{a.id !== d.me && <button className="btn sm danger" onClick={() => setDel(a)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </Card>
      )}
      {add && d && (
        <Modal title="Invite console user" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>Cancel</button><button className="btn primary" onClick={save}>Send invitation</button></>}>
          <p className="muted">They get a one-time link (valid 72 hours) to choose their own password. Nobody else ever knows it.</p>
          <Field label="Name"><TextInput value={add.name} onChange={(v) => setAdd({ ...add, name: v })} /></Field>
          <Field label="Email" required><TextInput type="email" value={add.email} onChange={(v) => setAdd({ ...add, email: v })} /></Field>
          <Field label="Role" hint="Give the smallest role that lets them do their job."><select className="input" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{Object.entries(d.roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></Field>
        </Modal>
      )}
      {link && (
        <Modal title="Share the invitation link" onClose={() => setLink(null)} footer={<button className="btn primary" onClick={() => setLink(null)}>Done</button>}>
          <p>Email is not configured on this server, so the invitation for <b>{link.email}</b> was not sent. Pass this one-time link to them privately:</p>
          <p className="mono" style={{ wordBreak: 'break-all' }}>{link.link}</p>
          <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(link.link); toast('Link copied'); }}>Copy link</button>
        </Modal>
      )}
      {roles && d && (
        <Modal title="Roles and permissions" size="lg" onClose={() => setRoles(false)} footer={<button className="btn primary" onClick={() => setRoles(false)}>Close</button>}>
          <div className="table-wrap"><table className="t"><thead><tr><th>Permission</th>{Object.values(d.roles).map((r) => <th key={r.label} style={{ fontSize: 11 }}>{r.label}</th>)}</tr></thead><tbody>
            {Object.entries(d.permissions).map(([p, label]) => <tr key={p}><td>{label}</td>{Object.values(d.roles).map((r) => <td key={r.label} style={{ textAlign: 'center' }}>{r.perms.includes(p) ? '✓' : ''}</td>)}</tr>)}
          </tbody></table></div>
        </Modal>
      )}
      {del && <ConfirmDialog title="Remove console user?" danger confirmLabel="Remove" message={`${del.email} loses access immediately. Their past actions stay in the audit log. To keep the account but block it, switch off Access instead.`} onCancel={() => setDel(null)}
        onConfirm={async () => { try { await api.del(`${A}/admins/${del.id}`); setDel(null); toast('Removed'); load(); } catch (e) { toast(e.message, 'err'); } }} />}
    </>
  );
}

// ---------------------------------------------------------------- sessions and sign-ins
export function SessionsPage() {
  const toast = useToast();
  const me = useContext(MeContext);
  const [all, setAll] = useState(false);
  const { d, err, load } = useLoad(`${A}/sessions${all ? '?all=1' : ''}`);
  const revoke = async (s) => { try { await api.del(`${A}/sessions/${s.ref}`); toast('Session ended'); load(); } catch (e) { toast(e.message, 'err'); } };
  const others = async () => { try { const r = await api.post(`${A}/sessions/revoke-others`); toast(`${r.revoked} other session(s) ended`); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Active sessions" sub="Where console users are signed in. Ending a session signs that device out straight away.">
        {me.permissions.includes('admins.manage') && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All users</label>}
        <button className="btn sm" onClick={others}>Sign out my other devices</button>
      </PageTitle>
      <ErrorBox error={err} />
      <Card flush>
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No active sessions" /> : (
          <div className="table-wrap"><table className="t"><thead><tr>{all && <th>User</th>}<th>Device</th><th>IP address</th><th>Signed in (UTC)</th><th>Last active</th><th /></tr></thead><tbody>
            {d.rows.map((s) => <tr key={s.ref}>{all && <td><b>{s.name}</b><div className="muted">{s.email}</div></td>}<td>{device(s.user_agent)}{s.current && <span className="pill green" style={{ marginLeft: 6 }}><i />This device</span>}</td><td className="mono">{s.ip || '—'}</td><td className="nowrap">{s.created_at.slice(0, 16)}</td><td>{ago(s.last_seen)}</td>
              <td className="right">{!s.current && <button className="btn sm danger" onClick={() => revoke(s)}>End session</button>}</td></tr>)}
          </tbody></table></div>
        )}
      </Card>
    </>
  );
}

export function LoginsPage() {
  const [f, setF] = useState({ email: '', outcome: '', page: 0 });
  const p = new URLSearchParams(Object.entries({ ...f, per: 50 }).filter(([, v]) => v !== ''));
  const { d, err } = useLoad(`${A}/logins?${p}`);
  const label = { success: 'Signed in', bad_password: 'Wrong email or password', mfa_failed: 'Wrong two-factor code', account_disabled: 'Access switched off' };
  return (
    <>
      <PageTitle title="Sign-in history" sub="Every attempt to sign in to this console. Five failures for one email within 15 minutes, or a sign-in from a new IP, raises an alert. Passwords are never stored." />
      <ErrorBox error={err} />
      <Card flush actions={<>
        <input className="input" style={{ width: 220 }} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value, page: 0 })} aria-label="Filter by email" />
        <select className="input" style={{ width: 160 }} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value, page: 0 })} aria-label="Outcome"><option value="">All attempts</option><option value="success">Successful</option><option value="failed">Failed</option></select>
      </>} title={d ? `${d.total} attempt${d.total === 1 ? '' : 's'}` : 'Loading'}>
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No sign-in attempts match" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When (UTC)</th><th>Email</th><th>Result</th><th>IP address</th><th>Device</th></tr></thead><tbody>
            {d.rows.map((r) => <tr key={r.id}><td className="nowrap muted">{r.created_at.slice(0, 19)}</td><td>{r.email}</td><td><StatusBadge status={r.outcome === 'success' ? 'active' : 'rejected'} label={label[r.outcome] || r.outcome} /></td><td className="mono">{r.ip || '—'}</td><td>{device(r.user_agent)}</td></tr>)}
          </tbody></table></div>
        )}
        {d && d.total > 50 && <div className="pa-pager"><span className="muted">{f.page * 50 + 1}–{Math.min(d.total, (f.page + 1) * 50)} of {d.total}</span><span><button className="btn sm" disabled={!f.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button> <button className="btn sm" disabled={(f.page + 1) * 50 >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></span></div>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- audit log
export function AuditPage() {
  const [f, setF] = useState({ admin: '', action: '', target: '', outcome: '', from: '', to: '', page: 0 });
  const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, per: 50, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();
  const { d, err } = useLoad(`${A}/audit/search?${qs()}`);
  const [open, setOpen] = useState(null);
  const exportCsv = async () => {
    let page = 0, rows = [];
    for (;;) { const r = await api.get(`${A}/audit/search?${qs({ page, per: 500 })}`); rows = rows.concat(r.rows); if (rows.length >= r.total || !r.rows.length || rows.length >= 20000) break; page += 1; }
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, ['When (UTC)', 'Who', 'Role', 'Action', 'Target', 'Reason', 'Outcome', 'IP', 'Request ID', 'Detail'],
      rows.map((r) => [r.created_at, r.admin, r.actor_role, r.action, r.target, r.reason, r.outcome, r.ip, r.request_id, r.detail]));
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, page: 0 });
  return (
    <>
      <PageTitle title="Audit log" sub="Every change made in this console, who made it, from where and why. Entries cannot be edited or deleted.">
        <button className="btn sm" onClick={exportCsv} disabled={!d?.total}>Export CSV</button>
      </PageTitle>
      <Card flush title={d ? `${d.total} entr${d.total === 1 ? 'y' : 'ies'}` : 'Loading'} actions={<>
        <input className="input" style={{ width: 170 }} placeholder="Who (email)" value={f.admin} onChange={set('admin')} aria-label="Filter by admin" />
        <input className="input" style={{ width: 150 }} placeholder="Action" value={f.action} onChange={set('action')} aria-label="Filter by action" />
        <input className="input" style={{ width: 150 }} placeholder="Workspace / target" value={f.target} onChange={set('target')} aria-label="Filter by target" />
        <select className="input" style={{ width: 130 }} value={f.outcome} onChange={set('outcome')} aria-label="Outcome"><option value="">Any result</option><option value="success">Succeeded</option><option value="denied">Denied</option></select>
        <input type="date" className="input" value={f.from} onChange={set('from')} aria-label="From date" /><input type="date" className="input" value={f.to} onChange={set('to')} aria-label="To date" />
      </>}>
        <ErrorBox error={err} />
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No entries match" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th><th>Result</th><th>IP</th></tr></thead><tbody>
            {d.rows.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(r)}><td className="nowrap muted">{r.created_at.slice(0, 19)}</td><td>{r.admin}<div className="muted">{r.actor_role || ''}</div></td><td>{r.action}</td><td className="mono">{r.target || '—'}</td><td className="muted">{r.reason || ''}</td>
              <td><StatusBadge status={r.outcome === 'denied' ? 'rejected' : 'active'} label={r.outcome || 'success'} /></td><td className="mono">{r.ip || '—'}</td></tr>)}
          </tbody></table></div>
        )}
        {d && d.total > 50 && <div className="pa-pager"><span className="muted">{f.page * 50 + 1}–{Math.min(d.total, (f.page + 1) * 50)} of {d.total}</span><span><button className="btn sm" disabled={!f.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button> <button className="btn sm" disabled={(f.page + 1) * 50 >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></span></div>}
      </Card>
      {open && (
        <Modal title={`${open.action} · ${open.created_at.slice(0, 19)} UTC`} onClose={() => setOpen(null)} footer={<button className="btn primary" onClick={() => setOpen(null)}>Close</button>}>
          <dl style={{ margin: 0 }}>{[['Who', `${open.admin} (${open.actor_role || 'unknown role'})`], ['Target', open.target], ['Reason', open.reason], ['Result', open.outcome], ['IP address', open.ip], ['Browser', open.user_agent], ['Request ID', open.request_id]].map(([k, v]) => <div className="kv" key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
          {open.detail && <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{JSON.stringify(JSON.parse(open.detail), null, 2)}</pre>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- maintenance
export function MaintenancePage() {
  const toast = useToast();
  const me = useContext(MeContext);
  const { d, err, load } = useLoad(`${A}/maintenance`);
  const errors = useLoad(`${A}/errors`);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState('');
  const canManage = me.permissions.includes('system.manage');
  const set = async (on, reason) => { try { await api.put(`${A}/maintenance`, { on, reason, message: msg }); toast(on ? 'Maintenance mode is on' : 'Maintenance mode is off'); setAsk(false); load(); window.dispatchEvent(new Event('pa:me')); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Maintenance mode" sub="While it is on, every workspace shows your message and cannot be used. This console, sign-ups and payment webhooks keep working, so you can always switch it off here." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <Card title={<span>Status <span className={`pa-state ${d.on ? 'degraded' : 'healthy'}`}>{d.on ? 'Workspaces closed' : 'Workspaces open'}</span></span>}>
          {d.on ? <>
            <p>Started {String(d.since).replace('T', ' ').slice(0, 16)} UTC by {d.by}. Reason: {d.reason}</p>
            <p>Message shown to customers: <b>{d.message}</b></p>
            {canManage && <button className="btn primary" onClick={() => set(false)}>End maintenance and reopen workspaces</button>}
          </> : <>
            <Field label="Message customers will see"><TextInput value={msg} onChange={setMsg} placeholder="We are carrying out scheduled maintenance. Please try again shortly." /></Field>
            {canManage ? <button className="btn danger" onClick={() => setAsk(true)}>Start maintenance</button> : <p className="muted">Your role cannot change maintenance mode.</p>}
          </>}
        </Card>
      )}
      <Card title="Recent server errors" flush actions={<button className="btn sm" onClick={errors.load}>Refresh</button>}>
        {!errors.d ? <Loading /> : !errors.d.length ? <Empty title="No server errors since the last restart" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When (UTC)</th><th>Request</th><th>Workspace host</th><th>Error</th></tr></thead><tbody>
            {errors.d.map((e, i) => <tr key={i}><td className="nowrap muted">{e.at.replace('T', ' ').slice(0, 19)}</td><td className="mono">{e.method} {e.path}</td><td>{e.host}</td><td>{e.message}</td></tr>)}
          </tbody></table></div>
        )}
      </Card>
      {ask && <ConfirmDialog title="Close every workspace?" danger confirmLabel="Start maintenance" reason message="All customers lose access until you end maintenance here. The reason is kept in the audit log." onCancel={() => setAsk(false)} onConfirm={(reason) => set(true, reason)} />}
    </>
  );
}

// ---------------------------------------------------------------- email safety
/** Signup code, disposable-address blocking and the Super Admin's own domain list. */
export function EmailSafetyPage() {
  const toast = useToast();
  const { d, err, load } = useLoad(`${A}/email-safety`);
  const [rule, setRule] = useState({ domain: '', action: 'block', note: '' });
  const [probe, setProbe] = useState('');
  const [result, setResult] = useState(null);
  const sw = async (k, v) => { try { await api.put(`${A}/email-safety`, { [k]: v }); load(); toast('Saved'); } catch (e) { toast(e.message, 'err'); } };
  const add = async () => { try { await api.post(`${A}/email-safety/rules`, rule); setRule({ domain: '', action: 'block', note: '' }); load(); toast('Added'); } catch (e) { toast(e.message, 'err'); } };
  const del = async (dom) => { try { await api.del(`${A}/email-safety/rules/${encodeURIComponent(dom)}`); load(); } catch (e) { toast(e.message, 'err'); } };
  const check = async () => { try { setResult(await api.post(`${A}/email-safety/check`, { email: probe })); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Email safety" sub="Stop fake and temporary email addresses from creating workspaces or joining a team." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <Card title="Rules">
            <Toggle value={d.signup_email_code} onChange={(v) => sw('signup_email_code', v)} label="Require an emailed code before a workspace is created" />
            <p className="muted">The owner types a 6-digit code sent to their address, so the mailbox must be real and theirs. Applies only while email sending is connected (Integrations); otherwise signup stays open without it.</p>
            <Toggle value={d.block_disposable_email} onChange={(v) => sw('block_disposable_email', v)} label={`Refuse temporary and disposable email services (${d.builtin_count} built-in domains plus your list)`} />
            <Toggle value={d.check_email_mx} onChange={(v) => sw('check_email_mx', v)} label="Refuse domains that cannot receive email at all (typos and invented domains)" />
            <p className="muted" style={{ marginBottom: 0 }}>No list can be complete: new disposable services appear every day. The emailed code is the strong protection; the list removes the easy abuse. When you spot a new service in Workspaces, add its domain below.</p>
          </Card>
          <Card title="Your domain list">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Domain"><TextInput value={rule.domain} onChange={(v) => setRule({ ...rule, domain: v })} placeholder="example-temp-mail.com" /></Field>
              <Field label="What to do"><select className="input" value={rule.action} onChange={(e) => setRule({ ...rule, action: e.target.value })}><option value="block">Block it</option><option value="allow">Always allow it</option></select></Field>
              <Field label="Note (optional)"><TextInput value={rule.note} onChange={(v) => setRule({ ...rule, note: v })} /></Field>
              <button className="btn primary" disabled={!rule.domain.trim()} onClick={add}>Add</button>
            </div>
            <p className="muted">A domain covers its subdomains. “Always allow” beats the built-in list, for a real company the list gets wrong.</p>
            {d.rules.length === 0 ? <Empty title="Your list is empty" hint="Domains you add show up here." /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Domain</th><th>Rule</th><th>Note</th><th>Added</th><th /></tr></thead><tbody>
                {d.rules.map((x) => <tr key={x.domain}><td><b>{x.domain}</b></td><td><StatusBadge status={x.action === 'block' ? 'overdue' : 'active'} label={x.action === 'block' ? 'Blocked' : 'Always allowed'} /></td><td>{x.note || ''}</td><td className="muted">{x.created_by || ''} {String(x.created_at).slice(0, 10)}</td><td><button className="btn sm" onClick={() => del(x.domain)}>Remove</button></td></tr>)}
              </tbody></table></div>
            )}
          </Card>
          <Card title="Try an address">
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field label="Email address"><TextInput value={probe} onChange={setProbe} placeholder="someone@example.com" /></Field>
              <button className="btn" disabled={!probe.trim()} onClick={check}>Check</button>
            </div>
            {result && <div className={`alert ${result.ok ? 'ok' : 'err'}`} role="status" style={{ marginTop: 10 }}>{result.ok ? 'This address would be accepted.' : result.message}</div>}
          </Card>
        </>
      )}
    </>
  );
}
