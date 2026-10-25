// Appointments and property visits: the agent's schedule (phone-friendly cards with check-in / check-out), everyone's
// schedule for managers, and the workspace's visit settings. Added to Google Calendar when it is connected.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, PageHead, Tabs, Toggle } from '../components/ui.jsx';
import { VisitForm, VisitList, VisitSheet } from '../components/Visits.jsx';
import { api, qs } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { today } from '../format.js';
import { t } from '../i18n.js';

const VIEWS = [['upcoming', 'Upcoming'], ['today', 'Today'], ['past', 'Past'], ['all', 'All']];

export default function Appointments() {
  const { user, can } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('upcoming');
  const [who, setWho] = useState('mine');
  const manager = !user?.own_scope;
  const load = useCallback(() => {
    const d0 = today();
    const range = view === 'today' ? { from: d0, to: d0 } : view === 'upcoming' ? { from: d0 } : view === 'past' ? { to: d0 } : {};
    return api.get(`/api/appointments${qs({ ...range, mine: who === 'mine' ? '1' : '' })}`).then(setD).catch((e) => setErr(e.message));
  }, [view, who]);
  useEffect(() => { load(); }, [load]);
  const items = d ? (view === 'past' ? [...d.items].reverse() : d.items) : [];
  return (
    <>
      <PageHead title={t('visits.page_title', 'Appointments & visits')} sub={d?.calendar_connected ? 'Connected to your Google Calendar: new appointments appear there.' : 'Connect Google Calendar in Settings > Integrations to see these in your calendar.'}>
        {can('crm', 'edit') && <button className="btn primary sm" onClick={() => setForm({})}>{t('visits.schedule', 'Schedule a visit')}</button>}
      </PageHead>
      <ErrorBox error={err} />
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <Tabs value={view} onChange={setView} tabs={VIEWS.map(([key, label]) => ({ key, label }))} />
        {manager && <select className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose schedule"><option value="mine">My schedule</option><option value="all">Everyone</option></select>}
      </div>
      {!d ? (!err && <Loading />) : <VisitList items={items} onOpen={(a) => setOpen(a.id)} />}
      {can('settings', 'edit') && d && <VisitSettings initial={d.settings} />}
      {form && <VisitForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {open && <VisitSheet id={open} onClose={() => setOpen(null)} onChange={load} />}
    </>
  );
}

/** Workspace settings for visit check-ins. Policy text is the business's own and should be reviewed before use. */
function VisitSettings({ initial }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [shown, setShown] = useState(false);
  const save = async () => { try { setS(await api.put('/api/appointments/visit-settings', s)); toast('Saved'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div style={{ marginTop: 16 }}>
      <button type="button" className="btn sm" onClick={() => setShown(!shown)} aria-expanded={shown}>Visit check-in settings</button>
      {shown && (
        <Card title="Visit check-in settings">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Near the property within (metres)" hint="Shown to agents in the workspace's distance unit."><input className="input" type="number" min={25} value={s.proximity_m} onChange={(e) => setS({ ...s, proximity_m: e.target.value })} /></Field>
            <Field label="Oldest usable reading (seconds)" hint="Older readings are kept but marked late, not verified."><input className="input" type="number" min={15} value={s.max_fix_age_s} onChange={(e) => setS({ ...s, max_fix_age_s: e.target.value })} /></Field>
            <Field label="Clear coordinates after (days)" hint="0 keeps them with the visit. The check-in record itself stays."><input className="input" type="number" min={0} value={s.retention_days} onChange={(e) => setS({ ...s, retention_days: e.target.value })} /></Field>
          </div>
          <Toggle value={!!s.manual_exception} onChange={(v) => setS({ ...s, manual_exception: v })} label="Allow a manual exception (check-in without a location, with a reason)" />
          <Field label="Notice shown to staff before the first location request" hint="Leave empty to use the built-in wording. Have your business or legal adviser review this text; it is not a consent form.">
            <textarea className="input" rows={3} value={s.location_notice || ''} onChange={(e) => setS({ ...s, location_notice: e.target.value })} /></Field>
          <div><button className="btn primary" onClick={save}>Save settings</button></div>
        </Card>)}
    </div>
  );
}
