// On a contact: who owns the lead and why, the response targets, the buttons that record what the owner did, and any
// follow-up sequence running. Automated mail is listed but labelled; it is never shown as a response.
import { useState } from 'react';
import { Card, Empty, Loading, StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc, titleCase } from '../format.js';

const EVENT_LABEL = { assigned: 'Assigned', unassigned: 'Left without an owner', accepted: 'Accepted by the owner', contact_attempt: 'Contact attempt', human_response: 'Response by a person', automated_message: 'Automated message', reminder: 'Reminder sent', escalated: 'Escalated to the manager', customer_reply: 'Customer replied', sequence_enrolled: 'Follow-up sequence started', sequence_stopped: 'Follow-up sequence stopped', appointment_booked: 'Appointment booked' };
const STATUS_TONE = { active: 'green', paused: 'amber', completed: 'grey', stopped: 'grey' };

export default function LeadFlowPanel({ contactId }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, reload, error } = useFetch(`/api/leadflow/contacts/${contactId}/flow`);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return null;
  if (!data) return <Loading rows={2} />;
  const a = data.assignment, sla = data.sla;
  const mine = a && a.agent_id === user.id;
  const act = async (path, body, ok) => { setBusy(true); try { await api.post(`/api/leadflow/contacts/${contactId}/${path}`, body || {}); if (ok) toast(ok, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const seqAct = async (id, what) => { try { await api.post(`/api/leadflow/enrollments/${id}/${what}`, {}); reload(); } catch (e) { toast(e.message, 'err'); } };
  const due = (iso, done) => (iso ? <span>{done ? 'done' : `due ${dateTimeUtc(iso)}`}</span> : <span className="muted">no target</span>);
  const active = data.sequences.filter((s) => ['active', 'paused'].includes(s.status));
  return (
    <Card title="Lead follow-up">
      {!a ? <p className="muted" style={{ margin: 0 }}>This lead has no assignment record yet. Assigning an owner starts the response targets.</p> : (
        <div className="stack" style={{ gap: 6 }}>
          <div><strong>{a.agent_id ? 'Assigned' : 'Waiting for an owner'}</strong> <span className="muted">{dateTimeUtc(a.assigned_at)} · {a.kind.replace('_', ' ')}</span></div>
          {a.reason && <div className="muted" style={{ fontSize: 12.5 }}>{a.reason}</div>}
          {sla.enabled && a.agent_id && <>
            <div className="row between"><span>Accept the lead</span>{due(a.accept_due_at, !!a.accepted_at)}</div>
            <div className="row between"><span>First response by a person</span>{due(a.response_due_at, !!a.first_human_response_at)}</div>
          </>}
          {a.first_human_response_at && <div className="muted" style={{ fontSize: 12.5 }}>First human response recorded {dateTimeUtc(a.first_human_response_at)}</div>}
        </div>)}
      {a?.agent_id && can('crm', 'edit') && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <input className="input" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note for the record" />
          <div className="row wrap">
            {mine && !a.accepted_at && <button className="btn sm primary" disabled={busy} onClick={() => act('accept', {}, 'Lead accepted')}>Accept lead</button>}
            <button className="btn sm" disabled={busy} onClick={() => { act('attempt', { channel: 'phone', note }, 'Attempt recorded'); setNote(''); }}>Record call attempt</button>
            <button className="btn sm" disabled={busy} onClick={() => { act('response', { channel: 'phone', note }, 'Response recorded'); setNote(''); }}>Record two-way response</button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>An attempt is not a response. A response entered by hand is labelled as a manual record; completed outbound calls in the call log count automatically.</div>
        </div>)}
      {active.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong>Follow-up sequences</strong>
          {active.map((s) => (
            <div key={s.id} className="row between" style={{ marginTop: 6 }}>
              <span>{s.sequence_name} <StatusBadge tone={STATUS_TONE[s.status]} label={s.status === 'paused' && /^blocked:/.test(s.pause_reason || '') ? 'Waiting: sender or allowance' : titleCase(s.status)} /></span>
              {can('crm', 'edit') && <span className="row">
                {s.status === 'active' ? <button className="btn sm ghost" onClick={() => seqAct(s.id, 'pause')}>Pause</button> : <button className="btn sm ghost" onClick={() => seqAct(s.id, 'resume')}>Resume</button>}
                <button className="btn sm ghost" onClick={() => seqAct(s.id, 'cancel')}>Cancel</button>
              </span>}
            </div>))}
          {can('crm', 'edit') && <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => act('reply', { note }, 'Reply recorded, sequences stopped')}>Customer replied</button>
            {!data.reply_detection.configured && <span className="muted" style={{ fontSize: 12 }}>Automatic reply detection is not set up on this server, so record replies here.</span>}
          </div>}
        </div>)}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>History ({data.events.length})</summary>
        {data.events.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6, fontSize: 13 }}>
            {data.events.map((e) => (
              <li key={e.id}>
                <strong>{EVENT_LABEL[e.type] || titleCase(e.type)}</strong>{e.automated ? <span className="tag" style={{ marginLeft: 6 }}>automated</span> : null}
                {e.evidence === 'manual_log' && <span className="tag" style={{ marginLeft: 6 }}>manual record</span>}
                {e.evidence === 'call_log' && <span className="tag" style={{ marginLeft: 6 }}>call log</span>}
                <div className="muted" style={{ fontSize: 12 }}>{dateTimeUtc(e.created_at)}{e.actor_name ? ` · ${e.actor_name}` : ''}{e.detail ? ` · ${e.detail}` : ''}</div>
              </li>))}
          </ul>) : <Empty title="Nothing recorded yet" />}
      </details>
    </Card>
  );
}
