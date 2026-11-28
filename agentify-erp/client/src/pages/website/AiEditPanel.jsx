import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { imgUrl } from '../../site/siteCore.jsx';
import { Loading } from '../../components/ui.jsx';

/**
 * "Edit with AI" in the Website studio. The owner describes a change (and can upload or pick their own pictures: logo,
 * favicon, team photos), the assistant proposes it, the owner previews it on the page, applies it to the draft and publishes
 * as usual. Nothing reaches visitors until Publish. The conversation lives in the studio (props) so it survives switching
 * between the menu and a block.
 */
const EXAMPLES = [
  'Make the hero darker and add an FAQ before the contact form',
  'Use the colours of my logo for the whole site',
  'Set my uploaded picture as the favicon and the logo',
  'Put my team photos on the team block',
  'Rewrite the home page headline to sound more friendly',
];

export default function AiEditPanel({ chat, setChat, getContext, onPreview, previewing, onApply, onUndo, canUndo, busyApply }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [assets, setAssets] = useState([]);
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('edit');
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [pic, setPic] = useState({ open: false, prompt: '', aspect: 'landscape', busy: false });
  const end = useRef(null);
  const file = useRef(null);

  const load = useCallback(() => api.get('/api/site-admin/ai-edit/status').then((r) => { setSt(r); setAssets(r.assets || []); }).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [chat.length, busy]);

  const cost = st ? (mode === 'redesign' ? st.costs.redesign : st.costs.edit) + (images ? ` + up to ${st.max_images * st.costs.image} for pictures` : '') : '';
  const upload = async (files) => {
    if (!files.length) return;
    setUpBusy(true);
    try {
      const fd = new FormData(); files.forEach((f) => fd.append('files', f));
      const r = await api.upload('/api/site-admin/media', fd);
      await load();
      setPicked((p) => [...new Set([...r.map((x) => x.id), ...p])].slice(0, 4));
      toast(`${r.length === 1 ? 'Picture' : 'Pictures'} uploaded and shown to the assistant`, 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setUpBusy(false); }
  };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? (toast('Show the assistant up to 4 pictures at a time', 'err'), p) : [...p, id]));

  const send = async (msg) => {
    const message = (msg ?? text).trim();
    if (!message || busy) return;
    const { page, sections, config } = getContext();
    const history = chat.filter((m) => m.role === 'user' || m.summary).map((m) => ({ role: m.role, text: m.role === 'user' ? m.text : m.summary })).slice(-6);
    setChat((c) => [...c, { role: 'user', text: message }]);
    setText(''); setBusy(true);
    try {
      const r = await api.post('/api/site-admin/ai-edit', { message, mode, page, sections, config, asset_ids: picked, allow_images: images, history });
      setChat((c) => [...c, { role: 'assistant', summary: r.summary, proposal: r, state: 'new' }]);
      if (r.pictures?.length) load();
      setSt((s) => (s ? { ...s, credits: { ...s.credits, left: r.credits_left } } : s));
    } catch (e) {
      setChat((c) => [...c, { role: 'assistant', error: e.message }]);
    } finally { setBusy(false); }
  };

  const makePicture = async () => {
    if (pic.prompt.trim().length < 8) { toast('Describe the picture in a sentence', 'err'); return; }
    setPic((p) => ({ ...p, busy: true }));
    try {
      const r = await api.post('/api/site-admin/ai-edit/picture', { prompt: pic.prompt, aspect: pic.aspect });
      await load();
      setPicked((p) => [r.id, ...p].slice(0, 4));
      setPic({ open: false, prompt: '', aspect: 'landscape', busy: false });
      toast(r.credits_used ? `Picture saved in your image library (${r.credits_used} credits)` : 'Picture saved in your image library', 'ok');
    } catch (e) { toast(e.message, 'err'); setPic((p) => ({ ...p, busy: false })); }
  };

  const mark = (i, state) => setChat((c) => c.map((m, j) => (j === i ? { ...m, state } : m)));

  if (!st) return <Loading />;
  return (
    <div className="ai-panel">
      {!st.available && <p className="ai-warn" role="status">{st.reason}</p>}
      <div className="ai-chat" aria-live="polite">
        {!chat.length && (
          <div className="ai-intro">
            <p>Tell me what to change on this page or in the site look. I will suggest it, you preview it, and nothing goes live until you publish.</p>
            <div className="ai-ex">{EXAMPLES.map((x) => <button key={x} type="button" className="ai-chip" disabled={!st.available || busy} onClick={() => send(x)}>{x}</button>)}</div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.role === 'user' && <p>{m.text}</p>}
            {m.error && <p className="ai-err">{m.error}</p>}
            {m.proposal && (
              <>
                <p>{m.summary}</p>
                {!!m.proposal.changes.length && <ul className="ai-changes">{m.proposal.changes.map((c, k) => <li key={k}>{c}</li>)}</ul>}
                {!!m.proposal.notes?.length && <ul className="ai-notes">{m.proposal.notes.map((c, k) => <li key={k}>{c}</li>)}</ul>}
                {!!m.proposal.pictures?.length && <div className="ai-pics">{m.proposal.pictures.map((p) => <img key={p.id} src={imgUrl(p.path)} alt={p.caption || 'New picture'} />)}</div>}
                <small className="ai-meta">{m.proposal.credits_used} credit{m.proposal.credits_used === 1 ? '' : 's'} used{m.proposal.credits_left != null ? ` · ${m.proposal.credits_left} left this month` : ''}</small>
                {m.state === 'applied' && <p className="ai-done">Applied to your draft. Press Save draft, then Publish when you are happy.</p>}
                {m.state === 'dismissed' && <p className="ai-meta">Dismissed.</p>}
                {m.state === 'new' && !!(m.proposal.changes.length) && (
                  <div className="ai-actions">
                    <button type="button" className={`st-btn sm ${previewing === m.proposal ? 'on' : ''}`} onClick={() => onPreview(previewing === m.proposal ? null : m.proposal)}>{previewing === m.proposal ? 'Close preview' : 'Preview'}</button>
                    <button type="button" className="st-btn sm primary" disabled={busyApply} onClick={() => { onApply(m.proposal); mark(i, 'applied'); }}>Apply to my draft</button>
                    <button type="button" className="st-btn sm" onClick={() => { if (previewing === m.proposal) onPreview(null); mark(i, 'dismissed'); }}>Dismiss</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {busy && <div className="ai-msg assistant"><p className="ai-think">Working on it… a full redesign can take a minute.</p></div>}
        <div ref={end} />
      </div>
      {canUndo && <button type="button" className="st-btn sm" onClick={onUndo}>Undo the last AI change</button>}

      <details className="ai-assets" open={!!assets.length || undefined}>
        <summary>Your pictures {picked.length ? `· ${picked.length} shown to the assistant` : ''}</summary>
        <p className="st-note">Upload your logo, favicon, team photos or any picture. Tick the ones the assistant should look at, then say what to do with them, for example “this is my logo, use its colours” or “these are my team, put them on the team block”. Pictures you tick are sent to the AI service for this request only.</p>
        <div className="ai-row">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
          <button type="button" className="st-btn sm" disabled={upBusy} onClick={() => file.current?.click()}>{upBusy ? 'Uploading…' : 'Upload pictures'}</button>
          {st.images_available && <button type="button" className="st-btn sm" onClick={() => setPic((p) => ({ ...p, open: !p.open }))}>Create a picture</button>}
        </div>
        {pic.open && (
          <div className="ai-make">
            <label>What should the picture show?<textarea className="textarea" rows={3} maxLength={500} value={pic.prompt} onChange={(e) => setPic({ ...pic, prompt: e.target.value })} placeholder="A modern house at sunset with a green lawn" /></label>
            <label>Shape<select className="select" value={pic.aspect} onChange={(e) => setPic({ ...pic, aspect: e.target.value })}><option value="landscape">Wide (banner)</option><option value="square">Square</option><option value="portrait">Tall</option></select></label>
            <button type="button" className="st-btn sm primary" disabled={pic.busy} onClick={makePicture}>{pic.busy ? 'Creating…' : `Create (${st.costs.image} credits)`}</button>
          </div>
        )}
        <div className="ai-grid">
          {assets.slice(0, 60).map((a) => (
            <button key={a.id} type="button" className={`ai-th ${picked.includes(a.id) ? 'on' : ''}`} aria-pressed={picked.includes(a.id)} title={a.caption || 'Picture'} onClick={() => toggle(a.id)}>
              <img src={imgUrl(a.path)} alt={a.caption || 'Library picture'} loading="lazy" />
            </button>
          ))}
          {!assets.length && <p className="st-note">No pictures yet.</p>}
        </div>
      </details>

      <div className="ai-compose">
        <div className="ai-row">
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="How big is the change?">
            <option value="edit">Quick edit · {st.costs.edit} credit</option>
            <option value="redesign">Full redesign · {st.costs.redesign} credits</option>
          </select>
          {st.images_available && <label className="ai-check"><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} /> Let it create new pictures</label>}
        </div>
        <textarea className="textarea" rows={3} maxLength={1500} value={text} disabled={!st.available || busy} placeholder="Describe the change…" aria-label="Describe the change" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <div className="ai-row between">
          <small className="ai-meta">{st.credits.left != null ? `${st.credits.left} credits left · ` : ''}this request: {cost} credits</small>
          <button type="button" className="st-btn primary" disabled={!st.available || busy || text.trim().length < 3} onClick={() => send()}>{busy ? 'Thinking…' : 'Suggest changes'}</button>
        </div>
      </div>
    </div>
  );
}
