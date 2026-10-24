// Everything recorded in the workspace: video meetings and phone calls, with transcripts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, StatusBadge, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const dur = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const size = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '—');
const tstatus = { none: 'No transcript', pending: 'Working…', done: 'Ready', failed: 'Failed' };

function Viewer({ kind, id, onClose, onChanged }) {
  const toast = useToast();
  const { can } = useAuth();
  const base = kind === 'meeting' ? `/api/meetings/recordings/${id}` : `/api/integrations/recordings/calls/${id}`;
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(base).then(setD), [base]);
  useEffect(() => { load(); }, [load]);
  const transcribe = async () => { setBusy(true); try { await api.post(`${base}/transcribe`); toast('Transcript ready'); load(); onChanged(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const text = d?.transcript || (d?.captions?.length ? d.captions.map((c) => `${c.speaker}: ${c.text}`).join('\n') : '');
  return (
    <Modal title={kind === 'meeting' ? 'Meeting recording' : 'Call recording'} onClose={onClose} size="lg" footer={<>
      {kind === 'meeting' && can('settings', 'edit') && <button className="btn danger" onClick={async () => { if (!window.confirm('Delete this recording permanently?')) return; await api.del(base); onChanged(); onClose(); }}>Delete</button>}
      <button className="btn" onClick={onClose}>Close</button></>}>
      {!d ? <Loading /> : (
        <>
          {kind === 'meeting' ? <video controls preload="metadata" style={{ width: '100%', borderRadius: 8, background: '#000' }} src={`${base}/video`} /> : d.has_audio ? <audio controls style={{ width: '100%' }} src={`${base}/audio`} /> : <div className="alert warn">The audio is still being fetched from the phone provider.</div>}
          <div className="row" style={{ margin: '12px 0', justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0 }}>Transcript <span className="muted">({tstatus[d.transcript_status] || d.transcript_status})</span></h4>
            {can('crm', 'edit') && d.transcript_status !== 'pending' && <button className="btn sm" disabled={busy} onClick={transcribe}>{busy ? 'Transcribing…' : d.transcript ? 'Transcribe again' : 'Generate transcript'}</button>}
          </div>
          {d.error && <div className="alert err">{d.error}</div>}
          {text ? <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--surface-2, #f6f7f9)', padding: 12, borderRadius: 8, maxHeight: 320, overflow: 'auto' }}>{text}</pre> : <p className="muted">No transcript yet. Generating one needs an OpenAI or Gemini key under Integrations. Live captions from the meeting appear here automatically.</p>}
        </>)}
    </Modal>);
}

const NO_FILTER = { q: '', customer: '', host: '', from: '', to: '', time_from: '', time_to: '', transcript: '', min_minutes: '' };

/** Search and narrow the list: a topic or keyword (also searches transcripts), customer, host or agent, date, time of day, transcript state, length. */
function Filters({ f, setF, shown, tab }) {
  const [more, setMore] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const active = Object.values(f).some(Boolean);
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  return (
    <Card>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <Field label="Topic or keyword" className="grow"><input className="input" type="search" placeholder={tab === 'meetings' ? 'Title, notes or anything said in the meeting' : 'What was said, notes or outcome'} value={f.q} onChange={set('q')} /></Field>
          <Field label="Customer"><input className="input" type="search" placeholder="Name, phone or email" value={f.customer} onChange={set('customer')} /></Field>
          <Field label={tab === 'meetings' ? 'Host' : 'Agent'}><input className="input" type="search" placeholder="Name" value={f.host} onChange={set('host')} /></Field>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <Field label="From date"><input className="input" type="date" value={f.from} max={f.to || undefined} onChange={set('from')} /></Field>
          <Field label="To date"><input className="input" type="date" value={f.to} min={f.from || undefined} onChange={set('to')} /></Field>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, from: day(0), to: day(0) }))}>Today</button>
            <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, from: day(6), to: day(0) }))}>Last 7 days</button>
            <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, from: day(29), to: day(0) }))}>Last 30 days</button>
          </div>
          <button type="button" className="btn sm" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? 'Fewer filters' : 'More filters'}</button>
          {active && <button type="button" className="btn sm" onClick={() => setF(NO_FILTER)}>Clear all</button>}
        </div>
        {more && (
          <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
            <Field label="From time of day" hint="Any day, for example 09:00"><input className="input" type="time" value={f.time_from} onChange={set('time_from')} /></Field>
            <Field label="To time of day" hint="22:00 to 06:00 spans midnight"><input className="input" type="time" value={f.time_to} onChange={set('time_to')} /></Field>
            <Field label="Transcript"><select className="input" value={f.transcript} onChange={set('transcript')}><option value="">Any</option><option value="ready">Has a transcript</option><option value="none">No transcript yet</option></select></Field>
            <Field label="At least (minutes)"><input className="input" type="number" min="0" max="1000" step="1" style={{ width: 110 }} value={f.min_minutes} onChange={set('min_minutes')} /></Field>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12.5 }} role="status" aria-live="polite">{shown == null ? 'Loading…' : active ? `${shown} recording${shown === 1 ? '' : 's'} match` : `${shown} recording${shown === 1 ? '' : 's'}`}</div>
      </div>
    </Card>
  );
}

