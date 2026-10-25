import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { FileUploader } from './Uploaders.jsx';
import { Modal } from './ui.jsx';

export const EDITOR_FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather', 'DM Sans', 'Manrope', 'Raleway', 'Work Sans', 'Source Sans 3', 'Georgia', 'Times New Roman', 'Arial', 'Courier New'];
const SIZES = [['12px', 'Small'], ['14px', '14'], ['16px', 'Normal'], ['18px', '18'], ['20px', 'Large'], ['24px', 'X-large'], ['28px', '28'], ['32px', 'Huge'], ['40px', 'Display']];
const PALETTE = ['#111827', '#0f766e', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#1d4ed8', '#7e22ce', '#6b7280', '#ffffff'];
const HIGHLIGHTS = ['#fff3a3', '#d1fae5', '#fde2e2', '#dbeafe', '#ede9fe', '#ffe4c7'];
const imgSrc = (p) => (!p ? '' : /^(https?:|\/)/.test(p) ? p : `/uploads/${p}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Old posts were written in a tiny markdown; open them in the editor as HTML. */
export function mdToHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return String(text || '').replace(/\r/g, '').split(/\n{2,}/).filter((b) => b.trim()).map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^#{1,3}\s/.test(b)) return `<h${b.match(/^#+/)[0].length + 1}>${inline(b.replace(/^#+\s*/, ''))}</h${b.match(/^#+/)[0].length + 1}>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
export const looksHtml = (s) => /<\/?(p|h[1-6]|div|ul|ol|figure|img|blockquote|strong|em|span|br)\b/i.test(String(s || ''));
export const textOf = (html) => { const d = new DOMParser().parseFromString(html || '', 'text/html').body; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }; // inert: nothing in the text runs or loads

const Btn = ({ title, on, active, children, ...p }) => <button type="button" className={`rte-btn ${active ? 'on' : ''}`} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={on} {...p}>{children}</button>;

/**
 * WYSIWYG editor used for blog articles and website text blocks.
 * Headings, fonts, sizes, colours, highlights, alignment, lists, quotes, callouts, dividers, links,
 * and images (upload, library, drag & drop, paste) with alt text, captions, size and alignment.
 */
export default function RichEditor({ value, onChange, minHeight = 380, onStats }) {
  const toast = useToast();
  const box = useRef(null);
  const saved = useRef(null);
  const first = useRef(true);
  const lastEmit = useRef(null);
  const [img, setImg] = useState(null);
  const [lib, setLib] = useState(null); // null = closed
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [stats, setStats] = useState({ words: 0, min: 1 });

  const initial = useMemo(() => (looksHtml(value) ? value : mdToHtml(value)), []); // eslint-disable-line
  useEffect(() => { if (box.current && first.current) { box.current.innerHTML = initial; first.current = false; refresh(false); } }, []); // eslint-disable-line

  const refresh = useCallback((emit = true) => {
    const el = box.current; if (!el) return;
    const words = (textOf(el.innerHTML).match(/[\w؀-ۿ'’-]+/g) || []).length;
    const s = { words, min: Math.max(1, Math.round(words / 210)) };
    setStats(s); onStats?.(s);
    if (emit) { lastEmit.current = el.innerHTML; onChange?.(el.innerHTML); }
  }, [onChange, onStats]);
  // another section / article was loaded into this editor
  useEffect(() => {
    if (first.current || !box.current || value === lastEmit.current) return;
    box.current.innerHTML = looksHtml(value) ? value : mdToHtml(value); lastEmit.current = value; refresh(false);
  }, [value]); // eslint-disable-line

  const remember = () => { const s = window.getSelection(); if (s.rangeCount && box.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { box.current?.focus(); const s = window.getSelection(); if (saved.current) { s.removeAllRanges(); s.addRange(saved.current); } };
  useEffect(() => { const h = () => remember(); document.addEventListener('selectionchange', h); return () => document.removeEventListener('selectionchange', h); }, []);

  const exec = (cmd, val) => { restore(); document.execCommand('styleWithCSS', false, true); document.execCommand(cmd, false, val); refresh(); };
  const wrapStyle = (prop, val) => {
    restore();
    const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) { toast('Select some text first', 'err'); return; }
    const r = s.getRangeAt(0); const span = document.createElement('span'); span.style[prop] = val;
    span.appendChild(r.extractContents()); r.insertNode(span);
    s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(span); s.addRange(nr);
    refresh();
  };
  const block = (tag) => exec('formatBlock', `<${tag}>`);
  const currentBlock = () => { let n = saved.current?.startContainer; while (n && n !== box.current) { if (n.nodeType === 1 && /^(P|DIV|H2|H3|H4|BLOCKQUOTE|LI)$/.test(n.tagName)) return n; n = n.parentNode; } return null; };
  const callout = (cls) => { restore(); const b = currentBlock(); if (!b) return; ['callout', 'callout-tip', 'callout-warn'].forEach((c) => b.classList.remove(c)); if (cls) b.classList.add('callout', ...(cls === 'callout' ? [] : [cls])); refresh(); };
  const lead = () => { restore(); const b = currentBlock(); if (b) { b.classList.toggle('lead'); refresh(); } };

  // ---- images
  const figureHtml = (path, alt = '', caption = '') => `<figure class="img-center"><img src="${esc(imgSrc(path))}" alt="${esc(alt)}"><figcaption>${esc(caption) || 'Add a caption'}</figcaption></figure><p><br></p>`;
  const insertImages = (paths, at) => {
    box.current.focus();
    if (at) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(at); } else restore();
    document.execCommand('insertHTML', false, paths.map((p) => figureHtml(p)).join(''));
    refresh();
  };
  const uploadFiles = async (files, at) => {
    const imgs = files.filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return toast('Only image files can be added', 'err');
    setBusy(true);
    try { const fd = new FormData(); imgs.forEach((f) => fd.append('files', f)); const r = await api.upload('/api/site-admin/media', fd); insertImages(r.map((x) => x.path), at); toast(`${r.length} image${r.length > 1 ? 's' : ''} added — click an image to set its description (alt text)`, 'ok'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const openLib = async () => { remember(); setPicked([]); setLib(await api.get('/api/site-admin/media').catch(() => [])); };
  const caretAt = (e) => { const r = document.caretRangeFromPoint?.(e.clientX, e.clientY); return r && box.current.contains(r.startContainer) ? r : null; };
  const onDrop = (e) => { const files = [...(e.dataTransfer?.files || [])]; if (files.length) { e.preventDefault(); uploadFiles(files, caretAt(e)); } else setTimeout(() => refresh(), 0); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); uploadFiles(files); return; }
    const t = e.clipboardData?.getData('text/plain'); // paste as clean text: no foreign fonts or colours from Word / web pages
    if (t != null && !e.clipboardData.types.includes('text/html')) return;
    e.preventDefault(); document.execCommand('insertText', false, t);
  };

  // ---- selected image panel
  const onClick = (e) => { const t = e.target; if (t.tagName === 'IMG') setImg(t); else setImg(null); };
  const fig = img?.closest('figure');
  const setClass = (group, cls) => { const el = fig || img; group.forEach((c) => el.classList.remove(c)); if (cls) el.classList.add(cls); refresh(); setImg(img); };
  const caption = () => fig?.querySelector('figcaption')?.textContent ?? '';
  const setCaption = (v) => { if (!fig) return; let c = fig.querySelector('figcaption'); if (!c) { c = document.createElement('figcaption'); fig.appendChild(c); } c.textContent = v; refresh(); };
  const removeImg = () => { (fig || img).remove(); setImg(null); refresh(); };
  const has = (cls) => (fig || img)?.classList.contains(cls);

  const applyLink = () => { restore(); if (link?.url) { const url = /^(https?:|\/|mailto:|tel:|#)/.test(link.url) ? link.url : `https://${link.url}`; document.execCommand('createLink', false, url); refresh(); } setLink(null); };

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Text formatting">
        <select className="rte-sel" title="Paragraph style" defaultValue="" onMouseDown={remember} onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v === 'callout' || v === 'callout-tip' || v === 'callout-warn') { block('p'); callout(v); } else if (v === 'lead') lead(); else block(v); }}>
          <option value="" disabled>Style</option><option value="p">Paragraph</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="blockquote">Quote</option><option value="lead">Intro paragraph (larger)</option><option value="callout">Highlight box</option><option value="callout-tip">Tip box</option><option value="callout-warn">Warning box</option>
        </select>
        <select className="rte-sel" title="Font" defaultValue="" onMouseDown={remember} onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) wrapStyle('fontFamily', `'${v}'`); }}>
          <option value="" disabled>Font</option>{EDITOR_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select className="rte-sel narrow" title="Text size" defaultValue="" onMouseDown={remember} onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) wrapStyle('fontSize', v); }}>
          <option value="" disabled>Size</option>{SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="rte-sep" />
        <Btn title="Bold (Ctrl+B)" on={() => exec('bold')}><b>B</b></Btn><Btn title="Italic (Ctrl+I)" on={() => exec('italic')}><i>I</i></Btn><Btn title="Underline (Ctrl+U)" on={() => exec('underline')}><u>U</u></Btn><Btn title="Strikethrough" on={() => exec('strikeThrough')}><s>S</s></Btn>
        <span className="rte-sep" />
        <span className="rte-pop"><Btn title="Text colour" on={() => {}}><span style={{ borderBottom: '3px solid #b91c1c', lineHeight: 1 }}>A</span></Btn>
          <span className="rte-menu">{PALETTE.map((c) => <button type="button" key={c} className="rte-sw" style={{ background: c }} aria-label={`Colour ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapStyle('color', c)} />)}</span></span>
        <span className="rte-pop"><Btn title="Highlight" on={() => {}}><span style={{ background: '#fff3a3', padding: '0 3px' }}>ab</span></Btn>
          <span className="rte-menu">{HIGHLIGHTS.map((c) => <button type="button" key={c} className="rte-sw" style={{ background: c }} aria-label={`Highlight ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => wrapStyle('backgroundColor', c)} />)}</span></span>
        <span className="rte-sep" />
        <Btn title="Align left" on={() => exec('justifyLeft')}>⯇</Btn><Btn title="Centre" on={() => exec('justifyCenter')}>≡</Btn><Btn title="Align right" on={() => exec('justifyRight')}>⯈</Btn><Btn title="Justify" on={() => exec('justifyFull')}>☰</Btn>
        <span className="rte-sep" />
        <Btn title="Bulleted list" on={() => exec('insertUnorderedList')}>• List</Btn><Btn title="Numbered list" on={() => exec('insertOrderedList')}>1. List</Btn><Btn title="Divider line" on={() => exec('insertHorizontalRule')}>—</Btn>
        <span className="rte-sep" />
        <Btn title="Add a link" on={() => { remember(); setLink({ url: '' }); }}>🔗</Btn><Btn title="Remove link" on={() => exec('unlink')}>⛓</Btn>
        <Btn title="Insert images (upload, library or drag & drop)" on={openLib}>🖼 Images</Btn>
        <span className="rte-sep" />
        <Btn title="Undo" on={() => exec('undo')}>↶</Btn><Btn title="Redo" on={() => exec('redo')}>↷</Btn><Btn title="Clear formatting" on={() => exec('removeFormat')}>Tx</Btn>
      </div>
      {link && <div className="rte-link"><input className="input" autoFocus placeholder="https://… or /site/properties" value={link.url} onChange={(e) => setLink({ url: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLink(null); }} /><button type="button" className="btn sm primary" onClick={applyLink}>Add link</button><button type="button" className="btn sm" onClick={() => setLink(null)}>Cancel</button></div>}
      {img && (
        <div className="rte-img">
          <b>Image</b>
          <input className="input" placeholder="Describe the image (alt text — helps SEO & accessibility)" defaultValue={img.getAttribute('alt') || ''} key={img.src} onChange={(e) => { img.setAttribute('alt', e.target.value); refresh(); }} />
          {fig && <input className="input" placeholder="Caption (optional)" defaultValue={caption()} onChange={(e) => setCaption(e.target.value)} />}
          <div className="rte-img-row">
            <span>Size</span>{[['img-sm', 'S'], ['img-md', 'M'], ['img-lg', 'L'], ['img-full', 'Full']].map(([c, l]) => <button type="button" key={c} className={`rte-btn ${has(c) ? 'on' : ''}`} onClick={() => setClass(['img-sm', 'img-md', 'img-lg', 'img-full'], has(c) ? '' : c)}>{l}</button>)}
            <span>Align</span>{[['img-left', 'Left'], ['img-center', 'Centre'], ['img-right', 'Right']].map(([c, l]) => <button type="button" key={c} className={`rte-btn ${has(c) ? 'on' : ''}`} onClick={() => setClass(['img-left', 'img-center', 'img-right'], c)}>{l}</button>)}
            <button type="button" className="btn sm ghost danger" onClick={removeImg}>Remove</button>
          </div>
        </div>
      )}
      <div ref={box} className="rte-area rich" style={{ minHeight }} contentEditable suppressContentEditableWarning spellCheck
        onInput={() => refresh()} onBlur={() => refresh()} onClick={onClick} onDrop={onDrop} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} data-placeholder="Start writing… drag & drop images here, or use the toolbar." />
      <div className="rte-foot"><span>{stats.words} words · about {stats.min} min read</span><span>{busy ? 'Uploading images…' : 'Tip: drag photos straight into the article — click an image to edit its details'}</span></div>

      {lib && (
        <Modal title="Insert images" size="lg" onClose={() => setLib(null)} footer={<><button className="btn" onClick={() => setLib(null)}>Cancel</button><button className="btn primary" disabled={!picked.length} onClick={() => { insertImages(picked); setLib(null); }}>Insert {picked.length || ''} image{picked.length === 1 ? '' : 's'}</button></>}>
          <div className="stack">
            <FileUploader multiple accept="image/*" busy={busy} label="Drop images here or click to upload (several at once)" hint="JPG, PNG, WebP — up to 10 MB each" onFiles={async (files) => { setLib(null); await uploadFiles(files, saved.current); }} />
            <div className="thumbs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
              {lib.map((m) => { const on = picked.includes(m.path); return (
                <button type="button" key={m.id} className={`thumb ${on ? 'cover' : ''}`} style={{ padding: 0, border: on ? '2px solid var(--primary)' : '1px solid var(--border-2)', borderRadius: 8, overflow: 'hidden', background: 'none', cursor: 'pointer', position: 'relative' }} onClick={() => setPicked(on ? picked.filter((p) => p !== m.path) : [...picked, m.path])} title={m.caption}>
                  <img src={imgSrc(m.path)} alt={m.caption || ''} style={{ width: '100%', height: 84, objectFit: 'cover', display: 'block' }} />{on && <span style={{ position: 'absolute', top: 4, right: 4, background: 'var(--primary)', color: '#fff', borderRadius: 99, width: 20, height: 20, fontSize: 12, display: 'grid', placeItems: 'center' }}>{picked.indexOf(m.path) + 1}</span>}
                </button>); })}
            </div>
            {!lib.length && <div className="muted">No images in the library yet — upload some above.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
