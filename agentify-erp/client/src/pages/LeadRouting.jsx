// Settings > Lead routing: response targets, routing rules, agent availability and duplicate review. Changes affect only
// leads that arrive afterwards; nothing here moves a lead that already has an owner.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge, Tabs, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc } from '../format.js';

const MODES = [{ value: 'round_robin', label: 'Take turns (round robin)' }, { value: 'weighted', label: 'Take turns, favouring higher weights' }, { value: 'manual', label: 'Wait for a manager to choose' }];

function Targets({ s, reload, canEdit }) {
  const toast = useToast();
  const [f, setF] = useState({ ...s.sla });
  const [owner, setOwner] = useState(s.default_owner_id || '');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try { await api.put('/api/leadflow/sla', f); await api.put('/api/leadflow/default-owner', { user_id: owner || null }); toast('Saved', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const num = (k, label, hint) => <Field label={label} hint={hint}><input className="input" type="number" min="1" disabled={!canEdit} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} /></Field>;
  return (
    <Card title="Response targets" actions={canEdit && <button className="btn primary sm" onClick={save}>Save</button>}>
      <p className="muted" style={{ marginTop: 0 }}>When a lead is assigned, its owner has a time to accept it and a time to respond personally. Reminders, a manager alert and an optional reassignment follow only if the target is missed. Automated messages never count as a response.</p>
      <div className="stack" style={{ gap: 12, maxWidth: 560 }}>
        <Toggle value={f.enabled} onChange={(v) => set('enabled', v)} label="Use response targets" />
        {num('accept_minutes', 'Accept within (minutes)', 'Leave empty to skip the acceptance step')}
        {num('first_response_minutes', 'First response by a person within (minutes)')}
        <Toggle value={f.business_hours_only} onChange={(v) => set('business_hours_only', v)} label="Count working hours only (uses the working calendar in HR > Onboarding)" />
        {num('remind_at_percent', 'Remind the owner at (% of the time)')}
        <Toggle value={f.escalate_to_manager} onChange={(v) => set('escalate_to_manager', v)} label="Alert the sales manager when a target is missed" />
        {num('reassign_after_minutes', 'Reassign this long after a missed target (minutes)', 'Leave empty to never reassign automatically')}
        {num('max_reassignments', 'Automatic reassignments per lead (at most)')}
        <Field label="Default owner" hint="Gets a lead when no rule matches or nobody is eligible"><Select value={owner} onChange={setOwner} options={s.staff.map((u) => ({ value: u.id, label: u.name }))} placeholder="Use round robin / sales manager" disabled={!canEdit} /></Field>
      </div>
    </Card>
  );
}

function RuleEditor({ rule, staff, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(rule ? { ...rule, agents: rule.agent_ids } : { name: '', mode: 'round_robin', priority: 100, match: {}, agents: [], team: '', fallback_agent_id: '', active: true });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setMatch = (k, v) => setF((x) => ({ ...x, match: { ...x.match, [k]: v.split(',').map((t) => t.trim()).filter(Boolean) } }));
  const toggleAgent = (id) => setF((x) => ({ ...x, agents: x.agents.some((a) => a.id === id) ? x.agents.filter((a) => a.id !== id) : [...x.agents, { id, weight: 1 }] }));
  const weight = (id, w) => setF((x) => ({ ...x, agents: x.agents.map((a) => (a.id === id ? { ...a, weight: Number(w) || 1 } : a)) }));
  const save = async () => {
    try {
      const body = { name: f.name, mode: f.mode, priority: Number(f.priority) || 100, match: f.match, agent_ids: f.agents, team: f.team, fallback_agent_id: f.fallback_agent_id || null, active: f.active };
      if (rule) await api.put(`/api/leadflow/rules/${rule.id}`, body); else await api.post('/api/leadflow/rules', body);
      toast('Rule saved', 'ok'); onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title={rule ? 'Edit routing rule' : 'New routing rule'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save rule</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Name" required><input className="input" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="How leads are shared"><Select allowEmpty={false} value={f.mode} onChange={(v) => set('mode', v)} options={MODES} /></Field>
        <Field label="Order" hint="Lower numbers are checked first; the first rule that fits wins"><input className="input" type="number" value={f.priority} onChange={(e) => set('priority', e.target.value)} /></Field>
        <Field label="Only for lead sources" hint="Comma separated, for example Website, Facebook. Empty means every source."><input className="input" defaultValue={(f.match.sources || []).join(', ')} onBlur={(e) => setMatch('sources', e.target.value)} /></Field>
        <Field label="Only for cities" hint="Comma separated. Empty means every city."><input className="input" defaultValue={(f.match.cities || []).join(', ')} onBlur={(e) => setMatch('cities', e.target.value)} /></Field>
        <Field label="Only for property types"><input className="input" defaultValue={(f.match.property_types || []).join(', ')} onBlur={(e) => setMatch('property_types', e.target.value)} /></Field>
        {f.mode !== 'manual' && <Field label="Agents in this rule" hint="Agents who are away, over their open-lead limit or outside their team, project or city are skipped">
          <div className="stack" style={{ gap: 6 }}>
            {staff.map((u) => { const on = f.agents.find((a) => a.id === u.id); return (
              <div key={u.id} className="row between">
                <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!on} onChange={() => toggleAgent(u.id)} />{u.name} <span className="muted">{u.role}</span></label>
                {on && f.mode === 'weighted' && <input className="input" style={{ width: 70 }} type="number" min="1" max="20" value={on.weight} onChange={(e) => weight(u.id, e.target.value)} aria-label={`Weight for ${u.name}`} />}
              </div>); })}
          </div>
        </Field>}
        <Field label="Team (optional)" hint="Only agents whose profile has this team"><input className="input" value={f.team || ''} onChange={(e) => set('team', e.target.value)} /></Field>
        <Field label="If nobody is eligible"><Select value={f.fallback_agent_id} onChange={(v) => set('fallback_agent_id', v)} options={staff.map((u) => ({ value: u.id, label: u.name }))} placeholder="Default owner or sales manager" /></Field>
        <Toggle value={f.active} onChange={(v) => set('active', v)} label="Rule is on" />
      </div>
    </Modal>
  );
}

function Rules({ s, reload, canEdit }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const name = (id) => s.staff.find((u) => u.id === id)?.name || `User ${id}`;
  return (
    <Card title="Routing rules" actions={canEdit && <button className="btn primary sm" onClick={() => setEdit('new')}>New rule</button>}>
      <p className="muted" style={{ marginTop: 0 }}>With no rules, new website leads are shared round robin among sales agents, as before. Rules apply only to leads that arrive after they are saved.</p>
      {s.rules.length === 0 ? <Empty title="No routing rules" hint="Add one to share leads by source, city or team." /> : s.rules.map((r) => (
        <div key={r.id} className="row between wrap" style={{ borderTop: '1px solid var(--line, #e5e7eb)', padding: '10px 0' }}>
          <div><strong>{r.name}</strong> <StatusBadge tone={r.active ? 'green' : 'grey'} label={r.active ? 'On' : 'Off'} />
            <div className="muted" style={{ fontSize: 12.5 }}>{MODES.find((m) => m.value === r.mode)?.label} · order {r.priority}{r.agent_ids.length ? ` · ${r.agent_ids.map((a) => name(a.id)).join(', ')}` : ''}</div></div>
          {canEdit && <span className="row"><button className="btn sm" onClick={() => setEdit(r)}>Edit</button>
            <button className="btn sm ghost" onClick={async () => { try { await api.del(`/api/leadflow/rules/${r.id}`); reload(); } catch (e) { toast(e.message, 'err'); } }}>Delete</button></span>}
        </div>))}
      {edit && <RuleEditor rule={edit === 'new' ? null : edit} staff={s.staff} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function Agents({ s, reload, canEdit }) {
  const toast = useToast();
  const save = async (u, patch) => { try { await api.put(`/api/leadflow/agents/${u.id}`, patch); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Agent availability and limits">
      <p className="muted" style={{ marginTop: 0 }}>An agent who is away, or at their open-lead limit, gets no new leads from a rule. Existing leads stay with them.</p>
      {s.staff.map((u) => (
        <div key={u.id} className="row between wrap" style={{ borderTop: '1px solid var(--line, #e5e7eb)', padding: '10px 0', gap: 10 }}>
          <div style={{ minWidth: 160 }}><strong>{u.name}</strong><div className="muted" style={{ fontSize: 12 }}>{u.role}</div></div>
          <Toggle value={u.profile.available} onChange={(v) => save(u, { available: v })} label="Available" />
          {canEdit && <>
            <input className="input" style={{ width: 120 }} placeholder="Team" defaultValue={u.profile.team || ''} onBlur={(e) => e.target.value !== (u.profile.team || '') && save(u, { team: e.target.value })} aria-label={`Team for ${u.name}`} />
            <input className="input" style={{ width: 130 }} placeholder="Cities (a, b)" defaultValue={(u.profile.cities || []).join(', ')} onBlur={(e) => save(u, { cities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} aria-label={`Cities for ${u.name}`} />
            <input className="input" style={{ width: 110 }} type="number" min="1" placeholder="Open limit" defaultValue={u.profile.max_open ?? ''} onBlur={(e) => save(u, { max_open: e.target.value === '' ? null : Number(e.target.value) })} aria-label={`Open lead limit for ${u.name}`} />
          </>}
        </div>))}
    </Card>
  );
}

function Duplicates() {
  const toast = useToast();
  const { data, reload } = useFetch('/api/leadflow/duplicates');
  const { data: queue } = useFetch('/api/leadflow/queue');
  const decide = async (id, what, body) => { try { await api.post(`/api/leadflow/duplicates/${id}/${what}`, body || {}); toast('Done', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Possible duplicates">
        <p className="muted" style={{ marginTop: 0 }}>These contacts share a phone number or email but have different names, so they were kept apart. Merging moves all history to the contact you keep; it is never done automatically.</p>
        {!data ? <Loading rows={2} /> : data.length === 0 ? <Empty title="Nothing to review" /> : data.map((d) => (
          <div key={d.id} style={{ borderTop: '1px solid var(--line, #e5e7eb)', padding: '10px 0' }}>
            <div className="row wrap" style={{ gap: 16 }}>
              {[['a', d.contact_id], ['b', d.candidate_id]].map(([k, id]) => (
                <div key={k}><Link to={`/contacts/${id}`}><strong>{d[`${k}_name`]}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{d[`${k}_phone`] || ''} {d[`${k}_email`] || ''}</div>
                  <button className="btn sm" style={{ marginTop: 4 }} onClick={() => window.confirm(`Keep ${d[`${k}_name`]} and merge the other contact into it?`) && decide(d.id, 'merge', { keep_id: id })}>Keep this one and merge</button></div>))}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{d.reason} · {dateTimeUtc(d.created_at)}</div>
            <button className="btn sm ghost" onClick={() => decide(d.id, 'dismiss')}>These are different people</button>
          </div>))}
      </Card>
      <Card title="Waiting for an owner">
        {!queue ? <Loading rows={2} /> : queue.length === 0 ? <Empty title="No leads are waiting" /> : queue.map((q) => (
          <div key={q.id} className="row between" style={{ borderTop: '1px solid var(--line, #e5e7eb)', padding: '8px 0' }}>
            <div><Link to={`/contacts/${q.id}`}><strong>{q.full_name}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{q.reason}</div></div>
            <span className="muted" style={{ fontSize: 12 }}>{dateTimeUtc(q.assigned_at)}</span>
          </div>))}
        {queue?.length ? <p className="muted" style={{ marginBottom: 0 }}>Open the lead and choose its owner to assign it.</p> : null}
      </Card>
    </div>
  );
}

export default function LeadRouting() {
  const { can } = useAuth();
  const { data, reload, error } = useFetch('/api/leadflow/settings');
  const [tab, setTab] = useState('targets');
  const canEdit = can('settings', 'edit');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  return (
    <div>
      <PageHead title="Lead routing" sub="Who gets new leads, how fast they must respond, and what happens when they do not." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'targets', label: 'Response targets' }, { key: 'rules', label: 'Routing rules', count: data.rules.length }, { key: 'agents', label: 'Agents' }, { key: 'review', label: 'Duplicates and queue' }]} />
      <div style={{ marginTop: 14 }}>
        {tab === 'targets' && <Targets s={data} reload={reload} canEdit={canEdit} />}
        {tab === 'rules' && <Rules s={data} reload={reload} canEdit={canEdit} />}
        {tab === 'agents' && <Agents s={data} reload={reload} canEdit={canEdit} />}
        {tab === 'review' && <Duplicates />}
      </div>
    </div>
  );
}
