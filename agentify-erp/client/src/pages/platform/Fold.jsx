// Expandable card for the Super Admin console: the header always shows a one-line summary and a status colour;
// the detail (forms, long tables) opens only when the card is clicked. Nothing here changes brand colours.
import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

/**
 * tone: 'ok' (green) | 'warn' (amber) | 'bad' (red) | 'info' (blue) | undefined (neutral teal accent)
 * The card remembers its open state for the session under `id` (or the title text) so it does not snap shut on a refresh.
 */
export function FoldCard({ title, summary, tone, defaultOpen = false, actions, flush, id, children }) {
  const key = `fold:${id || (typeof title === 'string' ? title : '')}`;
  const [open, setOpen] = useState(() => {
    try { const v = sessionStorage.getItem(key); if (v === '1') return true; if (v === '0') return false; } catch { /* ignore */ }
    return defaultOpen;
  });
  const toggle = () => { const n = !open; setOpen(n); try { if (id || typeof title === 'string') sessionStorage.setItem(key, n ? '1' : '0'); } catch { /* ignore */ } };
  return (
    <section className={`card pa-fold ${tone ? `tone-${tone}` : ''} ${open ? 'open' : ''}`}>
      <div className="pa-fold-h">
        <button type="button" className="pa-fold-btn" aria-expanded={open} onClick={toggle}>
          <span className="pa-fold-text"><span className="pa-fold-title">{title}</span>{summary && <span className="pa-fold-sum">{summary}</span>}</span>
          <span className="pa-fold-hint">{open ? 'Hide' : 'Show details'}<IconChevronDown size={16} aria-hidden="true" className="pa-fold-caret" /></span>
        </button>
        {actions && <div className="row pa-fold-actions">{actions}</div>}
      </div>
      {open && <div className={`card-b pa-fold-body ${flush ? 'flush' : ''}`}>{children}</div>}
    </section>
  );
}

/** A small coloured status pill for card summaries. */
export function Dot({ tone = 'ok', children }) {
  return <span className={`pa-dot tone-${tone}`}>{children}</span>;
}
