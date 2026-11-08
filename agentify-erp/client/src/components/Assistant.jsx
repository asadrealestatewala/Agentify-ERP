import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api, downloadPost } from '../api.js';
import { useToast } from '../context.jsx';
import { date, money } from '../format.js';
import BackLayer from './BackLayer.jsx';

const START = ['How many leads this month?', 'How many projects are going on?', 'Budget utilised by project', 'Sales this month by agent', 'Receivables and overdue', 'How many leaves and salaries paid this year?', 'Balance sheet'];
const bold = (s) => String(s).split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
const cell = (c, v) => (v == null || v === '' ? '—' : c.type === 'money' ? money(v) : typeof v === 'number' ? v.toLocaleString('en-PK') : /^\d{4}-\d\d-\d\d$/.test(v) ? date(v) : String(v));

function AnswerTable({ t }) {
  const [all, setAll] = useState(false);
  const rows = all ? t.rows : t.rows.slice(0, 6);
  if (!t.columns) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 3 }}>{t.title}</div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="t" style={{ fontSize: 11.5 }}><thead><tr>{t.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''} style={{ padding: '5px 8px' }}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{t.columns.map((c) => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num mono' : ''} style={{ padding: '5px 8px' }}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
          {t.totals && <tfoot><tr>{t.columns.map((c, i) => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num mono' : ''} style={{ padding: '5px 8px' }}>{t.totals[c.key] !== undefined ? cell(c, t.totals[c.key]) : i === 0 ? 'Total' : ''}</td>)}</tr></tfoot>}
        </table>
      </div>
      {t.rows.length > 6 && <button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${t.rows.length} rows`}</button>}
    </div>
  );
}

// Voice: the browser's own speech recognition (mic) and speech synthesis (read aloud). Nothing is sent to our servers for voice, so it is free;
// the typed text goes through Ask as usual. Where the browser has no support (many Android WebViews), the buttons hide and typing works as before.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const CAN_REC = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
const TTS = typeof window !== 'undefined' && 'speechSynthesis' in window;
const LANGS = [['en-US', 'English'], ['ur-PK', 'Urdu (اردو)'], ['ar-SA', 'Arabic (العربية)'], ['hi-IN', 'Hindi'], ['fr-FR', 'French'], ['es-ES', 'Spanish']];
const plainText = (s) => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const MicIcon = ({ on }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill={on ? 'currentColor' : 'none'} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
const ImageIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 9" /></svg>;
/** Shrink a picked picture to a JPEG of at most 1280px so it stays well under 1 MB. */
const shrink = (file) => new Promise((resolve, reject) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); let out = c.toDataURL('image/jpeg', 0.8); if (out.length > 1_300_000) out = c.toDataURL('image/jpeg', 0.5); resolve(out); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
  img.src = url;
});
const toBase64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
const SpeakerIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;

/** Floating data assistant: answers from the live ERP database and exports any answer as a PDF report. */
export default function Assistant() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // the phone top bar has its own Ask button (the floating one is hidden there so it never covers content)
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('erp:assistant', show); return () => window.removeEventListener('erp:assistant', show); }, []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(() => { try { return JSON.parse(sessionStorage.getItem('assistant-log')) || []; } catch { return []; } });
  const end = useRef(null);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('assistant-lang') || 'en-US'; } catch { return 'en-US'; } });
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(null);
  const [autoRead, setAutoRead] = useState(() => { try { return localStorage.getItem('assistant-autoread') === '1'; } catch { return false; } });
  const rec = useRef(null);
  const [caps, setCaps] = useState({ stt: false, image: false });
  const [image, setImage] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => { if (open) api.get('/api/assistant/capabilities').then(setCaps).catch(() => {}); }, [open]);
  const pickImage = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setImage(await shrink(f)); } catch (err) { toast(err.message, 'err'); } };
  const saveLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const stopListening = () => { if (recorder.current) { try { recorder.current.stop(); } catch { /* ignore */ } recorder.current = null; } if (rec.current) { rec.current.onend = null; try { rec.current.stop(); } catch { /* ignore */ } rec.current = null; } setListening(false); };
  const stopSpeaking = () => { if (TTS) window.speechSynthesis.cancel(); setSpeaking(null); };
  const speak = (text, id) => {
    if (!TTS) return;
    if (speaking === id) { stopSpeaking(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plainText(text).slice(0, 1500));
    // read in the language of the text: Arabic-script text uses the Urdu or Arabic voice, otherwise the chosen language
    u.lang = /[\u0600-\u06FF]/.test(text) ? (lang.startsWith('ar') ? 'ar-SA' : 'ur-PK') : lang;
    u.onend = () => setSpeaking(null); u.onerror = () => setSpeaking(null);
    setSpeaking(id); window.speechSynthesis.speak(u);
  };
  // Groq speech-to-text: record up to a minute, then send the clip. Works in every browser that can record, including the Android app.
  const listenServer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream), chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); clearTimeout(mr.cut); setListening(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 800) { toast('I could not hear anything. Please try again.', 'err'); return; }
        setTranscribing(true);
        try { const r = await api.post('/api/assistant/transcribe', { audio: await toBase64(blob), mime: blob.type, lang: lang.slice(0, 2) }); setQ(r.text); send(r.text); } catch (e) { toast(e.message, 'err'); } finally { setTranscribing(false); }
      };
      mr.start(); mr.cut = setTimeout(() => { try { mr.stop(); } catch { /* ignore */ } }, 60_000);
      recorder.current = mr; setListening(true);
    } catch { toast('Allow the microphone in your browser or phone settings to speak your question.', 'err'); }
  };
  const listen = () => {
    if (listening) { stopListening(); return; }
    stopSpeaking();
    if (caps.stt && CAN_REC) { listenServer(); return; }
    const r = new SR(); r.lang = lang; r.interimResults = true; r.continuous = false;
    r.onresult = (ev) => { const t = Array.from(ev.results).map((x) => x[0].transcript).join(' '); setQ(t); if (ev.results[ev.results.length - 1].isFinal) { setListening(false); rec.current = null; send(t); } };
    r.onerror = (ev) => { setListening(false); rec.current = null; toast(ev.error === 'not-allowed' ? 'Allow the microphone in your browser settings to speak your question.' : 'Could not hear you. Please try again or type your question.', 'err'); };
    r.onend = () => { setListening(false); rec.current = null; };
    try { r.start(); rec.current = r; setListening(true); } catch { toast('The microphone is not available right now. Please type your question.', 'err'); }
  };
  useEffect(() => () => { stopListening(); if (TTS) window.speechSynthesis.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { stopListening(); stopSpeaking(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // the floating button shrinks to an icon bubble while the page scrolls (so it never hides buttons or text) and re-expands when idle, hovered or focused
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let t;
    const onScroll = () => { setCompact(true); clearTimeout(t); t = setTimeout(() => setCompact(false), 1800); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => { document.removeEventListener('scroll', onScroll, { capture: true }); clearTimeout(t); };
  }, []);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener('erp:assistant', h); return () => window.removeEventListener('erp:assistant', h); }, []);
  useEffect(() => { try { sessionStorage.setItem('assistant-log', JSON.stringify(log.slice(-12))); } catch { /* ignore */ } end.current?.scrollIntoView({ block: 'end' }); }, [log, open]);

  const report = async (m) => {
    const note = window.prompt('What is wrong with this answer? (optional)', '');
    if (note === null) return;
    try { await api.post('/api/assistant/report', { question: m.question, answer: m.answer, note }); setLog((l) => l.map((x) => (x === m ? { ...x, reported: true } : x))); toast('Thank you. We will review it.'); } catch (e) { toast(e.message, 'err'); }
  };
  const pdf = async (question) => { try { await downloadPost('/api/assistant/pdf', { question }, 'assistant-report.pdf'); } catch (e) { toast(e.message, 'err'); } };
  const send = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    const pic = image; setQ(''); setImage(null); setBusy(true);
    setLog((l) => [...l, { role: 'user', text: question, picture: pic }]);
    try {
      // the last few answered turns let follow-ups such as "and last month?" or "how do I do that?" work
      const history = log.filter((m) => m.role === 'bot' && !m.error && m.question).slice(-3).map((m) => ({ q: m.question, a: String(m.answer || '').slice(0, 600) }));
      const a = await api.post('/api/assistant/ask', { question, history, ...(pic ? { image: pic } : {}) });
      setLog((l) => [...l, { role: 'bot', question, ...a }]);
      if (autoRead && TTS && a.answer) speak(a.answer, `auto-${Date.now()}`);
      if (a.wants_pdf && a.tables?.length && a.intent !== 'denied') pdf(question);
    } catch (e) { setLog((l) => [...l, { role: 'bot', answer: e.message, tables: [], suggestions: [], error: true }]); } finally { setBusy(false); }
  };

  return (
    <>
      {!open && <button className={`assistant-fab no-print${compact ? ' compact' : ''}`} onClick={() => setOpen(true)} aria-label="Open data assistant" title="Ask the data assistant"><Icon name="bolt" size={20} /><span>Ask</span></button>}
      {open && <BackLayer onClose={() => setOpen(false)} />}
      {open && (
        <div className="assistant-panel no-print" role="dialog" aria-label="Data assistant">
          <div className="assistant-head">
            <div className="row"><span className="avatar sm" style={{ background: '#2563eb', color: '#fff' }}><Icon name="bolt" size={13} /></span><div><b>Data assistant</b><div style={{ fontSize: 11, opacity: 0.8 }}>Answers from your live ERP data</div></div></div>
            <div className="row"><button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => setLog([])}>Clear</button><button className="icon-btn" style={{ background: 'transparent', color: '#fff' }} onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" /></button></div>
          </div>
          <div className="assistant-body">
            {!log.length && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="bubble bot">Hi! Ask me about leads, projects, budgets, sales, receivables, staff leave and salaries, or the balance sheet. Add “pdf” or press the PDF button for a downloadable report.</div>
                <div className="row wrap">{START.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
              </div>
            )}
            {log.map((m, i) => (m.role === 'user'
              ? <div key={i} className="bubble me">{m.picture && <img src={m.picture} alt="Attached" style={{ display: 'block', maxWidth: 160, maxHeight: 120, borderRadius: 6, marginBottom: 4 }} />}{m.text}</div>
              : (
                <div key={i} className={`bubble bot ${m.error ? 'err' : ''}`}>
                  {!m.ai && m.tables?.length > 0 && m.intent !== 'denied' && <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Live data report from your ERP (no AI used). For "how do I ..." questions, ask them with how / kaise.</div>}
                  {m.ai && <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{m.engine === 'guide' ? 'From our help guides (the AI helper could not answer, so this is the guide text).' : `AI-written answer from our help guides${m.engine ? ` (${{ groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini' }[m.engine] || m.engine})` : ''}. Check important steps.`}</div>}
                  {m.ai && (m.notes || []).length > 0 && <div className="muted" style={{ fontSize: 11, marginBottom: 4, color: '#b45309' }}>{m.notes.join(' ')}</div>}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{bold(m.answer)}</div>
                  {m.ai && m.sources?.length > 0 && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>From: {m.sources.join(' · ')}</div>}
                  {m.links?.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}>{m.links.map((l) => <a key={l.url} className="btn sm" href={l.url} {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{l.label}</a>)}</div>}
                  {m.tables?.map((t, j) => <AnswerTable key={j} t={t} />)}
                  {TTS && !m.error && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => speak(m.answer, i)} aria-label={speaking === i ? 'Stop reading' : 'Read this answer aloud'}><SpeakerIcon />{speaking === i ? ' Stop' : ' Listen'}</button></div>}
                  {m.ai && <div style={{ marginTop: 8 }}><button className="btn sm" disabled={m.reported} onClick={() => report(m)}>{m.reported ? 'Reported' : 'Report'}</button></div>}
                  {m.tables?.length > 0 && m.intent !== 'denied' && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => pdf(m.question)}><Icon name="download" size={12} />Download PDF report</button></div>}
                  {i === log.length - 1 && m.suggestions?.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}>{m.suggestions.map((s) => <button key={s} className="chip" style={{ fontSize: 11.5 }} onClick={() => send(s)}>{s}</button>)}</div>}
                </div>
              )))}
            {busy && <div className="bubble bot"><span className="spinner" /></div>}
            <div ref={end} />
          </div>
          {(SR || TTS || caps.stt) && <div className="row wrap muted" style={{ gap: 8, padding: '6px 10px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
            <label className="row" style={{ gap: 4 }}>Voice language <select value={lang} onChange={(e) => { setLang(e.target.value); saveLocal('assistant-lang', e.target.value); }} style={{ fontSize: 12 }}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            {TTS && <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={autoRead} onChange={(e) => { setAutoRead(e.target.checked); saveLocal('assistant-autoread', e.target.checked ? '1' : '0'); if (!e.target.checked) stopSpeaking(); }} /> Read answers aloud</label>}
            {!SR && !(caps.stt && CAN_REC) && <span>Speaking questions is not supported in this browser. Use your keyboard's microphone key to dictate.</span>}
          </div>}
          {image && <div className="row" style={{ gap: 8, padding: '6px 10px', borderTop: '1px solid var(--border)' }}><img src={image} alt="Attached" style={{ height: 40, borderRadius: 4 }} /><span className="muted" style={{ fontSize: 12, flex: 1 }}>Picture attached. Don't include client data.</span><button type="button" className="btn sm" onClick={() => setImage(null)}>Remove</button></div>}
          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={transcribing ? 'Writing down what you said…' : listening ? 'Listening… tap the microphone to stop' : 'e.g. How many leads did we get this month?'} aria-label="Ask a question" autoFocus />
            {(SR || (caps.stt && CAN_REC)) && <button type="button" disabled={transcribing} className={`btn${listening ? ' primary' : ''}`} onClick={listen} aria-label={listening ? 'Stop listening' : 'Speak your question'} aria-pressed={listening} title={listening ? 'Stop listening' : 'Speak your question'}><MicIcon on={listening} /></button>}
            {caps.image && <><input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} /><button type="button" className="btn" onClick={() => fileRef.current?.click()} aria-label="Attach a picture" title="Attach a picture or screenshot"><ImageIcon /></button></>}
            <button className="btn primary" disabled={busy || !q.trim()} aria-label="Send">Send</button>
          </form>
        </div>
      )}
    </>
  );
}
