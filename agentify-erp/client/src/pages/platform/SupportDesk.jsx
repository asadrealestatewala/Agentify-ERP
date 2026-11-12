// Console > Support > Support desk: every ticket raised from a workspace, with replies, internal notes, priority,
// assignee, status and the service-level targets. Follows the console card pattern (click to open, coloured buttons).
import { useCallback, useEffect, useState } from 'react';
import { FoldCard, Dot } from './Fold.jsx';
import { Card, Empty, ErrorBox, Field, Loading } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';
import { PRIORITIES, STATUSES, LANG_NAMES, st } from '../../../../shared/supportDesk.js';
import { fmtWhen as when } from './dates.js';

const SLA_TONE = { met: 'ok', ok: 'ok', at_risk: 'warn', breached: 'bad' };
const SLA_WORD = { met: 'met', ok: 'on track', at_risk: 'due soon', breached: 'overdue' };
const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

function Ticket({ id, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD(await api.get(`${A}/support/tickets/${id}`)); } catch (e) { setErr(e.message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const reply = async () => {
    setBusy(true);
    try { setD(await api.post(`${A}/support/tickets/${id}/reply`, { body, internal, status })); setBody(''); toast(internal ? 'Note saved' : 'Reply sent to the customer', 'ok'); onChanged(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const save = async (patch) => { try { setD(await api.put(`${A}/support/tickets/${id}`, patch)); toast('Saved', 'ok'); onChanged(); } catch (e) { toast(e.message, 'err'); } };
  if (err) return <Card title="Ticket"><ErrorBox error={err} /><button className="btn" onClick={onClose}>Back to the list</button></Card>;
  if (!d) return <Card title="Ticket"><Loading /></Card>;
  const t = d.ticket;
  return (
    <>
      <Card title={`${t.no} · ${t.subject}`} actions={<button className="btn sm" onClick={onClose}>Back to the list</button>}>
        <p className="muted">
          {t.workspace?.name || 'workspace'}{t.workspace?.slug ? ` (${t.workspace.slug})` : ''} · {t.workspace?.region || '—'} · {t.requester?.name} &lt;{t.requester?.email}&gt; · language {LANG_NAMES[t.lang] || t.lang} · raised {when(t.created_at)}
        </p>
        <p>
          <Dot tone={SLA_TONE[t.sla.first_state]}>First reply {SLA_WORD[t.sla.first_state]} ({when(t.sla.first_due)})</Dot>{' '}
          <Dot tone={SLA_TONE[t.sla.solve_state]}>Solve {SLA_WORD[t.sla.solve_state]} ({when(t.sla.solve_due)})</Dot>
        </p>
        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Field label="Priority"><select className="input" value={t.priority} onChange={(e) => save({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{st('en', `pri.${p}`)}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={t.status} onChange={(e) => save({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{st('en', `st.${s}`)}</option>)}</select></Field>
          <Field label="Assigned to" hint="Console user e-mail"><input className="input" defaultValue={t.assignee || ''} onBlur={(e) => (e.target.value !== (t.assignee || '') ? save({ assignee: e.target.value }) : null)} /></Field>
        </div>
      </Card>
      <Card title="Conversation">
        {d.messages.map((m) => (
          <div key={m.id} className={`card ${m.internal ? 'tone-warn' : ''}`} style={{ marginBottom: 10 }}>
            <div className="card-b">
              <div className="muted" style={{ fontSize: 12 }}><b>{m.author_type === 'staff' ? m.author_name || 'Support' : m.author_name || 'Customer'}</b> · {when(m.created_at)}{m.internal ? ' · internal note (the customer never sees this)' : ''}</div>
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }} dir="auto">{m.body}</p>
              {!!m.files.length && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{m.files.map((f) => (
                <li key={f.id}><a href={`${A}/support/tickets/${t.id}/files/${f.id}`}>{f.name}</a> <span className="muted">({kb(f.size)})</span></li>
              ))}</ul>}
            </div>
          </div>
        ))}
      </Card>
      <Card title="Reply">
        <Field label={internal ? 'Internal note' : 'Reply to the customer'} hint={internal ? 'Kept in the console only.' : `The customer is e-mailed in ${LANG_NAMES[t.lang] || t.lang}. Write in that language where you can.`}>
          <textarea className="input" rows={5} maxLength={6000} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" />
        </Field>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>
          {!internal && <label className="row" style={{ gap: 6 }}>Set status to <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{st('en', `st.${s}`)}</option>)}</select></label>}
          <button className="btn primary" disabled={busy || !body.trim()} onClick={reply}>{busy ? 'Sending…' : internal ? 'Save note' : 'Send reply'}</button>
        </div>
      </Card>
    </>
  );
}

function Settings({ onSaved }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`${A}/support/settings`).then(setD).catch((e) => setErr(e.message)); }, []);
  const save = async () => {
    setBusy(true);
    try { const out = await api.put(`${A}/support/settings`, { sla: d.sla, notify_email: d.notify_email }); setD(out); toast('Saved', 'ok'); onSaved?.(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading rows={3} />;
  const setCell = (p, i) => (e) => { const sla = { ...d.sla, [p]: [...d.sla[p]] }; sla[p][i] = Number(e.target.value); setD({ ...d, sla }); };
  return (
    <>
      <Field label="Send new-ticket alerts to" hint="One e-mail address for the support team. Empty uses the platform support address."><input className="input" value={d.notify_email || ''} onChange={(e) => setD({ ...d, notify_email: e.target.value })} /></Field>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Priority</th><th>First reply within (minutes)</th><th>Solved within (minutes)</th></tr></thead>
        <tbody>{PRIORITIES.map((p) => (
          <tr key={p}><td>{st('en', `pri.${p}`)}</td>
            <td><input className="input" type="number" min="5" max="20160" value={d.sla[p][0]} onChange={setCell(p, 0)} /></td>
            <td><input className="input" type="number" min="5" max="43200" value={d.sla[p][1]} onChange={setCell(p, 1)} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save targets'}</button>
    </>
  );
}

export default function SupportDesk() {
  const [f, setF] = useState({ status: 'active', priority: '', q: '' });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const load = useCallback(async () => {
    try { setD(await api.get(`${A}/support/tickets`, { status: f.status, ...(f.priority ? { priority: f.priority } : {}), ...(f.q.trim() ? { q: f.q.trim() } : {}) })); setErr(''); }
    catch (e) { setErr(e.message); }
  }, [f.status, f.priority, f.q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const c = d?.counts;
  return (
    <>
      <PageTitle title="Support desk" sub="Tickets raised by workspace users from Help & Support. Replies are e-mailed to the customer in the language they chose." />
      {sel ? <Ticket id={sel} onClose={() => { setSel(null); load(); }} onChanged={load} /> : <>
        <FoldCard id="support-queue" title="Ticket queue" defaultOpen tone={c?.unread ? 'warn' : 'ok'}
          summary={c ? `${c.open} open · ${c.pending} waiting on the customer · ${c.unread} unread · ${c.solved} solved` : 'Loading…'}>
          <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
            <Field label="Show"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Open and waiting</option>{STATUSES.map((s) => <option key={s} value={s}>{st('en', `st.${s}`)}</option>)}<option value="">All</option>
            </select></Field>
            <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{st('en', `pri.${p}`)}</option>)}</select></Field>
            <Field label="Search"><input className="input" placeholder="Subject, workspace or e-mail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
            <button className="btn info" onClick={load}>Refresh</button>
          </div>
          <ErrorBox error={err} />
          {!d ? (!err && <Loading />) : !d.rows.length ? <Empty icon="chat" title="No tickets here" hint="Workspace users raise tickets from Help & Support inside their workspace." /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>No.</th><th>Subject</th><th>Workspace</th><th>Priority</th><th>Status</th><th>First reply</th><th>Last update</th></tr></thead>
              <tbody>{d.rows.map((t) => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSel(t.id)}>
                  <td className="mono">{t.no}{t.unread_staff && <span className="tag" style={{ marginInlineStart: 6 }}>new</span>}</td>
                  <td><b>{t.subject}</b><div className="muted" style={{ fontSize: 12 }}>{t.requester?.name} · {LANG_NAMES[t.lang] || t.lang}</div></td>
                  <td>{t.workspace?.name || '—'}</td>
                  <td>{st('en', `pri.${t.priority}`)}</td>
                  <td>{st('en', `st.${t.status}`)}</td>
                  <td><Dot tone={SLA_TONE[t.sla.first_state]}>{SLA_WORD[t.sla.first_state]}</Dot></td>
                  <td className="nowrap">{when(t.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </FoldCard>
        <FoldCard id="support-settings" title="Reply targets and alerts" summary="How quickly each priority should get a first reply and be solved, and where new-ticket alerts go">
          <Settings onSaved={load} />
        </FoldCard>
      </>}
    </>
  );
}
