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
  useEffect(() => { const h = () => setOpen(true); window.addEventListener('erp:assistant', h); return () => window.removeEventListener('erp:assistant', h); }, []);
  useEffect(() => { try { sessionStorage.setItem('assistant-log', JSON.stringify(log.slice(-12))); } catch { /* ignore */ } end.current?.scrollIntoView({ block: 'end' }); }, [log, open]);

  const pdf = async (question) => { try { await downloadPost('/api/assistant/pdf', { question }, 'assistant-report.pdf'); } catch (e) { toast(e.message, 'err'); } };
  const send = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ(''); setBusy(true);
    setLog((l) => [...l, { role: 'user', text: question }]);
    try {
      const a = await api.post('/api/assistant/ask', { question });
      setLog((l) => [...l, { role: 'bot', question, ...a }]);
      if (a.wants_pdf && a.tables?.length && a.intent !== 'denied') pdf(question);
    } catch (e) { setLog((l) => [...l, { role: 'bot', answer: e.message, tables: [], suggestions: [], error: true }]); } finally { setBusy(false); }
  };

  return (
    <>
      {!open && <button className="assistant-fab no-print" onClick={() => setOpen(true)} aria-label="Open data assistant" title="Ask the data assistant"><Icon name="bolt" size={20} /><span>Ask</span></button>}
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
              ? <div key={i} className="bubble me">{m.text}</div>
              : (
                <div key={i} className={`bubble bot ${m.error ? 'err' : ''}`}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{bold(m.answer)}</div>
                  {m.tables?.map((t, j) => <AnswerTable key={j} t={t} />)}
                  {m.tables?.length > 0 && m.intent !== 'denied' && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => pdf(m.question)}><Icon name="download" size={12} />Download PDF report</button></div>}
                  {i === log.length - 1 && m.suggestions?.length > 0 && <div className="row wrap" style={{ marginTop: 8 }}>{m.suggestions.map((s) => <button key={s} className="chip" style={{ fontSize: 11.5 }} onClick={() => send(s)}>{s}</button>)}</div>}
                </div>
              )))}
            {busy && <div className="bubble bot"><span className="spinner" /></div>}
            <div ref={end} />
          </div>
          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How many leads did we get this month?" aria-label="Ask a question" autoFocus />
            <button className="btn primary" disabled={busy || !q.trim()} aria-label="Send">Send</button>
          </form>
        </div>
      )}
    </>
  );
}
