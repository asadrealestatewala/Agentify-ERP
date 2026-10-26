// Property visits: schedule, list, and the phone-friendly check-in / check-out sheet. Used on Appointments, the contact
// workspace and the property page. Rules (time zones, distance, reading classes) come from shared/visits.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Modal, StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime, getRegion } from '../format.js';
import { t, getLanguage } from '../i18n.js';
import { OUTCOMES, msToWall, haversineM, validCoord, proximity, formatDistance } from '../../../shared/visits.js';

export const KINDS = [['viewing', 'Viewing'], ['site_visit', 'Site visit'], ['meeting', 'Meeting'], ['call', 'Call'], ['signing', 'Signing'], ['other', 'Other']];
const STATE = {
  scheduled: ['blue', 'visits.state.scheduled', 'Scheduled'], in_progress: ['amber', 'visits.state.in_progress', 'In progress'], completed: ['green', 'visits.state.completed', 'Completed'],
  canceled: ['grey', 'visits.state.canceled', 'Canceled'], no_show: ['red', 'visits.state.no_show', 'No-show'],
};
const OUTCOME_LABEL = { interested: 'Interested', not_interested: 'Not interested', offer_expected: 'Offer expected', second_visit: 'Wants a second visit', needs_info: 'Needs more information', other: 'Other' };
const LOC = {
  verified: ['visits.loc.verified', 'Location captured'], stale: ['visits.loc.stale', 'Reading arrived late (not verified)'], denied: ['visits.loc.denied', 'Location permission denied'],
  unavailable: ['visits.loc.unavailable', 'Location unavailable'], manual: ['visits.loc.manual', 'Manual exception (no location)'], captured: ['visits.loc.captured', 'Location ready'],
};
const PROX = {
  near: ['visits.prox.near', 'Within {r} of the saved property location'], near_uncertain: ['visits.prox.near_uncertain', 'Probably within {r} (reading not precise)'],
  uncertain: ['visits.prox.uncertain', 'Unclear: the reading’s accuracy overlaps the {r} radius'], far: ['visits.prox.far', 'More than {r} from the saved property location'],
  unknown: ['visits.prox.unknown', 'No distance (no verified reading or no saved property location)'],
};
const DEFAULT_NOTICE = 'When you check in or out, the app asks this device for its location once. It is saved with this visit only (time, position and accuracy) and is not tracked in the background. You can refuse and still check in; the visit then shows that no location was shared.';

const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };
const dist = (m) => formatDistance(m, { unit: getRegion().config?.distance_unit || 'km', locale: getRegion().config?.locale || getLanguage() });
const newKey = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const tzName = (tz) => String(tz || '').split('/').pop().replace(/_/g, ' ');
/** A UTC stamp shown in the visit's own zone. */
const inZone = (iso, tz) => (iso ? dateTime(msToWall(Date.parse(iso), tz)) : '—');

export function VisitState({ status }) { const [tone, k, d] = STATE[status] || STATE.scheduled; return <StatusBadge tone={tone} label={t(k, d)} />; }

/** The visit's time in its own zone, labelled; the viewer's own time underneath when their device is elsewhere. */
export function VisitTime({ a }) {
  const mine = deviceTz();
  const other = mine && a.tz && mine !== a.tz && a.starts_utc ? dateTime(msToWall(Date.parse(a.starts_utc), mine)) : null;
  return (
    <span className="nowrap">{dateTime(a.starts_at)} <span className="muted" title={a.tz}>{a.tz_label} · {tzName(a.tz)}</span>
      {other && <div className="muted" style={{ fontSize: 12 }}>{t('visits.your_time', 'Your time')}: {other}</div>}</span>
  );
}

function readLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ status: 'unavailable' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: 'captured', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, captured_at: new Date(p.timestamp || Date.now()).toISOString() }),
      (e) => resolve({ status: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// ---------------------------------------------------------------- schedule / edit
export function VisitForm({ initial = {}, fixed = {}, onClose, onSaved }) {
  const toast = useToast();
  const { user } = useAuth();
  const cfg = getRegion().config || {};
  const zones = [...new Set([cfg.timezone, ...(cfg.timezones || []), deviceTz(), initial.timezone].filter(Boolean))];
  const [f, setF] = useState(() => ({
    title: '', kind: 'viewing', starts_at: '', ends_at: '', location: '', notes: '', contact_id: '', property_id: '', agent_id: user?.id || '', timezone: initial.tz || cfg.timezone,
    ...initial, ...fixed,
    ...(initial.starts_at ? { starts_at: initial.starts_at.slice(0, 16).replace(' ', 'T'), ends_at: (initial.ends_at || '').slice(0, 16).replace(' ', 'T') } : {}),
    agent_id: initial.user_id || initial.agent_id || user?.id || '',
  }));
  const [opts, setOpts] = useState({ contacts: [], properties: [], agents: [] });
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey()); // the same key for every retry of this one booking
  useEffect(() => {
    const list = (r) => (Array.isArray(r) ? r : r?.items || r?.rows || []);
    Promise.all([
      fixed.contact_id ? [] : api.get('/api/contacts').then(list).catch(() => []),
      fixed.property_id ? [] : api.get('/api/properties?limit=200').then(list).catch(() => []),
      api.get('/api/appointments/agents').catch(() => []),
    ]).then(([contacts, properties, agents]) => setOpts({ contacts, properties, agents }));
  }, [fixed.contact_id, fixed.property_id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, contact_id: f.contact_id || null, property_id: f.property_id || null, agent_id: f.agent_id || undefined, ends_at: f.ends_at || undefined, timezone: f.timezone === cfg.timezone ? null : f.timezone };
      const r = f.id ? await api.put(`/api/appointments/${f.id}`, body) : await api.post('/api/appointments', { ...body, client_key: key.current });
      toast(t('common.saved', 'Saved')); onSaved?.(r);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.id ? t('visits.edit', 'Edit visit') : t('visits.schedule', 'Schedule a visit')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.close', 'Close')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Save')}</button></>}>
      <Field label={t('visits.title', 'Title')} required><input className="input" value={f.title} onChange={set('title')} placeholder="Viewing at 12 Maple Street" /></Field>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label={t('visits.kind', 'Kind')}><select className="input" value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {!fixed.property_id && <Field label={t('visits.property', 'Property')}><select className="input" value={f.property_id || ''} onChange={set('property_id')}><option value="">{t('visits.none', 'None')}</option>{opts.properties.map((p) => <option key={p.id} value={p.id}>{p.title}{p.code ? ` (${p.code})` : ''}</option>)}</select></Field>}
        {!fixed.contact_id && <Field label={t('visits.with', 'With')}><select className="input" value={f.contact_id || ''} onChange={set('contact_id')}><option value="">{t('visits.nobody', 'Nobody in particular')}</option>{opts.contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></Field>}
        {opts.agents.length > 1 && <Field label={t('visits.agent', 'Agent')}><select className="input" value={f.agent_id || ''} onChange={set('agent_id')}>{opts.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
        <Field label={t('visits.starts', 'Starts')} required><input className="input" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></Field>
        <Field label={t('visits.ends', 'Ends (default one hour)')}><input className="input" type="datetime-local" value={f.ends_at || ''} onChange={set('ends_at')} /></Field>
        <Field label={t('visits.timezone', 'Time zone of the visit')} hint={t('visits.timezone_hint', 'The time above is in this zone. Pick the property’s zone when it differs from the office.')}>
          <select className="input" value={f.timezone} onChange={set('timezone')}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></Field>
      </div>
      <Field label={t('visits.where', 'Where')}><input className="input" value={f.location || ''} onChange={set('location')} /></Field>
      <Field label={t('visits.notes', 'Notes')}><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- the visit sheet (check-in / check-out)
function CheckLine({ c, a }) {
  const r = dist(c.radius_m);
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="row between wrap"><b>{c.kind === 'check_in' ? t('visits.checked_in', 'Checked in') : t('visits.checked_out', 'Checked out')}</b><span className="muted">{inZone(c.server_at, a.tz)} {a.tz_label}</span></div>
      <div>{t(...LOC[c.location_status])}{c.accuracy_m != null && ` · ±${dist(c.accuracy_m)}`}{c.distance_m != null && ` · ${dist(c.distance_m)}`}</div>
      {c.location_status === 'verified' && <div className="muted">{t(PROX[c.proximity]?.[0] || PROX.unknown[0], PROX[c.proximity]?.[1] || PROX.unknown[1], { r })}</div>}
      {c.manual_reason && <div className="muted">{t('visits.reason', 'Reason')}: {c.manual_reason}</div>}
      {c.captured_at && c.location_status !== 'verified' && <div className="muted">{t('visits.captured_at', 'Reading taken')}: {inZone(c.captured_at, a.tz)}</div>}
    </div>
  );
}

export function VisitSheet({ id, onClose, onChange }) {
  const toast = useToast();
  const { user, can } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState(null); // null | 'notice' | 'review'
  const [action, setAction] = useState(null); // 'check-in' | 'check-out'
  const [reading, setReading] = useState(null);
  const [manual, setManual] = useState('');
  const [out, setOut] = useState({ outcome: '', outcome_notes: '', followup_title: '', followup_due: '' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = useRef(null);
  const load = useCallback(() => api.get(`/api/appointments/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Modal title={t('visits.visit', 'Visit')} onClose={onClose}>{err ? <ErrorBox error={err} /> : <Loading rows={3} />}</Modal>;

  const mine = d.user_id === user?.id;
  const noticeKey = `erp-visit-notice-${user?.id}`;
  const start = (which) => {
    setAction(which); setReading(null); setManual(''); setFailed(false); key.current = newKey();
    let seen = false; try { seen = localStorage.getItem(noticeKey) === '1'; } catch { /* storage blocked: show the notice again */ }
    if (seen) capture(); else setStep('notice');
  };
  const capture = async () => { setStep('review'); setReading({ status: 'pending' }); setReading(await readLocation()); };
  const ack = () => { try { localStorage.setItem(noticeKey, '1'); } catch { /* fine */ } capture(); };
  const preview = reading?.status === 'captured' && d.has_property_location
    ? (() => { const m = haversineM({ lat: reading.lat, lng: reading.lng }, { lat: Number(d.property_lat), lng: Number(d.property_lng) }); return { m, p: proximity(m, reading.accuracy, d.settings.proximity_m) }; })() : null;
  const send = async (useManual = false) => {
    setBusy(true); setFailed(false);
    const location = useManual ? { status: 'manual', reason: manual } : reading;
    const body = { location, client_key: key.current };
    if (action === 'check-out') Object.assign(body, { outcome: out.outcome, outcome_notes: out.outcome_notes, followup: out.followup_title ? { title: out.followup_title, due_date: out.followup_due || null } : null });
    try {
      await api.post(`/api/appointments/${id}/${action}`, body);
      toast(action === 'check-in' ? t('visits.checked_in', 'Checked in') : t('visits.visit_completed', 'Visit completed'));
      setStep(null); setAction(null); await load(); onChange?.();
    } catch (e) {
      // offline or a dropped connection: keep the reading, its time and the key so "Try again" cannot record twice
      if (e.status === 0) setFailed(true); else toast(e.message, 'err');
    } finally { setBusy(false); }
  };
  const close = async (what) => {
    const note = window.prompt(what === 'cancel' ? t('visits.cancel_note', 'Cancel this visit? Add a note (optional)') : t('visits.no_show_note', 'Mark as no-show? Add a note (optional)'));
    if (note === null) return;
    try { await api.post(`/api/appointments/${id}/${what}`, { note }); await load(); onChange?.(); } catch (e) { toast(e.message, 'err'); }
  };
  const manage = mine || (!user?.own_scope && can('crm', 'edit'));

  return (
    <Modal title={d.title} onClose={onClose}>
      <div className="stack">
        <div className="row between wrap"><VisitState status={d.status} /><VisitTime a={d} /></div>
        <div className="muted">
          {d.property_id ? <Link to={`/properties/${d.property_id}`}>{d.property_title}</Link> : t('visits.no_property', 'No property')}
          {d.contact_id && <> · <Link to={`/contacts/${d.contact_id}`}>{d.contact_name}</Link></>} · {d.user_name}
          {d.location && <> · {d.location}</>}
        </div>
        {d.notes && <div>{d.notes}</div>}
        {d.checks.map((c) => <CheckLine key={c.id} c={c} a={d} />)}
        {d.outcome && <div className="card" style={{ padding: 10 }}><b>{t('visits.outcome', 'Outcome')}:</b> {t(`visits.outcome.${d.outcome}`, OUTCOME_LABEL[d.outcome])}{d.outcome_notes && <div>{d.outcome_notes}</div>}
          {d.followup_task && <div className="muted">{t('visits.followup', 'Follow-up task')}: {d.followup_task.title}{d.followup_task.due_date ? ` · ${d.followup_task.due_date}` : ''}</div>}</div>}
        {d.status_note && <div className="muted">{d.status_note}</div>}

        {step === 'notice' && (
          <div className="alert" role="note">
            <div style={{ whiteSpace: 'pre-wrap' }}>{d.settings.location_notice || t('visits.notice', DEFAULT_NOTICE)}</div>
            <div className="row" style={{ marginTop: 8 }}><button className="btn primary" onClick={ack}>{t('visits.continue', 'Continue')}</button><button className="btn" onClick={() => setStep(null)}>{t('common.cancel', 'Cancel')}</button></div>
          </div>)}

        {step === 'review' && (
          <div className="card" style={{ padding: 12 }}>
            <b>{action === 'check-in' ? t('visits.check_in', 'Check in') : t('visits.check_out', 'Check out')}</b>
            {reading?.status === 'pending' ? <div className="muted">{t('visits.locating', 'Asking the device for its location…')}</div> : (
              <>
                <div>{t(...(LOC[reading?.status] || LOC.unavailable))}{reading?.status === 'captured' && reading.accuracy != null && ` · ±${dist(reading.accuracy)}`}</div>
                {preview && <div className="muted">{dist(preview.m)} · {t(PROX[preview.p][0], PROX[preview.p][1], { r: dist(d.settings.proximity_m) })}</div>}
                <div className="muted" style={{ fontSize: 12 }}>{t('visits.not_proof', 'A GPS reading is an indicator, not proof that someone was at the property.')}</div>
                {action === 'check-out' && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <Field label={t('visits.outcome', 'Outcome')} required><select className="input" value={out.outcome} onChange={(e) => setOut({ ...out, outcome: e.target.value })}><option value="">{t('visits.choose', 'Choose…')}</option>{OUTCOMES.map((o) => <option key={o} value={o}>{t(`visits.outcome.${o}`, OUTCOME_LABEL[o])}</option>)}</select></Field>
                    <Field label={t('visits.notes', 'Notes')}><textarea className="input" rows={2} value={out.outcome_notes} onChange={(e) => setOut({ ...out, outcome_notes: e.target.value })} /></Field>
                    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                      <Field label={t('visits.followup_optional', 'Follow-up task (optional)')}><input className="input" value={out.followup_title} onChange={(e) => setOut({ ...out, followup_title: e.target.value })} /></Field>
                      <Field label={t('visits.due', 'Due')}><input className="input" type="date" value={out.followup_due} onChange={(e) => setOut({ ...out, followup_due: e.target.value })} /></Field>
                    </div>
                  </div>)}
                {failed && <div className="alert err">{t('visits.not_sent', 'Not sent: no connection. Try again; the same reading and time are kept and it will not be recorded twice.')}</div>}
                <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
                  <button className="btn primary" style={{ minHeight: 44 }} disabled={busy || (action === 'check-out' && !out.outcome)} onClick={() => send(false)}>{failed ? t('visits.try_again', 'Try again') : action === 'check-in' ? t('visits.check_in_now', 'Check in now') : t('visits.check_out_now', 'Check out now')}</button>
                  {reading?.status !== 'captured' && <button className="btn" disabled={busy} onClick={capture}>{t('visits.retry_location', 'Try location again')}</button>}
                </div>
                {reading?.status !== 'captured' && d.settings.manual_exception && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <Field label={t('visits.manual', 'Manual exception: why is there no location?')}><input className="input" value={manual} onChange={(e) => setManual(e.target.value)} /></Field>
                    <div><button className="btn" disabled={busy || manual.trim().length < 3 || (action === 'check-out' && !out.outcome)} onClick={() => send(true)}>{t('visits.use_manual', 'Record as manual exception')}</button></div>
                  </div>)}
              </>)}
          </div>)}

        {!step && (
          <div className="row wrap" style={{ gap: 8 }}>
            {mine && d.status === 'scheduled' && d.kind !== 'call' && <button className="btn primary" style={{ minHeight: 44 }} onClick={() => start('check-in')}>{t('visits.check_in', 'Check in')}</button>}
            {mine && d.status === 'in_progress' && <button className="btn primary" style={{ minHeight: 44 }} onClick={() => start('check-out')}>{t('visits.check_out', 'Check out')}</button>}
            {manage && d.next.includes('no_show') && <button className="btn" onClick={() => close('no-show')}>{t('visits.no_show', 'No-show')}</button>}
            {manage && d.next.includes('canceled') && <button className="btn danger" onClick={() => close('cancel')}>{t('visits.cancel', 'Cancel visit')}</button>}
            {!mine && d.status === 'scheduled' && <span className="muted">{t('visits.agent_only', 'Only the assigned agent can check in, from their own sign-in.')}</span>}
          </div>)}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- list (contact / property / schedule)
export function VisitList({ items, onOpen }) {
  if (!items.length) return <Empty title={t('visits.empty', 'No visits yet')} hint={t('visits.empty_hint', 'Schedule a viewing or site visit.')} />;
  return (
    <div className="stack">
      {items.map((a) => (
        <button key={a.id} type="button" className="card row between wrap" style={{ padding: 12, textAlign: 'start', width: '100%', opacity: a.status === 'canceled' ? 0.6 : 1 }} onClick={() => onOpen(a)}>
          <span><b>{a.title}</b><div className="muted">{[a.property_title, a.contact_name, a.user_name].filter(Boolean).join(' · ')}</div></span>
          <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}><VisitTime a={a} /><VisitState status={a.status} /></span>
        </button>))}
    </div>
  );
}

/** Visits of one contact or one property, with "Schedule a visit". */
export function VisitsPanel({ contactId, propertyId }) {
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);
  const q = contactId ? `contact_id=${contactId}` : `property_id=${propertyId}`;
  const load = useCallback(() => api.get(`/api/appointments?${q}`).then(setD).catch((e) => setErr(e.message)), [q]);
  useEffect(() => { load(); }, [load]);
  const fixed = contactId ? { contact_id: contactId } : { property_id: propertyId };
  return (
    <div className="stack">
      <ErrorBox error={err} />
      {can('crm', 'edit') && <div><button className="btn primary sm" onClick={() => setForm(true)}>{t('visits.schedule', 'Schedule a visit')}</button></div>}
      {!d ? (!err && <Loading rows={2} />) : <VisitList items={[...d.items].reverse()} onOpen={(a) => setOpen(a.id)} />}
      {form && <VisitForm fixed={fixed} onClose={() => setForm(false)} onSaved={() => { setForm(false); load(); }} />}
      {open && <VisitSheet id={open} onClose={() => setOpen(null)} onChange={load} />}
    </div>
  );
}