export default function Recordings() {
  const [tab, setTab] = useState('meetings');
  const [meetings, setMeetings] = useState(null);
  const [calls, setCalls] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [f, setF] = useState(NO_FILTER);
  const active = useMemo(() => Object.values(f).some(Boolean), [f]);
  // typing waits a moment so every key press is not a request
  const [applied, setApplied] = useState(NO_FILTER);
  useEffect(() => { const t = setTimeout(() => setApplied(f), 300); return () => clearTimeout(t); }, [f]);
  const load = useCallback(() => {
    setErr('');
    api.get('/api/meetings/recordings/all', applied).then(setMeetings).catch((e) => setErr(e.message));
    api.get('/api/integrations/recordings/calls', applied).then(setCalls).catch((e) => setErr(e.message));
  }, [applied]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Recordings" sub="Video meetings and phone calls that were recorded, with their transcripts. Only people with access to the CRM can play them, and every play is logged." />
      <ErrorBox error={err} />
      <Tabs tabs={[{ key: 'meetings', label: 'Meetings', count: meetings?.length }, { key: 'calls', label: 'Calls', count: calls?.length }]} value={tab} onChange={setTab} />
      <Filters f={f} setF={setF} tab={tab} shown={(tab === 'meetings' ? meetings : calls)?.length ?? null} />
      <Card flush>
        {tab === 'meetings' ? (!meetings ? <Loading /> : !meetings.length ? (active ? <Empty icon="file" title="No meeting recordings match" hint="Try fewer filters or a wider date range." action={{ label: 'Clear all filters', onClick: () => setF(NO_FILTER) }} /> : <Empty icon="file" title="No meeting recordings yet" hint="Turn on Record when you schedule a meeting, then press Record in the room." />) : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Meeting</th><th>When</th><th>Length</th><th>Size</th><th>Transcript</th><th /></tr></thead><tbody>
            {meetings.map((r) => <tr key={r.id}><td><b>{r.title}</b>{(r.host_name || r.contact_name) && <div className="muted" style={{ fontSize: 12.5 }}>{[r.host_name && `Host: ${r.host_name}`, r.contact_name && `Customer: ${r.contact_name}`].filter(Boolean).join(' · ')}</div>}{r.excerpt && <div className="muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.excerpt}</div>}</td><td className="nowrap">{dateTime(r.created_at)}</td><td>{dur(r.duration)}</td><td>{size(r.size)}</td>
              <td><StatusBadge status={r.transcript_status === 'done' || r.caption_lines ? 'active' : 'pending'} label={r.transcript_status === 'done' ? 'Ready' : r.caption_lines ? `${r.caption_lines} caption lines` : 'None'} /></td>
              <td className="right"><button className="btn primary sm" onClick={() => setOpen({ kind: 'meeting', id: r.id })}>Play</button></td></tr>)}
          </tbody></table></div>))
          : (!calls ? <Loading /> : !calls.length ? (active ? <Empty icon="phone" title="No call recordings match" hint="Try fewer filters or a wider date range." action={{ label: 'Clear all filters', onClick: () => setF(NO_FILTER) }} /> : <Empty icon="phone" title="No call recordings yet" hint="Switch on call recording in the Dialer settings. Recordings appear a minute after each call ends." />) : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Call</th><th>Agent</th><th>When</th><th>Length</th><th>Transcript</th><th /></tr></thead><tbody>
              {calls.map((r) => <tr key={r.id}><td><b>{r.contact_name || r.to_number}</b>{r.excerpt && <div className="muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.excerpt}</div>}</td><td>{r.agent_name}</td><td className="nowrap">{dateTime(r.created_at)}</td><td>{dur(r.duration)}</td>
                <td><StatusBadge status={r.transcript_status === 'done' ? 'active' : 'pending'} label={tstatus[r.transcript_status] || '—'} /></td>
                <td className="right"><button className="btn primary sm" onClick={() => setOpen({ kind: 'call', id: r.id })}>Open</button></td></tr>)}
            </tbody></table></div>))}
      </Card>
      {open && <Viewer kind={open.kind} id={open.id} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
