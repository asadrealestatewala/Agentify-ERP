// The CRM dialer board: numbers for the period, "Call next" (who most needs a call and why), the call script beside you,
// and the recent calls with their recordings. One press rings the agent's own phone first, then connects the lead.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, PageHead, Stat, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const OUTCOMES = [['connected', 'Spoke with them'], ['interested', 'Interested'], ['callback', 'Asked for a call back'], ['no_answer', 'No answer'], ['voicemail', 'Left a voicemail'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['do_not_call', 'Asked not to be called']];
const KEY = 'erp_agent_phone';
const dur = (s) => (!s ? '0s' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s}s`);

export default function Dialer() {
  const toast = useToast();
  const { user, can } = useAuth();
  const [q, setQ] = useState(null);
  const [log, setLog] = useState([]);
  const [stats, setStats] = useState(null);
  const [range, setRange] = useState('7d');
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState('');
  const [script, setScript] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState('');
  const [agent, setAgent] = useState(() => { try { return localStorage.getItem(KEY) || user?.phone || ''; } catch { return user?.phone || ''; } });
  const [active, setActive] = useState(null);
  const [outcome, setOutcome] = useState({ outcome: 'connected', notes: '', followup_date: '' });
  const [sms, setSms] = useState(null);
  const [busy, setBusy] = useState(0);
  const load = useCallback(() => {
    api.get('/api/integrations/dialer/queue').then(setQ).catch((e) => setErr(e.message));
    api.get('/api/integrations/calls').then(setLog).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get(`/api/integrations/dialer/stats?range=${range}`).then(setStats).catch(() => {}); }, [range, log.length]);
  useEffect(() => {
    api.get('/api/integrations/scripts').then((s) => { setScripts(s); if (s[0]) setScriptId(String(s[0].id)); }).catch(() => {});
    api.get('/api/integrations/calls-settings').then(setSettings).catch(() => {});
  }, []);
  useEffect(() => { if (scriptId) api.get(`/api/integrations/scripts/${scriptId}/render${active?.contact_id ? `?contact_id=${active.contact_id}` : ''}`).then(setScript).catch(() => setScript(null)); }, [scriptId, active?.contact_id]);

  const call = async (c) => {
    setBusy(c.id);
    try {
      if (agent) { try { localStorage.setItem(KEY, agent); } catch { /* ignore */ } }
      const r = await api.post('/api/integrations/calls', { contact_id: c.id, agent_number: agent || undefined });
      setActive({ id: r.id, name: c.name, contact_id: c.id, message: r.message }); setOutcome({ outcome: 'connected', notes: '', followup_date: '' }); load();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(0); }
  };
  const saveOutcome = async () => { try { const r = await api.post(`/api/integrations/calls/${active.id}/outcome`, outcome); toast(r.followup_date ? `Saved. Next follow-up ${r.followup_date}` : 'Saved'); setActive(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const sendSms = async () => { try { await api.post('/api/integrations/sms', { contact_id: sms.id, body: sms.body }); toast('Message sent'); setSms(null); } catch (e) { toast(e.message, 'err'); } };
  const saveSettings = async (patch) => { try { const r = await api.put('/api/integrations/calls-settings', { record: settings.record, transcribe: settings.transcribe, announcement: settings.announcement, ...patch }); setSettings({ ...settings, ...r }); } catch (e) { toast(e.message, 'err'); } };

  return (
    <>
      <PageHead title="Dialer" sub="Your calling board: who to call next and why, the script beside you, and how your calls are going.">
        <div className="seg">{[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, l]) => <button key={k} className={`btn sm ${range === k ? 'primary' : ''}`} onClick={() => setRange(k)}>{l}</button>)}</div>
        <Link className="btn sm" to="/recordings">Recordings</Link>
      </PageHead>
      <ErrorBox error={err} />
      {q && !q.voice && <div className="alert warn">Calling is not connected yet. <Link to="/settings/integrations">Connect Twilio (or your voice provider)</Link> to start. It takes a few minutes. You can still plan your calls below.</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 12 }}>
        <Stat label="Calls made" value={stats ? stats.calls : '…'} icon="phone" />
        <Stat label="Connected" value={stats ? `${stats.connected}` : '…'} sub={stats ? `${stats.connect_rate}% of calls` : ''} icon="check" />
        <Stat label="Average call" value={stats ? dur(stats.avg_duration) : '…'} icon="clock" sub="calls that connected" />
        <Stat label="Talk time" value={stats ? dur(stats.talk_seconds) : '…'} icon="users" />
        <Stat label="Recorded" value={stats ? stats.recordings : '…'} icon="file" to="/recordings" />
      </div>

      <div className="dialer-cols" data-stack="md" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(280px,360px)', gap: 16, alignItems: 'start' }}>
        <div>
          {active && (
            <Card title={`Call with ${active.name}`}>
              {active.message && <div className="alert info">{active.message}</div>}
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                <Field label="How did it go?"><select className="input" value={outcome.outcome} onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Next follow-up (optional)"><input className="input" type="date" value={outcome.followup_date} onChange={(e) => setOutcome({ ...outcome, followup_date: e.target.value })} /></Field>
              </div>
              <Field label="Notes"><textarea className="input" rows={2} value={outcome.notes} onChange={(e) => setOutcome({ ...outcome, notes: e.target.value })} /></Field>
              <div className="row"><button className="btn primary" onClick={saveOutcome}>Save outcome</button><button className="btn" onClick={() => setActive(null)}>Later</button></div>
            </Card>)}
          <Card title="Call next" actions={<div className="row"><label className="muted">Ring me on <input className="input" style={{ width: 160, display: 'inline-block' }} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Your mobile number" /></label><button className="btn sm" onClick={load}>Refresh</button></div>} flush>
            {!q ? <Loading /> : !q.queue.length ? <Empty icon="phone" title="Nobody needs a call right now" hint="New leads and follow-ups that are due will appear here, ranked." /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Lead</th><th>Why now</th><th>Phone</th><th /></tr></thead><tbody>
                {q.queue.map((c) => <tr key={c.id}><td><Link to={`/contacts/${c.id}`}><b>{c.name}</b></Link></td><td>{c.reason}</td><td className="mono">{c.phone}</td>
                  <td className="right nowrap"><button className="btn primary sm" disabled={!q.voice || busy === c.id} onClick={() => call(c)}>{busy === c.id ? 'Starting…' : 'Call'}</button>{' '}<button className="btn sm" onClick={() => setSms({ id: c.id, name: c.name, body: '' })}>Text</button></td></tr>)}
              </tbody></table></div>)}
          </Card>
          {sms && (
            <Card title={`Text ${sms.name}`}>
              <textarea className="input" rows={3} maxLength={600} value={sms.body} onChange={(e) => setSms({ ...sms, body: e.target.value })} placeholder="Write a short message. Only text people who agreed to be contacted." />
              <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={!sms.body.trim()} onClick={sendSms}>Send</button><button className="btn" onClick={() => setSms(null)}>Cancel</button></div>
            </Card>)}
          <Card title="Recent calls" flush>
            {!log.length ? <Empty icon="phone" title="No calls yet" hint="Calls you make from here are listed with their outcome and recording." /> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Status</th><th>Length</th><th>Outcome</th><th /></tr></thead><tbody>
                {log.map((k) => <tr key={k.id}><td className="muted nowrap">{dateTime(k.started_at)}</td><td>{k.full_name || k.to_number}</td><td><StatusBadge status={k.status === 'completed' ? 'active' : k.status === 'failed' ? 'danger' : 'pending'} label={k.status.replace('_', ' ')} /></td><td>{k.duration != null ? dur(k.duration) : '—'}</td><td>{k.outcome ? k.outcome.replace(/_/g, ' ') : <button className="btn sm" onClick={() => { setActive({ id: k.id, name: k.full_name || k.to_number, contact_id: k.contact_id, message: '' }); setOutcome({ outcome: 'connected', notes: '', followup_date: '' }); }}>Record</button>}</td><td className="muted">{k.notes}</td></tr>)}
              </tbody></table></div>)}
          </Card>
        </div>

        <div style={{ position: 'sticky', top: 12, display: 'grid', gap: 12 }}>
          <Card title="Call script" actions={scripts.length > 1 ? <select className="input" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>{scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}>
            {script ? <><div className="muted" style={{ marginBottom: 6 }}>{script.name}{active ? ` · for ${active.name}` : ''}</div><div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 420, overflow: 'auto' }}>{script.text}</div></> : <p className="muted">No script yet. {can('settings', 'edit') ? 'Add one in Integrations → Calls.' : 'Ask an administrator to add one.'}</p>}
          </Card>
          {settings && (
            <Card title="Recording">
              <label className="row"><input type="checkbox" checked={!!settings.record} disabled={!can('settings', 'edit')} onChange={(e) => saveSettings({ record: e.target.checked })} /> Record calls</label>
              <label className="row"><input type="checkbox" checked={!!settings.transcribe} disabled={!can('settings', 'edit') || !settings.ai_transcripts} onChange={(e) => saveSettings({ transcribe: e.target.checked })} /> Write a transcript {!settings.ai_transcripts && <span className="muted">(needs an OpenAI or Gemini key)</span>}</label>
              <p className="muted">Many countries require telling people a call is recorded. The announcement is played to both people at the start.</p>
            </Card>)}
        </div>
      </div>
      <style>{'@media (max-width: 960px){.dialer-cols{grid-template-columns:1fr !important}}'}</style>
    </>
  );
}
