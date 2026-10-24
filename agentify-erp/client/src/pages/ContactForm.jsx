import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CurrencyInput, Drawer, Field, Select, TagInput } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useLookups, useToast } from '../context.jsx';
import { getRegion } from '../format.js';
import { checkField } from '../validate.js';

const GENDERS = ['Male', 'Female', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const PK_PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Kashmir'];
/** States, provinces or emirates of the workspace's country. */
const provinces = () => (getRegion().config.region === 'PK' ? PK_PROVINCES : getRegion().config.sub_regions || []);

export function CustomFieldInput({ f, value, onChange }) {
  if (f.type === 'select') return <Select value={value} onChange={onChange} options={f.options || []} />;
  if (f.type === 'checkbox') return <Check checked={value} onChange={onChange}>Yes</Check>;
  if (f.type === 'textarea') return <textarea className="textarea" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  return <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

function Section({ title, children }) {
  return <div><div className="section-title" style={{ marginTop: 4 }}>{title}</div><div className="form-grid">{children}</div></div>;
}

/** Add / edit contact drawer. `initial` carries an existing contact when editing. */
export default function ContactForm({ initial, onClose, onSaved }) {
  const { agents, managers, projects, stages, list, customFields } = useLookups();
  const { user } = useAuth();
  const toast = useToast();
  const editing = !!initial?.id;
  const [f, setF] = useState(() => ({
    country: getRegion().config.name || 'Pakistan', priority: 'Medium', ...initial,
    tags: initial?.tags || [], custom: initial?.custom || {},
    stage_id: initial?.stage_id ?? stages[0]?.id ?? '',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState(null);
  const [props, setProps] = useState([]);
  const set = (k, v) => { setErr(''); setF((x) => ({ ...x, [k]: v })); };
  const cfs = customFields.filter((c) => c.entity === 'contact');

  useEffect(() => {
    api.get('/api/properties', { limit: 300, project_id: f.project_id || undefined }).then((r) => setProps(r.rows)).catch(() => {});
  }, [f.project_id]);

  const checkDup = async () => {
    if (editing || (!f.phone && !f.email && !f.cnic && !f.alt_phone && !f.whatsapp)) return setDup(null);
    try { const r = await api.get('/api/contacts/duplicates', { phone: f.phone, email: f.email, cnic: f.cnic, alt_phone: f.alt_phone, whatsapp: f.whatsapp }); setDup(r[0] || null); } catch { /* ignore */ }
  };
  const save = async (force) => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, budget: f.budget === '' ? null : f.budget, force };
      const saved = editing ? await api.put(`/api/contacts/${initial.id}`, body) : await api.post('/api/contacts', body);
      toast(editing ? 'Contact updated' : 'Contact created', 'ok');
      onSaved(saved);
    } catch (e) { setErr(e.message); if (e.data?.duplicate_id) setDup((d) => (d?.id === e.data.duplicate_id ? d : { id: e.data.duplicate_id, full_name: 'existing contact', mine: true })); else if (e.data?.duplicate_hidden) setDup({ id: null, mine: false }); } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (!(f.full_name || f.first_name)) return setErr('Please enter a name');
    for (const [k, label] of [['first_name', 'First name'], ['last_name', 'Last name'], ['full_name', 'Full name'], ['email', 'Email']]) {
      const m = checkField(k, f[k]);
      if (m) return setErr(`${label}: ${m}`);
    }
    if (!editing && !f.phone && !f.alt_phone && !f.whatsapp && !f.email) return setErr('Add a phone number, WhatsApp number or email so the lead can be contacted');
    save(false);
  };

  return (
    <Drawer title={editing ? 'Edit contact' : 'Add contact'} size="lg" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create contact'}</button></>}>
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert err">{err}</div>}
        {dup && !editing && (dup.id ? <div className="alert warn">A contact with this phone/email/CNIC already exists — <Link to={`/contacts/${dup.id}`} target="_blank">view {dup.full_name}</Link>. Saving will be blocked unless you change it.</div> : <div className="alert warn">This phone / email / CNIC is already registered with another agent, so it can’t be added again. Ask your sales manager.</div>)}
        <Section title="Personal information">
          <Field label="First name" required><input className="input" value={f.first_name ?? ''} onChange={(e) => setF((x) => ({ ...x, first_name: e.target.value, full_name: `${e.target.value} ${x.last_name || ''}`.trim() }))} autoFocus /></Field>
          <Field label="Last name"><input className="input" value={f.last_name ?? ''} onChange={(e) => setF((x) => ({ ...x, last_name: e.target.value, full_name: `${x.first_name || ''} ${e.target.value}`.trim() }))} /></Field>
          <Field label="Full name" className="full"><input className="input" value={f.full_name ?? ''} onChange={(e) => set('full_name', e.target.value)} /></Field>
          {getRegion().config.region === 'PK' && <Field label="Father / husband name"><input className="input" value={f.father_name ?? ''} onChange={(e) => set('father_name', e.target.value)} /></Field>}
          {getRegion().config.region === 'PK' && <Field label="CNIC" hint="Format 12345-1234567-1"><input className="input" value={f.cnic ?? ''} onChange={(e) => set('cnic', e.target.value)} onBlur={checkDup} placeholder="35202-1234567-1" /></Field>}
          <Field label="Date of birth"><input className="input" type="date" value={f.dob ?? ''} onChange={(e) => set('dob', e.target.value)} /></Field>
          <Field label="Gender"><Select value={f.gender} onChange={(v) => set('gender', v)} options={GENDERS} /></Field>
          <Field label="Phone"><input className="input" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} onBlur={checkDup} placeholder={getRegion().config.phone?.example || '+92 3xx xxxxxxx'} /></Field>
          <Field label="Alternate phone"><input className="input" value={f.alt_phone ?? ''} onChange={(e) => set('alt_phone', e.target.value)} onBlur={checkDup} /></Field>
          <Field label="WhatsApp"><input className="input" value={f.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} onBlur={checkDup} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} onBlur={checkDup} /></Field>
          <Field label="Company / business"><input className="input" value={f.company ?? ''} onChange={(e) => set('company', e.target.value)} /></Field>
        </Section>
        <Section title="Address">
          <Field label="Country"><input className="input" value={f.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
          <Field label={getRegion().config.region === 'PK' ? 'Province' : (getRegion().config.sub_region_label || 'State')}><Select value={f.province} onChange={(v) => set('province', v)} options={provinces()} /></Field>
          <Field label="City"><input className="input" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="Area"><input className="input" value={f.area ?? ''} onChange={(e) => set('area', e.target.value)} /></Field>
          <Field label="Complete address" className="full"><textarea className="textarea" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        </Section>
        <Section title="CRM information">
          <Field label="Lead source"><Select value={f.lead_source} onChange={(v) => set('lead_source', v)} options={list('lead_source')} /></Field>
          <Field label="Lead stage"><Select allowEmpty={false} value={f.stage_id} onChange={(v) => set('stage_id', Number(v))} options={stages.map((s) => ({ value: s.id, label: s.value }))} /></Field>
          <Field label="Lead type"><Select value={f.lead_type} onChange={(v) => set('lead_type', v)} options={list('lead_type')} /></Field>
          <Field label="Priority"><Select allowEmpty={false} value={f.priority} onChange={(v) => set('priority', v)} options={PRIORITIES} /></Field>
          {!user.own_scope && <Field label="Assigned sales agent"><Select value={f.agent_id} onChange={(v) => set('agent_id', v ? Number(v) : null)} options={agents.map((a) => ({ value: a.id, label: a.name }))} /></Field>}
          {!user.own_scope && <Field label="Sales manager"><Select value={f.manager_id} onChange={(v) => set('manager_id', v ? Number(v) : null)} options={managers.map((a) => ({ value: a.id, label: a.name }))} /></Field>}
          <Field label="Interested project"><Select value={f.project_id} onChange={(v) => setF((x) => ({ ...x, project_id: v ? Number(v) : null, property_id: null }))} options={projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Interested property"><Select value={f.property_id} onChange={(v) => set('property_id', v ? Number(v) : null)} options={props.map((p) => ({ value: p.id, label: p.title }))} /></Field>
          <Field label="Expected budget"><CurrencyInput value={f.budget ?? ''} onChange={(v) => set('budget', v)} /></Field>
          <Field label="Preferred location"><input className="input" value={f.pref_location ?? ''} onChange={(e) => set('pref_location', e.target.value)} /></Field>
          <Field label="Property type"><Select value={f.property_type} onChange={(v) => set('property_type', v)} options={list('property_type')} /></Field>
          <Field label="Follow-up date"><input className="input" type="date" value={f.followup_date ?? ''} onChange={(e) => set('followup_date', e.target.value)} /></Field>
          <Field label="Tags" className="full"><TagInput value={f.tags} onChange={(v) => set('tags', v)} /></Field>
        </Section>
        {cfs.length > 0 && (
          <Section title="Additional fields">
            {cfs.map((c) => (
              <Field key={c.key} label={c.label} required={!!c.required}><CustomFieldInput f={c} value={f.custom[c.key]} onChange={(v) => setF((x) => ({ ...x, custom: { ...x.custom, [c.key]: v } }))} /></Field>
            ))}
          </Section>
        )}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
