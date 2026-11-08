// "Report" under an AI result: flags it wrong, unsafe or poor. Agentify reviews these in the console (AI > Reported AI answers).
import { useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

export default function ReportButton({ feature, prompt, output }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const send = async () => {
    const note = window.prompt('What is wrong with this result? (optional)', '');
    if (note === null) return;
    try { await api.post('/api/creative/report', { feature, prompt, output, note }); setDone(true); toast('Thank you. We will review it.'); } catch (e) { toast(e.message, 'err'); }
  };
  return <button className="btn sm" onClick={send} disabled={done} data-tour="creative-report">{done ? 'Reported' : 'Report'}</button>;
}
