// Editable wording on the landing page. <T k="hero.cta1" /> shows the saved text for that key (the visitor's country first, then the
// general text, then the built-in wording). Inside the console's landing editor the same text becomes click-to-edit and reports
// the change to the editor; on the public page it is plain text, with no extra markup.
import { createContext, useContext } from 'react';
import { COPY_DEFAULTS } from '../../../../shared/landingCopy.js';

export const CopyCtx = createContext({ copy: {}, cc: '', editor: null });

export function T({ k, as: Tag = 'span', fallback = '' }) {
  const { copy, cc, editor } = useContext(CopyCtx);
  const saved = copy?.[`${k}@${cc}`] ?? copy?.[k];
  const val = saved ?? (COPY_DEFAULTS[k] || fallback);
  if (!editor) return <>{val}</>;
  const commit = (el) => {
    const v = el.innerText.replace(/ /g, ' ').replace(/\s*\n+\s*/g, ' ').trim();
    if (v !== String(val)) editor.post({ t: 'copy', k, value: v, cc });
    else el.innerText = val;
  };
  return (
    <Tag className="sb-inl" contentEditable suppressContentEditableWarning spellCheck data-ph="Click to write" data-copy={k}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.currentTarget.innerText = val; e.currentTarget.blur(); } }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n+\s*/g, ' ')); }}
      onDrop={(e) => e.preventDefault()} onBlur={(e) => commit(e.currentTarget)}>{val}</Tag>
  );
}
