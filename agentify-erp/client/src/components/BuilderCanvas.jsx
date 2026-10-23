import { useCallback, useEffect, useRef } from 'react';

const WIDTH = { desktop: '100%', tablet: '768px', mobile: '375px' };

/**
 * The builder canvas: the real website in an iframe sized to the chosen device. Real media queries run inside it, so what you
 * see on "Mobile" is exactly what visitors get. The draft travels by postMessage; clicks, drops and block actions come back.
 */
export default function BuilderCanvas({ config, sections, selected, device, actions, readonly }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const act = useRef(actions);
  act.current = actions;
  const latest = useRef({});
  latest.current = { config, sections, selected, device, readonly: !!readonly };

  const send = useCallback(() => {
    const w = frame.current?.contentWindow; if (!w || !ready.current) return;
    w.postMessage({ t: 'state', ...latest.current }, window.location.origin);
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data || {};
      if (m.t === 'ready') { ready.current = true; send(); } else act.current[m.t]?.(m);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [send]);

  useEffect(() => { const id = setTimeout(send, 60); return () => clearTimeout(id); }, [config, sections, selected, device, readonly, send]);

  return (
    <div className="bc-wrap">
      <div className={`bc-device ${device}`} style={{ width: WIDTH[device] }}>
        <iframe ref={frame} title="Website canvas" src="/site/__editor" className="bc-frame" onLoad={() => { ready.current = false; }} />
      </div>
      <div className="bc-size">{device === 'desktop' ? 'Desktop · full width' : device === 'tablet' ? 'Tablet · 768 px' : 'Mobile · 375 px'}</div>
    </div>
  );
}
