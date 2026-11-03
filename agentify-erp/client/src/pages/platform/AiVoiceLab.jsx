// Console: reel video tools. (1) Is ffmpeg installed on this server? (2) Voice test lab: try one Punjabi line through both reel voice
// paths and listen, before Punjabi is offered to any workspace. Platform-only; nothing is saved.
import { useEffect, useRef, useState } from 'react';
import { Card, ErrorBox } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A } from './AdminShell.jsx';

export function FfmpegStatus({ ffmpeg }) {
  if (!ffmpeg) return null;
  return (
    <Card title="Reel video tools">
      <p style={{ margin: 0 }}>
        <span className={`pill ${ffmpeg.available ? 'green' : 'amber'}`}>{ffmpeg.available ? 'ffmpeg ready' : 'ffmpeg missing'}</span>{' '}
        {ffmpeg.available ? `${ffmpeg.version}. Reels can be 8, 16 or 24 seconds with the voice inside the video.` : ffmpeg.message}
      </p>
      {!ffmpeg.available && <p className="muted" style={{ marginBottom: 0 }}>To install it, run as root on the server: <code>apt-get update &amp;&amp; apt-get install -y ffmpeg</code>, then restart the app. The next deploy also installs it automatically.</p>}
    </Card>
  );
}

export default function AiVoiceLab({ can }) {
  const toast = useToast();
  const [info, setInfo] = useState(null); const [err, setErr] = useState('');
  const [voice, setVoice] = useState(''); const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); const [clip, setClip] = useState(null); const [confirm, setConfirm] = useState(false);
  const timer = useRef(null);
  useEffect(() => { api.get(`${A}/ai/lab/voices`).then((d) => { setInfo(d); setVoice(d.voices[0]?.name || ''); }).catch((e) => setErr(e.message)); return () => clearInterval(timer.current); }, []);

  const hear = async () => {
    setBusy('voice');
    try { const r = await api.post(`${A}/ai/lab/voice`, { language: 'punjabi', text, voice }); await new Audio(`data:${r.mime};base64,${r.audio}`).play(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const poll = (operation) => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const s = await api.get(`${A}/ai/lab/clip?operation=${encodeURIComponent(operation)}`);
        if (!s.done) return;
        clearInterval(timer.current); setBusy('');
        if (s.error) toast(s.error, 'err'); else setClip(`data:${s.mime};base64,${s.video}`);
      } catch (e) { clearInterval(timer.current); setBusy(''); toast(e.message, 'err'); }
    }, 10000);
  };
  const speak = async () => {
    setBusy('clip'); setConfirm(false); setClip(null);
    try { const r = await api.post(`${A}/ai/lab/clip`, { language: 'punjabi', text, accept: true }); toast('Started. This takes a few minutes.'); poll(r.operation); }
    catch (e) { toast(e.message, 'err'); setBusy(''); }
  };
  const c = info?.clip;
  return (
    <Card title="Voice test lab: Punjabi (hidden from workspaces)">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>Workspaces only see English and Urdu. Try one short Punjabi line here before deciding. Nothing is saved, and the cost is charged to Agentify.</p>
      {info && (
        <>
          {info.note && <p><span className="pill amber">Path B</span> {info.note}</p>}
          <label className="field"><span>One line of Punjabi (up to 200 characters)</span>
            <textarea className="input" rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the line here" /></label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <select className="input" style={{ maxWidth: 320 }} value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!info.voices.length}>
              {info.voices.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
            </select>
            <button className="btn" disabled={!can || !info.voices.length || text.trim().length < 3 || !!busy} onClick={hear}>{busy === 'voice' ? 'Making…' : 'Hear it: exact script path'}</button>
            {!confirm
              ? <button className="btn" disabled={!can || text.trim().length < 3 || !!busy} onClick={() => setConfirm(true)}>Test: Veo speaks…</button>
              : <><button className="btn primary" onClick={speak}>Yes, spend about ${(c?.usd ?? 0).toFixed(2)} on one 8-second clip</button><button className="btn" onClick={() => setConfirm(false)}>Cancel</button></>}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Exact script path: Veo makes a silent-style video and Azure reads your line, so the video does not depend on language and listening to the voice is enough. Veo-speaks path: one real 8-second clip, about ${(c?.usd ?? 0).toFixed(2)}.</p>
          {busy === 'clip' && <p><span className="pill amber">Making the test clip…</span></p>}
          {clip && <video src={clip} controls playsInline style={{ maxWidth: 260, width: '100%', borderRadius: 6, background: '#000' }} />}
        </>)}
    </Card>
  );
}
