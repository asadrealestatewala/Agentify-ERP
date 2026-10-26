// CRM > Follow-up sequences: build from a template, edit the steps, preview what a lead would receive and when, send a test to
// yourself, and activate. Saving a change that touches the steps creates a new version; people already in it finish the old one.
import { useState } from 'react';
import { Card, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTimeUtc, titleCase } from '../format.js';

const TRIGGERS = [{ value: 'manual', label: 'Started by hand' }, { value: 'new_inquiry', label: 'A new website enquiry arrives' }, { value: 'viewing_booked', label: 'A viewing is booked' }, { value: 'viewing_completed', label: 'A viewing is completed' }];
const CONDITIONS = [{ value: 'always', label: 'Always' }, { value: 'no_reply', label: 'Only if the customer has not replied' }, { value: 'no_human_response', label: 'Only if nobody has responded personally' }, { value: 'stage_open', label: 'Only while the lead is open' }];
const LANGS = { en: 'English', fr: 'French', ar: 'Arabic' };
const TONE = { active: 'green', paused: 'amber', draft: 'grey' };
const blankEmail = () => ({ type: 'email', delay_minutes: 1440, category: 'operational', subject: '', body: '', condition: 'no_reply' });
const blankTask = () => ({ type: 'task', delay_minutes: 1440, title: '', due_in_days: 0, condition: 'no_human_response' });
const waitText = (m) => (m === 0 ? 'right away' : m % 1440 === 0 ? `${m / 1440} day(s) later` : m % 60 === 0 ? `${m / 60} hour(s) later` : `${m} minutes later`);

