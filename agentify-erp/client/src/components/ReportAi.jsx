// "Report this answer": sends an AI suggestion the person is unhappy with to the platform team's review queue. Only the text shown
// here and the reason are sent. Small, inline and optional: it never blocks using or editing the suggestion.
import { useState } from 'react';
import { Field, Select } from './ui.jsx';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { useToast } from '../context.jsx';

const reasons = () => ({
  wrong: t('ai_report.wrong', 'Wrong or made-up facts'), unsafe: t('ai_report.unsafe', 'Offensive or unsafe'), misleading: t('ai_report.misleading', 'Misleading claim'),
  off_brand: t('ai_report.off_brand', 'Off-brand or poor wording'), other: t('ai_report.other', 'Something else'),
});

export default function ReportAi({ feature, output }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState('wrong');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (done) return <span className="muted" style={{ fontSize: 12 }}>{t('ai_report.thanks', 'Thanks, we will review it.')}</span>;
  if (!open) return <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>{t('ai_report.open', 'Report this suggestion')}</button>;
  const send = async () => {
    setBusy(true);
    try { await api.post('/api/ai-flags', { feature, output, reason, note }); setDone(true); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 10, marginTop: 8 }}>
      <Field label={t('ai_report.what', 'What is wrong?')}><Select allowEmpty={false} value={reason} onChange={setReason} options={Object.entries(reasons()).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label={t('ai_report.note', 'Anything to add? (optional)')}><textarea className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="muted" style={{ fontSize: 12 }}>{t('ai_report.privacy', 'The suggestion text and your reason are sent to the Agentify team. Nothing else from your workspace is shared.')}</div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}><button type="button" className="btn sm" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</button><button type="button" className="btn sm primary" disabled={busy} onClick={send}>{t('ai_report.send', 'Send report')}</button></div>
    </div>
  );
}
