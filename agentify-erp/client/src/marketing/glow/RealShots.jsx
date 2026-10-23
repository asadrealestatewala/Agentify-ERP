// Real screens of the running Agentify ERP, captured from its demo workspaces (scripts/capture-marketing-screens.mjs),
// one set per country so currency, dates and formats match the market. Nothing here is a mock-up: every image is the
// application's own interface. A demo workspace holds sample records, which is why each screen is labelled as such.
import { useState } from 'react';

export const shotUrl = (kind, code) => `/marketing/m-re-${kind}-${String(code).toLowerCase()}.webp`;

/** A desktop screen of the app. */
export function Screen({ kind, code, alt, eager, className = '' }) {
  return <img className={`gx-screen ${className}`} src={shotUrl(kind, code)} width="2200" height="1480" alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
}

const PHONE = [['mob-leads', 'Leads'], ['mob-client', 'Client'], ['mob-tasks', 'Tasks']];

/** The phone layout of the app inside a device frame; the buttons switch between three real phone screens. */
export function PhoneShot({ code, compact }) {
  const [i, setI] = useState(0);
  const [kind, label] = PHONE[i];
  return (
    <div className={`gx-phoneshot ${compact ? 'compact' : ''}`}>
      <div className="gx-phone">
        <img src={shotUrl(kind, code)} width="780" height="1688" alt={`The ${label} screen of the Agentify ERP phone layout, from a demo workspace`} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </div>
      {!compact && (
        <div className="gx-phone-tabs" role="group" aria-label="Phone screens">
          {PHONE.map(([k, l], n) => <button key={k} type="button" className={n === i ? 'on' : ''} aria-pressed={n === i} onClick={() => setI(n)}>{l}</button>)}
        </div>
      )}
    </div>
  );
}