function Editor({ seq, senders, replyDetection, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(seq ? { name: seq.name, trigger: seq.trigger, sender_id: seq.sender_id || '', config: seq.config } : null);
  const [lang, setLang] = useState('en');
  const [preview, setPreview] = useState(null);
  const { data: templates } = useFetch('/api/leadflow/sequences/templates', { lang }, [lang]);
  const cfg = f?.config;
  const setCfg = (patch) => setF((x) => ({ ...x, config: { ...x.config, ...patch } }));
  const setStep = (i, patch) => setCfg({ steps: cfg.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => { const a = [...cfg.steps]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setCfg({ steps: a }); };
  const save = async () => {
    try {
      const body = { name: f.name, trigger: f.trigger, sender_id: f.sender_id || null, config: f.config };
      const out = seq ? await api.put(`/api/leadflow/sequences/${seq.id}`, body) : await api.post('/api/leadflow/sequences', body);
      toast(`Saved (version ${out.current_version})`, 'ok'); onSaved(out);
    } catch (e) { toast(e.message, 'err'); }
  };
  const showPreview = async () => { try { setPreview(await api.post('/api/leadflow/sequences/preview', { config: f.config })); } catch (e) { toast(e.message, 'err'); } };
  const test = async (i) => { try { await api.post(`/api/leadflow/sequences/${seq.id}/test`, { step: i }); toast('Test email queued to your own address (it counts toward your allowance)', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  if (!f) {
    return (
      <Modal title="New follow-up sequence" onClose={onClose}>
        <Field label="Template language"><Select allowEmpty={false} value={lang} onChange={setLang} options={Object.entries(LANGS).map(([value, label]) => ({ value, label }))} /></Field>
        {lang !== 'en' && <div className="alert warn">The {LANGS[lang]} wording was prepared automatically. Have a native speaker review it before real customers receive it.</div>}
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {!templates ? <Loading rows={2} /> : templates.map((t) => (
            <button key={t.id} className="btn" style={{ textAlign: 'start' }} onClick={() => setF({ name: t.name, trigger: t.trigger, sender_id: '', config: t.config })}><strong>{t.name}</strong><div className="muted" style={{ fontSize: 12 }}>{t.config.steps.length} steps · {TRIGGERS.find((x) => x.value === t.trigger.type)?.label}</div></button>))}
          <button className="btn ghost" onClick={() => setF({ name: '', trigger: { type: 'manual' }, sender_id: '', config: { steps: [blankEmail()], window: { start: '09:00', end: '18:00', working_days_only: true }, frequency: { max_per_week: 3, min_gap_hours: 24 }, stop_on: { reply: true, appointment_booked: true, lead_closed: true } } })}>Start from a blank sequence</button>
        </div>
      </Modal>);
  }
  return (
    <Modal size="lg" title={seq ? `Edit ${seq.name}` : 'New follow-up sequence'} onClose={onClose} footer={<><button className="btn" onClick={showPreview}>Preview timing</button><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Name" required><input className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Starts when"><Select allowEmpty={false} value={f.trigger.type} onChange={(v) => setF({ ...f, trigger: { type: v } })} options={TRIGGERS} /></Field>
        <Field label="Send from" hint="Only verified sender addresses can be chosen. Set them up in Settings > Email."><Select value={f.sender_id} onChange={(v) => setF({ ...f, sender_id: v })} options={senders.filter((s) => s.can_send).map((s) => ({ value: s.id, label: `${s.display_name || s.local_part} <${s.address}>` }))} placeholder="Default sender" /></Field>
        <div>
          <strong>Steps</strong>
          {cfg.steps.map((s, i) => (
            <div key={i} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, padding: 12, marginTop: 8 }}>
              <div className="row between"><strong>{i + 1}. {s.type === 'email' ? 'Send an email' : 'Create a task for the owner'}</strong>
                <span className="row"><button className="btn sm ghost" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn sm ghost" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn sm ghost" onClick={() => setCfg({ steps: cfg.steps.filter((_, j) => j !== i) })}>Remove</button>
                  {seq && s.type === 'email' && <button className="btn sm" onClick={() => test(i)}>Send me a test</button>}</span></div>
              <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
                <Field label={i === 0 ? 'Wait after it starts (minutes)' : 'Wait after the previous step (minutes)'} hint={waitText(s.delay_minutes || 0)}><input className="input" style={{ width: 150 }} type="number" min="0" value={s.delay_minutes} onChange={(e) => setStep(i, { delay_minutes: Number(e.target.value) })} /></Field>
                <Field label="Do this step"><Select allowEmpty={false} value={s.condition} onChange={(v) => setStep(i, { condition: v })} options={CONDITIONS} /></Field>
                {s.type === 'email' && <Field label="Kind of email" hint={s.category === 'marketing' ? 'Needs recorded marketing consent' : 'A reply to an enquiry or visit'}><Select allowEmpty={false} value={s.category} onChange={(v) => setStep(i, { category: v })} options={[{ value: 'operational', label: 'Operational' }, { value: 'marketing', label: 'Marketing' }]} /></Field>}
              </div>
              {s.type === 'email' ? <>
                <Field label="Subject"><input className="input" maxLength={200} value={s.subject} onChange={(e) => setStep(i, { subject: e.target.value })} /></Field>
                <Field label="Message" hint="You can use {{first_name}} {{full_name}} {{agent_name}} {{company}} {{property}} {{project}}"><textarea className="input" rows={6} maxLength={5000} value={s.body} onChange={(e) => setStep(i, { body: e.target.value })} /></Field>
              </> : <div className="row wrap" style={{ gap: 12 }}>
                <Field label="Task title"><input className="input" maxLength={160} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} /></Field>
                <Field label="Due after (days)"><input className="input" style={{ width: 90 }} type="number" min="0" max="90" value={s.due_in_days} onChange={(e) => setStep(i, { due_in_days: Number(e.target.value) })} /></Field>
              </div>}
            </div>))}
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setCfg({ steps: [...cfg.steps, blankEmail()] })}>Add email</button><button className="btn sm" onClick={() => setCfg({ steps: [...cfg.steps, blankTask()] })}>Add task</button></div>
        </div>
        <Card title="Sending rules">
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label="Earliest time"><input className="input" type="time" value={cfg.window.start} onChange={(e) => setCfg({ window: { ...cfg.window, start: e.target.value } })} /></Field>
            <Field label="Latest time"><input className="input" type="time" value={cfg.window.end} onChange={(e) => setCfg({ window: { ...cfg.window, end: e.target.value } })} /></Field>
            <Field label="Emails per week (at most)"><input className="input" style={{ width: 90 }} type="number" min="1" max="14" value={cfg.frequency.max_per_week} onChange={(e) => setCfg({ frequency: { ...cfg.frequency, max_per_week: Number(e.target.value) } })} /></Field>
            <Field label="Hours between emails (at least)"><input className="input" style={{ width: 90 }} type="number" min="0" max="168" value={cfg.frequency.min_gap_hours} onChange={(e) => setCfg({ frequency: { ...cfg.frequency, min_gap_hours: Number(e.target.value) } })} /></Field>
          </div>
          <Toggle value={cfg.window.working_days_only} onChange={(v) => setCfg({ window: { ...cfg.window, working_days_only: v } })} label="Working days only (uses your working calendar and holidays; times are in your workspace timezone)" />
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            <Toggle value={cfg.stop_on.reply} onChange={(v) => setCfg({ stop_on: { ...cfg.stop_on, reply: v } })} label="Stop when the customer replies" />
            <Toggle value={cfg.stop_on.appointment_booked} onChange={(v) => setCfg({ stop_on: { ...cfg.stop_on, appointment_booked: v } })} label="Stop when an appointment is booked" />
            <Toggle value={cfg.stop_on.lead_closed} onChange={(v) => setCfg({ stop_on: { ...cfg.stop_on, lead_closed: v } })} label="Stop when the lead is won or lost" />
          </div>
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>It also stops when the customer opts out, and waits (then resumes by itself) if there is no verified sender or no allowance left. {replyDetection.configured ? 'Replies to these emails are detected automatically.' : 'Automatic reply detection is not set up on this server: use Pause, or Customer replied on the contact.'} Opens and clicks are not tracked.</p>
        </Card>
        {preview && (
          <Card title={`What a lead would receive (${preview.timezone})`}>
            {preview.steps.map((s) => (
              <div key={s.index} style={{ borderTop: '1px solid var(--line, #e5e7eb)', padding: '8px 0' }}>
                <strong>{s.index + 1}. {s.type === 'email' ? s.subject : s.title}</strong> <span className="muted">{dateTimeUtc(s.at)} (from the moment it starts)</span>
                {s.type === 'email' && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0' }} dir="auto">{s.body}</pre>}
              </div>))}
            <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>Sample details are used for the names. Nothing was sent.</p>
          </Card>)}
      </div>
    </Modal>
  );
}

export default function Sequences() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload, error } = useFetch('/api/leadflow/sequences');
  const { data: settings } = useFetch('/api/leadflow/settings');
  const [edit, setEdit] = useState(null);
  const canEdit = can('settings', 'edit');
  if (error) return <div className="alert err">{error}</div>;
  if (!data || !settings) return <Loading />;
  const setStatus = async (s, status) => { try { await api.post(`/api/leadflow/sequences/${s.id}/status`, { status }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const openEdit = async (s) => { try { setEdit(await api.get(`/api/leadflow/sequences/${s.id}`)); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="Follow-up sequences" sub="Emails and tasks that run on a schedule and stop by themselves when the customer replies, books, opts out or the lead closes.">
        {canEdit && <button className="btn primary" onClick={() => setEdit('new')}>New sequence</button>}
      </PageHead>
      {!data.reply_detection.configured && <div className="alert warn">Automatic reply detection is not set up on this server yet. Sequences still stop for bookings, opt-outs and closed leads; for replies, staff pause the sequence or press Customer replied on the contact.</div>}
      {data.sequences.length === 0 ? <Empty title="No sequences yet" hint="Start from a template for new enquiries, viewing follow-up or long-term nurture." action={canEdit ? { label: 'New sequence', onClick: () => setEdit('new') } : undefined} /> : data.sequences.map((s) => (
        <Card key={s.id} title={<>{s.name} <StatusBadge tone={TONE[s.status]} label={titleCase(s.status)} /></>} actions={canEdit && <span className="row">
          <button className="btn sm" onClick={() => openEdit(s)}>Edit</button>
          {s.status === 'active' ? <button className="btn sm" onClick={() => setStatus(s, 'paused')}>Pause</button> : <button className="btn sm primary" onClick={() => setStatus(s, 'active')}>Activate</button>}
        </span>}>
          <div className="muted">{TRIGGERS.find((t) => t.value === s.trigger.type)?.label} · {s.config?.steps.length} steps · version {s.current_version}</div>
          <div style={{ marginTop: 6 }}>{s.enrolled} in progress · {s.completed} finished · {s.stopped} stopped</div>
        </Card>))}
      {edit && <Editor seq={edit === 'new' ? null : edit} senders={settings.senders} replyDetection={data.reply_detection} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
