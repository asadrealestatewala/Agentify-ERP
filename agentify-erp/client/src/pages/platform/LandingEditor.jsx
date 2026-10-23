// Super Admin console: the landing page editor. Full screen: the real landing page on the right (live, with the text editable in place),
// a panel on the left for every wording, the sections that can be switched off, and per-country wording. "Publish" saves for visitors.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBox, Loading, StatusBadge, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A } from './AdminShell.jsx';
import { COPY, COPY_DEFAULTS, SECTIONS } from '../../../../shared/landingCopy.js';

const COUNTRIES = [['US', 'United States'], ['UK', 'United Kingdom'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['PK', 'Pakistan']];
const WIDTH = { desktop: '100%', tablet: '768px', mobile: '390px' };
const stripCountry = (copy) => Object.fromEntries(Object.entries(copy).filter(([k]) => !k.includes('@')));
const GROUPS = [...new Set(COPY.map((c) => c.group))];

export default function LandingEditorPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [copy, setCopy] = useState({});
  const [off, setOff] = useState([]);
  const [saved, setSaved] = useState('');
  const [scope, setScope] = useState('all');
  const [device, setDevice] = useState('desktop');
  const [tab, setTab] = useState('text');
  const [panelOpen, setPanelOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => ({ Hero: true }));
  const frame = useRef(null);
  const ready = useRef(false);
  const past = useRef([]), future = useRef([]), last = useRef({ key: '', at: 0 });
  const [, bump] = useState(0);

  const load = useCallback(() => api.get(`${A}/marketing`).then((r) => { const c = r.content || {}; setD(r); setCopy(c.copy || {}); setOff(c.sections_off || []); setSaved(JSON.stringify([c.copy || {}, c.sections_off || []])); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const cur = JSON.stringify([copy, off]);
  const dirty = !!d && cur !== saved;
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  // every change goes through here so Undo and Redo work; typing in one box is merged into one step
  const change = (nextCopy, nextOff, key) => {
    const now = Date.now();
    if (!(key && last.current.key === key && now - last.current.at < 900)) { past.current.push(JSON.stringify([copy, off])); if (past.current.length > 100) past.current.shift(); future.current = []; }
    last.current = { key, at: now };
    setCopy(nextCopy); setOff(nextOff); bump((n) => n + 1);
  };
  const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push(JSON.stringify([copy, off])); const [c, o] = JSON.parse(p); setCopy(c); setOff(o); last.current = { key: '', at: 0 }; bump((n) => n + 1); };
  const redo = () => { const p = future.current.pop(); if (!p) return; past.current.push(JSON.stringify([copy, off])); const [c, o] = JSON.parse(p); setCopy(c); setOff(o); last.current = { key: '', at: 0 }; bump((n) => n + 1); };

  const keyFor = useCallback((k) => (scope === 'all' ? k : `${k}@${scope}`), [scope]);
  const setText = (k, value, merge = true) => {
    const key = keyFor(k);
    const next = { ...copy };
    if (value === '' || value === undefined || (scope === 'all' && value === COPY_DEFAULTS[k])) delete next[key]; else next[key] = value;
    change(next, off, merge ? key : '');
  };
  const toggleSection = (id, on) => change(copy, on ? off.filter((x) => x !== id) : [...off, id], '');

  // the page in the iframe gets the draft by message; text typed on the page comes back the same way
  const patch = useMemo(() => ({ copy: scope === 'all' ? stripCountry(copy) : copy, sections_off: off }), [copy, off, scope]);
  const send = useCallback(() => { const w = frame.current?.contentWindow; if (w && ready.current) w.postMessage({ t: 'landing-state', patch }, window.location.origin); }, [patch]);
  const latest = useRef({}); latest.current = { setText, send };
  useEffect(() => { send(); }, [send]);
  useEffect(() => {
    const h = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data || {};
      if (m.t === 'landing-ready') { ready.current = true; latest.current.send(); }
      else if (m.t === 'copy' && typeof m.k === 'string' && typeof m.value === 'string' && m.value.length <= 600 && COPY_DEFAULTS[m.k] !== undefined) latest.current.setText(m.k, m.value, false);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  const publish = async () => {
    setBusy(true);
    try { await api.put(`${A}/marketing`, { copy, sections_off: off }); toast('Landing page published. Visitors see it now.', 'ok'); setSaved(JSON.stringify([copy, off])); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const exit = () => { if (dirty && !window.confirm('You have changes that are not published. Leave anyway?')) return; nav('/platform/website'); };

  if (err) return <div style={{ padding: 24 }}><ErrorBox error={err} /></div>;
  if (!d) return <div style={{ padding: 24 }}><Loading /></div>;
  const src = `/?editor=1${scope === 'all' ? '' : `&country=${scope.toLowerCase()}`}`;
  const value = (k) => copy[keyFor(k)] ?? '';
  const general = (k) => (scope === 'all' ? COPY_DEFAULTS[k] : copy[k] ?? COPY_DEFAULTS[k]);
  const countryCount = COUNTRIES.map(([c]) => Object.keys(copy).filter((k) => k.endsWith(`@${c}`)).length);

  return (
    <div className="wed-fs lde">
      <div className="wed-top">
        <button className="btn" onClick={exit}>← Exit</button>
        <button className="btn" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '◀ Hide panel' : '▶ Show panel'}</button>
        <b className="wed-title">Landing page editor</b>
        <label className="lde-scope">Wording for
          <select className="select" value={scope} onChange={(e) => { ready.current = false; setScope(e.target.value); }} aria-label="Which visitors the wording is for">
            <option value="all">All countries</option>
            {COUNTRIES.map(([c, n], i) => <option key={c} value={c}>{n}{countryCount[i] ? ` (${countryCount[i]} own)` : ''}</option>)}
          </select>
        </label>
        <span className="grow" />
        <div className="seg2s">{[['desktop', '🖥 Desktop'], ['tablet', '📱 Tablet'], ['mobile', '📲 Mobile']].map(([k, l]) => <button key={k} className={device === k ? 'on' : ''} onClick={() => setDevice(k)} aria-label={`${k} preview`}>{l}</button>)}</div>
        <button className="btn" disabled={!past.current.length} onClick={undo} title="Undo">↶ Undo</button>
        <button className="btn" disabled={!future.current.length} onClick={redo} title="Redo">↷ Redo</button>
        <a className="btn" href="/" target="_blank" rel="noreferrer">View live site ↗</a>
        <button className="btn primary" disabled={!dirty || busy} onClick={publish}>{busy ? 'Publishing…' : dirty ? 'Publish' : 'Published'}</button>
      </div>
      <div className={`wed ${panelOpen ? '' : 'nopanel'}`}>
        <div className="wed-panel">
          <div className="tabs" role="tablist">{[['text', 'Page text'], ['sections', 'Sections'], ['more', 'More']].map(([k, l]) => <button key={k} role="tab" className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
          <div style={{ paddingTop: 12 }}>
            {tab === 'text' && (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Click any text on the page to type on it, or edit it here. {scope === 'all' ? 'This is the general wording that every visitor sees.' : <>You are writing the wording for <b>{COUNTRIES.find(([c]) => c === scope)[1]}</b> only. Empty boxes use the general wording.</>}</p>
                {GROUPS.map((g) => (
                  <details key={g} open={!!open[g]} onToggle={(e) => { const isOpen = e.currentTarget.open; setOpen((o) => (o[g] === isOpen ? o : { ...o, [g]: isOpen })); }} className="lde-group">
                    <summary>{g}</summary>
                    {COPY.filter((c) => c.group === g).map((c) => (
                      <label key={c.key} className="lde-field"><span>{c.label}{value(c.key) && <StatusBadge status="active" label={scope === 'all' ? 'edited' : 'own wording'} />}</span>
                        {c.long
                          ? <textarea className="input" rows={3} maxLength={600} value={value(c.key)} placeholder={general(c.key) || 'Uses the market wording'} onChange={(e) => setText(c.key, e.target.value)} />
                          : <input className="input" maxLength={600} value={value(c.key)} placeholder={general(c.key)} onChange={(e) => setText(c.key, e.target.value)} />}
                      </label>
                    ))}
                  </details>
                ))}
              </div>
            )}
            {tab === 'sections' && (
              <div className="stack" style={{ gap: 8 }}>
                <p className="muted" style={{ margin: 0 }}>Switch off the parts of the landing page you do not want visitors to see. The top bar, hero and footer always stay.</p>
                {SECTIONS.map(([id, label]) => <Toggle key={id} value={!off.includes(id)} onChange={(v) => toggleSection(id, v)} label={label} />)}
              </div>
            )}
            {tab === 'more' && (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0 }}>More of the website is edited on these pages. Publish here first, or you will be asked about unpublished changes.</p>
                <Link className="btn" to="/platform/website" onClick={(e) => { if (dirty && !window.confirm('You have changes that are not published. Leave anyway?')) e.preventDefault(); }}>Questions, testimonials, partner logos, contact details, search text and legal pages</Link>
                <Link className="btn" to="/platform/reviews" onClick={(e) => { if (dirty && !window.confirm('You have changes that are not published. Leave anyway?')) e.preventDefault(); }}>Customer reviews waiting for approval</Link>
              </div>
            )}
          </div>
        </div>
        <div className="wed-preview">
          <div className="wed-frame bc"><div className="bc-wrap"><div className={`bc-device ${device}`} style={{ width: WIDTH[device] }}>
            <iframe ref={frame} key={src} title="Landing page" src={src} className="bc-frame" onLoad={() => { ready.current = false; }} />
          </div><div className="bc-size">{device === 'desktop' ? 'Desktop · full width' : device === 'tablet' ? 'Tablet · 768 px' : 'Mobile · 390 px'}</div></div></div>
        </div>
      </div>
    </div>
  );
}
