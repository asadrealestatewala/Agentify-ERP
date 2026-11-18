import { useEffect, useState } from 'react';

/**
 * Launch-notice pop-up (possession, allotment, new services...). Each notice is shown once per visitor and browser:
 * dismissing it remembers its id. The caller supplies the notices and how to build links, so the website and the customer portal share it.
 */
const KEY = 'agentify-seen-notices';
const seen = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const remember = (ids) => { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), ...ids])].slice(-200))); } catch { /* storage blocked: the notice may show again */ } };

export default function NoticePopup({ notices, renderLink, imgSrc = (p) => p }) {
  const [list, setList] = useState([]);
  const [i, setI] = useState(0);
  useEffect(() => { const s = seen(); setList((notices || []).filter((n) => !s.includes(n.id))); setI(0); }, [notices]);
  if (!list.length) return null;
  const n = list[Math.min(i, list.length - 1)];
  const close = () => { remember(list.map((x) => x.id)); setList([]); };
  const next = () => { remember([n.id]); if (i + 1 < list.length) setI(i + 1); else setList([]); };
  return (
    <div role="dialog" aria-modal="true" aria-label={n.title} onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(11,47,42,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', color: '#1d2939', borderRadius: 12, maxWidth: 460, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        {n.image && <img src={imgSrc(n.image)} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block', borderRadius: '12px 12px 0 0' }} />}
        <div style={{ padding: 20 }}>
          <span style={{ display: 'inline-block', background: '#e8f3f1', color: '#0e7c6b', fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 999 }}>{n.kind || 'Notice'}</span>
          <h3 style={{ margin: '10px 0 6px', fontSize: 20 }}>{n.title}</h3>
          {n.body && <p style={{ margin: 0, color: '#475467', whiteSpace: 'pre-line' }}>{n.body}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            {n.link_href && renderLink(n)}
            <button type="button" onClick={next} style={{ border: '1px solid #d0d5dd', background: '#fff', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontWeight: 600 }}>{i + 1 < list.length ? 'Next notice' : 'Close'}</button>
            {list.length > 1 && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#667085' }}>{i + 1} of {list.length}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
