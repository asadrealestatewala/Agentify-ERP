import { Router } from 'express';
import { all, run } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { ask } from '../services/assistant.js';
import { askAi, limited, friendlyLead } from '../services/askAi.js';
import { groqReady, groqTranscribe } from '../services/groqGateway.js';
import { createReport } from '../services/aiReports.js';
import { currentTenant } from '../context.js';
import { tenantDataStatus } from '../services/freellmGateway.js';
import { sendPdf } from '../services/pdf.js';
import { asyncH, bad, now } from '../util.js';

const r = Router();
r.use(requireStaff);

const plain = (s) => String(s).replace(/\*\*/g, '');

r.post('/ask', asyncH(async (req, res) => {
  const q = String(req.body.question || '').slice(0, 500);
  if (!q.trim()) throw bad('Ask a question');
  // an attached picture (screenshot) is read by a Groq vision model; small JPEG/PNG/WebP only
  const image = req.body.image == null ? null : String(req.body.image);
  if (image && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 1_400_000)) throw bad('That picture is not usable. Use a JPEG, PNG or WebP under 1 MB.');
  let out = image ? { intent: 'unknown', tables: [], suggestions: [], answer: 'I could not read that picture.' } : ask(q, req.user);
  // the fast rules found nothing: let the AI answer from the help guides (follow-ups use the last few turns the browser sends)
  if (out.intent === 'unknown') {
    const ai = await askAi(q, req.body.history, req.user, image);
    if (ai?.refused) out = { ...out, answer: `${out.answer}\n\n_${ai.refused}_` };
    else if (ai) out = { intent: ai.found ? 'ai' : 'unknown', ai: true, tables: [], suggestions: out.suggestions, answer: ai.answer, engine: ai.engine, notes: ai.notes || [], links: ai.links, sources: ai.sources };
  }
  // a live-data answer: add a friendly lead-in; the exact answer and tables stay unchanged below it
  if (!image && out.intent !== 'unknown') { const lead = await friendlyLead(q, out, req.user); if (lead) out = { ...out, friendly: lead }; }
  run('INSERT INTO chat_log(user_id,question,intent,ok,created_at) VALUES(?,?,?,?,?)', req.user.id, q, out.intent, out.intent === 'unknown' ? 0 : 1, now());
  res.json(out);
}));

/** What voice and picture features this server offers (the microphone uses Groq speech-to-text when it is connected). */
r.get('/capabilities', (_req, res) => res.json({ stt: groqReady(), image: groqReady() }));
/** Does this workspace's own switch let its data go to the extra AI provider? Shown to the workspace admin in Settings. */
r.get('/extra-ai', (_req, res) => { const s = tenantDataStatus(currentTenant()?.id); res.json({ on: s.effective, since: s.on ? s.at : null }); });

/** Speech to text for the microphone: { audio: base64, mime, lang } -> { text }. Needs Groq. */
r.post('/transcribe', asyncH(async (req, res) => {
  if (!groqReady()) throw bad('Voice input is not switched on yet.');
  const b = req.body || {};
  const data = String(b.audio || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length < 200 || data.length > 1_500_000) throw bad('The recording is empty or too long. Please speak for up to about a minute.');
  if (limited(`stt-${req.user.id}`)) throw bad('You are asking quickly. Please wait a moment and try again.');
  const mime = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)/.test(String(b.mime)) ? String(b.mime) : 'audio/webm';
  const text = await groqTranscribe({ audio: Buffer.from(data, 'base64'), mime, lang: String(b.lang || '').slice(0, 2).toLowerCase(), tenantId: currentTenant()?.id ?? null, userId: req.user.id });
  res.json({ text: text.slice(0, 500) });
}));

/** Flag an AI-written answer as wrong or unsuitable; Agentify reviews these. */
r.post('/report', asyncH((req, res) => {
  const b = req.body || {};
  const t = currentTenant();
  const out = createReport({ tenantId: t?.id ?? null, tenantName: t?.name ?? null, userName: req.user.name, feature: 'ask_assistant', prompt: b.question, output: b.answer, note: b.note });
  audit(req, 'AI answer reported', 'assistant', out.id, null); res.status(201).json(out);
}));

/** The answer re-computed server-side (never trusting client-supplied data) and rendered as a PDF report. */
r.post('/pdf', asyncH((req, res) => {
  const q = String(req.body.question || '').slice(0, 500);
  if (!q.trim()) throw bad('Ask a question');
  const out = ask(q, req.user);
  if (out.intent === 'denied') throw bad(plain(out.answer));
  audit(req, 'Assistant PDF report', 'assistant', null, q.slice(0, 120));
  const sections = [{ heading: 'Answer', text: plain(out.answer) }, ...out.tables.map((t) => ({ heading: t.title, columns: t.columns, rows: t.rows, totals: t.totals }))];
  sendPdf(res, `report-${out.intent}`, { title: 'ASSISTANT REPORT', subtitle: `Question: ${q}\nRequested by ${req.user.name}`, sections });
}));

/** Unanswered questions — shows administrators where the assistant needs new intents. */
r.get('/log', can('settings', 'view'), (req, res) => {
  res.json({
    unanswered: all('SELECT question, COUNT(*) n, MAX(created_at) last FROM chat_log WHERE ok=0 GROUP BY question ORDER BY n DESC, last DESC LIMIT 50'),
    popular: all('SELECT intent, COUNT(*) n FROM chat_log GROUP BY intent ORDER BY n DESC LIMIT 12'),
  });
});

export default r;
