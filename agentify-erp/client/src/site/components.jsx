import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CalculatorTabs } from './ConstructionTools.jsx';
import { useMemo } from 'react';
import { Markdown, imgUrl, isInternal, priceText, useSite, waLink, MoneyBox, curCode, siteCopy, isPK, exampleAmount } from './siteCore.jsx';
import { safeId, sectionCss } from '../../../shared/sectionStyle.js';
import { DEMO_AGENTS, DEMO_LISTINGS, DEMO_POSTS } from './demoContent.js';

/**
 * Inline editing. On the editor canvas each section is wrapped in this context; <Ed> then renders its text as an editable element
 * (click, type, press Enter or click away) and reports the change to the editor. On the public website there is no context and
 * <Ed> is plain text, so visitors get nothing extra.
 */
export const EditCtx = createContext(null);
export const useEditing = () => !!useContext(EditCtx);
/** Set by the website studio's canvas so blocks that hide themselves when empty stay visible (and selectable) while editing. */
export const ShowEmptyCtx = createContext(false);
/** On the editor canvas and in theme previews, data blocks with nothing to show yet fill with labelled sample cards. Visitors never see them. */
const useSamples = () => useContext(ShowEmptyCtx);
const SampleNote = ({ what }) => <p className="sample-note">Sample {what} for the preview. Your real {what} appear here automatically once you add them in the ERP; visitors never see these samples.</p>;
export const postToEditor = (m) => window.parent.postMessage(m, window.location.origin);
export function Ed({ as: Tag = 'span', value, path, className, children, ...rest }) {
  const ctx = useContext(EditCtx);
  const text = value ?? '';
  if (!ctx) return <Tag className={className} {...rest}>{children ?? text}</Tag>;
  const commit = (el) => {
    const v = el.innerText.replace(/\u00a0/g, ' ').replace(/\s*\n+\s*/g, ' ').trim();
    if (v !== String(text)) ctx.post({ t: 'edit', id: ctx.sid, path, value: v });
    else el.innerText = text; // normalise stray markup after typing
  };
  return (
    <Tag {...rest} className={`${className || ''} sb-inl`} contentEditable suppressContentEditableWarning spellCheck data-ph="Click to write" data-path={path}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.currentTarget.innerText = text; e.currentTarget.blur(); } }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n+\s*/g, ' ')); }}
      onDrop={(e) => e.preventDefault()} onBlur={(e) => commit(e.currentTarget)}>{text}</Tag>
  );
}

const LINK_OK = /^(https?:\/\/[^\s]+|\/[^\s]*|#[^\s]*|mailto:[^\s]+|tel:[^\s]+)$/i;
const escH = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mdInline = (v) => escH(v).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:|tel:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
/** Older text is written in a tiny markdown; turn it into HTML once so it can be edited like any other text. */
function mdToHtml(text) {
  return String(text || '').replace(/\r/g, '').split(/\n{2,}/).filter((b) => b.trim()).map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${mdInline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^#{1,3}\s/.test(b)) { const lvl = Math.min(3, b.match(/^#+/)[0].length + 1); return `<h${lvl}>${mdInline(b.replace(/^#+\s*/, ''))}</h${lvl}>`; }
    return `<p>${lines.map(mdInline).join('<br>')}</p>`;
  }).join('');
}
const RICH_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'H2', 'H3', 'BLOCKQUOTE']);
/** What the editor keeps from typed or pasted rich text: a short list of tags, safe links only. The server cleans it again on save. */
function cleanRich(root) {
  const out = document.createElement('div');
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG'].includes(tag)) return;
      if (tag === 'DIV') { const p = document.createElement('p'); dst.appendChild(p); walk(n, p); return; }
      if (!RICH_TAGS.has(tag)) { walk(n, dst); return; }
      const el = document.createElement(tag.toLowerCase());
      if (tag === 'A') { const h = n.getAttribute('href') || ''; if (!LINK_OK.test(h)) { walk(n, dst); return; } el.setAttribute('href', h); if (/^https?:/i.test(h)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } }
      dst.appendChild(el); walk(n, el);
    });
  };
  walk(root, out);
  let html = out.innerHTML.replace(/<p>(\s|<br>)*<\/p>/g, '').trim();
  if (html && !/<(p|ul|ol|h2|h3|blockquote)\b/i.test(html)) html = `<p>${html}</p>`;
  return html;
}
/** Longer text (paragraphs, lists, links) edited in place, with a small toolbar while it has focus. */
export function EdRich({ value, path }) {
  const ctx = useContext(EditCtx);
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  if (!ctx) return <Markdown text={value} />;
  const isHtml = /<\/?(p|h[2-4]|div|ul|ol|figure|img|blockquote|strong|em|span|br)\b/i.test(String(value || ''));
  // parsed in an inert document: nothing in stored text (an <img onerror>, a script) runs or loads while it is cleaned
  const tmp = new DOMParser().parseFromString(isHtml ? String(value) : mdToHtml(value), 'text/html').body;
  const html = cleanRich(tmp);
  const commit = () => { const v = cleanRich(ref.current); if (v !== html) ctx.post({ t: 'edit', id: ctx.sid, path, value: v }); };
  const cmd = (c, arg) => { ref.current.focus(); document.execCommand(c, false, arg); };
  const link = () => {
    const sel = window.getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const u = window.prompt('Link address (https://…, /site/…, mailto:…, tel:…)');
    ref.current.focus(); if (range) { sel.removeAllRanges(); sel.addRange(range); }
    if (u && LINK_OK.test(u.trim())) document.execCommand('createLink', false, u.trim());
  };
  const B = ({ c, arg, t, children, onClick }) => <button type="button" title={t} aria-label={t} onMouseDown={(e) => e.preventDefault()} onClick={onClick || (() => cmd(c, arg))}>{children}</button>;
  return (
    <div className="sb-richwrap">
      {on && (
        <div className="sb-rtb" role="toolbar" aria-label="Text formatting" onClick={(e) => e.stopPropagation()}>
          <B c="bold" t="Bold"><b>B</b></B><B c="italic" t="Italic"><i>I</i></B><B c="underline" t="Underline"><u>U</u></B>
          <B c="formatBlock" arg="h3" t="Heading">H</B><B c="formatBlock" arg="p" t="Paragraph">¶</B>
          <B c="insertUnorderedList" t="Bulleted list">•</B><B c="insertOrderedList" t="Numbered list">1.</B>
          <B t="Add link" onClick={link}>🔗</B><B c="unlink" t="Remove link">⛓</B><B c="removeFormat" t="Clear formatting">✕</B>
        </div>
      )}
      <div ref={ref} className="md rich sb-rich" contentEditable suppressContentEditableWarning spellCheck data-ph="Click to write" onFocus={() => setOn(true)}
        onBlur={() => { setOn(false); commit(); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { ref.current.innerHTML = html; ref.current.blur(); } }}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} onDrop={(e) => e.preventDefault()}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** "Change image" on the canvas: picks a file, uploads it to the website's image library and swaps it in. */
export function ImgBtn({ path, label = 'Change image' }) {
  const ctx = useContext(EditCtx);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('files', file);
      const r = await api.upload('/api/site-admin/media', fd);
      const p = Array.isArray(r) ? r[0]?.path : null;
      if (p) ctx.post({ t: 'edit', id: ctx.sid, path, value: p });
    } catch (e) { window.alert(e.message || 'The image could not be uploaded'); } finally { setBusy(false); }
  };
  return (
    <span className="sb-imgbtn" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Uploading…' : `🖼 ${label}`}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </span>
  );
}
/** "Edit link" next to a button on the canvas. */
export function LinkBtn({ path, value }) {
  const ctx = useContext(EditCtx);
  if (!ctx) return null;
  const edit = (e) => {
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt('Where should this go? (/site/properties, https://…, mailto:…, tel:…). Leave empty for no link.', value || '');
    if (v === null) return;
    const t = v.trim();
    if (t && !LINK_OK.test(t)) { window.alert('Use a link that starts with https://, /, #, mailto: or tel:'); return; }
    ctx.post({ t: 'edit', id: ctx.sid, path, value: t });
  };
  return <button type="button" className="sb-linkbtn" title="Edit the link" aria-label="Edit the link" onClick={edit}>🔗</button>;
}

/** Internal links use the router; external/tel/mailto use a normal anchor. */
const SAFE = /^(https?:\/\/|\/|#|mailto:|tel:)/i;
export const safeHref = (h) => (typeof h === 'string' && SAFE.test(h.trim()) ? h.trim() : '');
/** Sign-in pages belong to the workspace address; on a custom domain (website only) they open there instead. */
const ERP_PATH = /^\/(login|portal|vendor)(\/|$)/;
export function A({ href: raw, children, ...p }) {
  const ws = useSite()?.workspaceUrl;
  let href = safeHref(raw);
  if (ws && ERP_PATH.test(href)) href = `${ws}${href}`;
  if (!href) return <span {...p}>{children}</span>;
  return isInternal(href) ? <Link to={href} {...p}>{children}</Link> : <a href={href} {...(/^https?:/.test(href) ? { target: '_blank', rel: 'noreferrer' } : {})} {...p}>{children}</a>;
}

const usePublic = (url, params) => {
  const [data, setData] = useState(null);
  const key = url + JSON.stringify(params || {});
  useEffect(() => { let off = false; setData(null); if (!url) return undefined; api.get(url, params).then((d) => !off && setData(d)).catch(() => !off && setData({ data: [], error: true })); return () => { off = true; }; /* eslint-disable-next-line */ }, [key]);
  return data;
};
export { usePublic };

export const Placeholder = ({ icon = '🏠', label }) => <div className="ph" aria-hidden="true"><span>{icon}</span>{label && <small>{label}</small>}</div>;

export function Stars() { return <span className="featured-tag">★ Featured</span>; }

export function PropertyCard({ p, onEnquire }) {
  const sold = p.status === 'sold', reserved = p.status === 'reserved';
  return (
    <article className="pcard">
      <Link to={`/site/property/${p.id}`} className="pcard-img" aria-label={p.title}>
        {p.cover ? <img src={imgUrl(p.cover)} alt={p.title} loading="lazy" /> : <Placeholder icon={p.type === 'Plots' ? '🌳' : p.type === 'Shops' || p.type === 'Offices' ? '🏢' : '🏠'} />}
        <div className="tags">{p.sample && <span className="tag-sample">Sample</span>}{p.featured && <Stars />}{p.purpose === 'Rent' && <span className="tag-rent">For rent</span>}{sold && <span className="tag-sold">Sold</span>}{reserved && <span className="tag-res">Reserved</span>}{p.ready && <span className="tag-ready">Ready</span>}</div>
        {p.photos > 1 && <span className="photos">📷 {p.photos}</span>}
      </Link>
      <div className="pcard-body">
        <div className="price">{priceText(p.price, p.purpose)}{p.discount > 0 && <small className="was">{priceText(p.total_price)}</small>}</div>
        <Link to={`/site/property/${p.id}`} className="ptitle">{p.title}</Link>
        <div className="ploc">📍 {[p.area_name, p.city].filter(Boolean).join(', ') || p.location || '—'}</div>
        <div className="pfacts">
          {p.area && <span>📐 {p.area} {p.unit}</span>}
          {p.bedrooms != null && <span>🛏 {p.bedrooms}</span>}
          {p.bathrooms != null && <span>🛁 {p.bathrooms}</span>}
          {p.installment && <span className="inst">💳 Installments</span>}
        </div>
        {p.agent && <div className="pagent"><span className="av">{p.agent.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><span className="grow">{p.agent.name}</span>
          {p.agent.phone && <a href={`tel:${p.agent.phone}`} aria-label={`Call ${p.agent.name}`} className="ic">📞</a>}
          {p.agent.whatsapp && <a href={waLink(p.agent.whatsapp, `Hi, I'm interested in ${p.title} (${p.code})`)} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="ic">💬</a>}</div>}
      </div>
    </article>
  );
}

export function AgentCard({ a }) {
  return (
    <div className="acard">
      {a.photo ? <img className="av lg av-img" src={imgUrl(a.photo)} alt="" loading="lazy" /> : <div className="av lg">{a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</div>}
      <h4>{a.name}</h4>
      <div className="muted">{a.role === 'Sales Manager' ? 'Sales manager' : 'Listing agent'} · {a.listings} listing{a.listings === 1 ? '' : 's'}</div>
      <div className="acts">
        {a.phone && <a className="btn-s" href={`tel:${a.phone}`}>📞 Call</a>}
        {a.whatsapp && <a className="btn-s wa" href={waLink(a.whatsapp)} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
        {a.email && <a className="btn-s" href={`mailto:${a.email}`}>✉️ Email</a>}
      </div>
      <Link to={`/site/agent/${a.id}`} className="more">View listings →</Link>
    </div>
  );
}

export function ProjectCard({ p }) {
  return (
    <Link to={`/site/project/${p.id}`} className="jcard">
      <div className="jimg">{p.cover ? <img src={imgUrl(p.cover)} alt={p.name} loading="lazy" /> : <Placeholder icon="🏗️" />}<span className="jstatus">{p.dev_status}</span></div>
      <div className="jbody">
        <h3>{p.name}</h3><div className="muted">📍 {p.location || '—'}</div>
        {p.description && <p>{p.description.slice(0, 110)}{p.description.length > 110 ? '…' : ''}</p>}
        {/* a project without a schedule or development items has no progress figure: show none rather than 0% */}
        {p.progress != null && <div className="jbar"><div style={{ width: `${p.progress}%` }} /></div>}
        {(p.progress != null || p.available > 0) && <div className="jmeta"><span>{p.progress != null ? `${p.progress}% developed` : ''}</span>{p.available > 0 && <b>{p.available} available</b>}</div>}
      </div>
    </Link>
  );
}

export function PostCard({ p }) {
  return (
    <Link to={`/site/blog/${p.slug}`} className="bcard">
      <div className="bimg">{p.cover ? <img src={imgUrl(p.cover)} alt={p.title} loading="lazy" /> : <Placeholder icon="📰" />}</div>
      <div className="bbody"><div className="muted">{(p.published_at || '').slice(0, 10)}</div><h3>{p.title}</h3><p>{p.excerpt}</p><span className="more">Read more →</span></div>
    </Link>
  );
}

/** Zameen-style search: Buy / Rent / Projects tabs with city, type and price. */
export function SearchBox({ initial = {}, onSearch }) {
  const nav = useNavigate();
  const facets = usePublic('/api/site/facets');
  const [tab, setTab] = useState(initial.purpose === 'Rent' ? 'Rent' : 'Buy');
  const [f, setF] = useState({ city: '', type: '', q: '', min_price: '', max_price: '', ...initial });
  const go = (e) => {
    e?.preventDefault();
    if (tab === 'Projects') return nav('/site/projects');
    const p = new URLSearchParams(); p.set('purpose', tab === 'Rent' ? 'Rent' : 'Sell');
    for (const k of ['city', 'type', 'q', 'min_price', 'max_price']) if (f[k]) p.set(k, f[k]);
    nav(`/site/properties?${p}`); onSearch?.();
  };
  return (
    <form className="searchbox" onSubmit={go}>
      <div className="stabs" role="tablist">{['Buy', 'Rent', 'Projects'].map((t) => <button type="button" role="tab" aria-selected={tab === t} key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab !== 'Projects' ? (
        <div className="sfields">
          <label>City<select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}><option value="">All cities</option>{facets?.cities?.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{facets?.types?.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label className="budget">{tab === 'Rent' ? `${isPK() ? 'Monthly rent' : 'Rent'} (${curCode()})` : `Budget (${curCode()})`}<span className="two-in"><MoneyBox value={f.min_price} onChange={(v) => setF({ ...f, min_price: v })} placeholder={`Min  ${exampleAmount(2000000)}`} /><MoneyBox value={f.max_price} onChange={(v) => setF({ ...f, max_price: v })} placeholder={`Max  ${exampleAmount(10000000)}`} /></span></label>
          <label className="grow">Keyword<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={siteCopy('keyword_placeholder', 'Location, project or plot no.')} /></label>
          <button className="btn-p" type="submit">Search</button>
        </div>
      ) : <div className="sfields"><span className="grow">Explore our planned communities, see development progress and available units.</span><button className="btn-p" type="submit">View projects</button></div>}
    </form>
  );
}

/** Lead capture — becomes a CRM contact assigned to the listing agent (or round-robin). */
export function InquiryForm({ propertyId, title = 'Send an enquiry', kind = 'inquiry', agent, compact }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', website: '' });
  const [state, setState] = useState({ busy: false, done: null, err: '' });
  const submit = async (e) => {
    e.preventDefault(); setState({ busy: true, done: null, err: '' });
    try { const r = await api.post('/api/site/inquiry', { ...f, property_id: propertyId, kind }); setState({ busy: false, done: r.reference, err: '' }); setF({ name: '', phone: '', email: '', message: '', website: '' }); }
    catch (er) { setState({ busy: false, done: null, err: er.message }); }
  };
  if (state.done) return <div className="inq ok"><b>Thank you!</b><p>Your message was sent{agent ? ` to ${agent.name}` : ''}. We will contact you shortly. Reference <code>{state.done}</code>.</p></div>;
  return (
    <form className={`inq ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <h4>{title}</h4>
      {state.err && <div className="inq-err" role="alert">{state.err}</div>}
      <input required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
      <input required placeholder="Phone number" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
      <input type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
      <textarea rows={compact ? 3 : 4} placeholder="Message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      <button className="btn-p" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send'}</button>
    </form>
  );
}

// ---------------------------------------------------------------- page sections
const Head = ({ title, subtitle, href, hrefLabel = 'View all →' }) => {
  const ctx = useContext(EditCtx);
  const mine = (k, v) => !!ctx && ctx.props?.[k] === v;
  return (title || subtitle) ? (
    <div className="sec-head"><div>{title && (mine('title', title) ? <Ed as="h2" value={title} path="title" /> : <h2>{title}</h2>)}{subtitle && (mine('subtitle', subtitle) ? <Ed as="p" value={subtitle} path="subtitle" /> : <p>{subtitle}</p>)}</div>{href && <A href={href} className="more">{hrefLabel}</A>}</div>
  ) : null;
};

/** Small contact card for the "headline + enquiry form" hero: the company's phone and email above a short enquiry form (a CRM lead). */
function HeroFormCard({ p }) {
  const { config } = useSite();
  const c = config.contact || {};
  return (
    <div className="hero-card">
      {(c.phone || c.email) && <ul className="hero-card-contact">{c.phone && <li>📞 <a href={`tel:${c.phone}`}>{c.phone}</a></li>}{c.email && <li>✉️ <a href={`mailto:${c.email}`}>{c.email}</a></li>}</ul>}
      <InquiryForm title={p.form_title || 'Talk to an agent'} kind="contact" compact />
    </div>
  );
}

/**
 * Hero layouts: classic (headline over a photo, optional search), search (centred headline with a search panel),
 * form (headline beside an enquiry form) and split (text beside a photo, no overlay). Pages saved before layouts existed
 * have no `variant` and keep the classic look.
 */
function Hero({ p }) {
  const bg = imgUrl(p.image);
  const v = ['search', 'form', 'split'].includes(p.variant) ? p.variant : 'classic';
  const text = (<>
    <Ed as="h1" value={p.headline} path="headline" />{p.subheadline && <Ed as="p" value={p.subheadline} path="subheadline" />}
    {p.cta_label && <A href={p.cta_href} className="btn-p lg"><Ed value={p.cta_label} path="cta_label" /></A>}{p.cta_label && <LinkBtn path="cta_href" value={p.cta_href} />}
  </>);
  const search = p.show_search && <SearchBox initial={p.search_tab === 'Rent' ? { purpose: 'Rent' } : {}} />;
  if (v === 'split') {
    return (
      <section className={`hero-split ${p.height || 'tall'}`}><div className="wrap hs-grid">
        <div className="hs-text">{text}{search}</div>
        <div className="hs-img"><ImgBtn path="image" label="Change image" />{bg ? <img src={bg} alt="" /> : <Placeholder icon="🏡" />}</div>
      </div></section>
    );
  }
  const o = Math.max(0, Math.min(90, Number(p.overlay ?? 55)));
  const shade = v === 'classic' ? `rgba(4,36,34,${o / 100})` : `color-mix(in srgb, var(--s-dark) ${o}%, transparent)`;
  return (
    <section className={`hero ${p.height || 'tall'} hv-${v}${p.align === 'center' || v === 'search' ? ' center' : ''}`} style={bg ? { backgroundImage: `linear-gradient(${shade}, ${shade}), url(${bg})` } : undefined}>
      <ImgBtn path="image" label="Change background" />
      <div className="wrap">
        {v === 'form' ? <div className="hero-cols"><div className="hero-text">{text}</div><HeroFormCard p={p} /></div> : <>{text}{search}</>}
      </div>
    </section>
  );
}

/** Listing cards: the standard card, or "overlay" (title and price over the photo). */
function Listings({ p }) {
  const params = { limit: p.limit || 8, purpose: p.purpose || undefined, featured: p.source === 'featured' ? 1 : undefined, project_id: p.source === 'project' ? p.project_id : undefined, type: p.source === 'type' ? p.property_type : undefined, sort: p.source === 'latest' ? undefined : undefined };
  let d = usePublic('/api/site/listings', params);
  const fallback = usePublic(p.source === 'featured' && d && d.data?.length === 0 ? '/api/site/listings' : null, { limit: p.limit || 8 });
  if (d && p.source === 'featured' && d.data.length === 0 && fallback) d = fallback;
  const samples = useSamples();
  const sample = samples && d && !d.data.length;
  if (sample) d = { data: DEMO_LISTINGS.filter((x) => !p.purpose || x.purpose === p.purpose).concat(DEMO_LISTINGS).slice(0, Number(p.limit) || 8) };
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} subtitle={p.subtitle} href={p.view_all_href} />
      {!d ? <div className="skeleton-row">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div> : !d.data.length ? <p className="muted">No properties to show yet.</p> : (
        <>{sample && <SampleNote what="listings" />}<div className={`${p.layout === 'carousel' ? 'carousel' : 'pgrid'}${p.card === 'overlay' ? ' card-overlay' : ''}${[3, 4].includes(Number(p.columns)) && p.layout !== 'carousel' ? ` cols-${Number(p.columns)}` : ''}`}>{d.data.map((x, i) => <PropertyCard key={`${x.id}-${i}`} p={x} />)}</div></>
      )}
    </div></section>
  );
}

function Projects({ p }) {
  const d = usePublic('/api/site/projects');
  return <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/projects" />{!d ? null : <div className="jgrid">{d.data.slice(0, p.limit || 3).map((x) => <ProjectCard key={x.id} p={x} />)}</div>}</div></section>;
}

const Stats = ({ p }) => <section className="stats"><div className="wrap">{(p.items || []).map((s, i) => <div key={i}><Ed as="b" value={s.value} path={`items.${i}.value`} /><Ed value={s.label} path={`items.${i}.label`} /></div>)}</div></section>;

/** Service cards: plain cards, raised cards with round icons (they overlap the block above on wide screens), or numbered steps. */
const Services = ({ p }) => {
  const v = ['raised', 'steps'].includes(p.variant) ? p.variant : 'cards';
  return (
    <section className={`sec svc-sec svc-${v}${v === 'raised' && p.overlap ? ' overlap' : ''}`}><div className="wrap">{!(v === 'raised' && p.overlap) && <Head title={p.title} subtitle={p.subtitle} />}
      <div className="svc">{(p.items || []).map((s, i) => <A key={i} href={s.href} className="svc-card"><span className="svc-ic">{v === 'steps' ? i + 1 : s.icon}</span><Ed as="h4" value={s.title} path={`items.${i}.title`} /><Ed as="p" value={s.text} path={`items.${i}.text`} />{v === 'raised' && s.href && <span className="svc-more">{p.link_label || 'Learn more'}</span>}<LinkBtn path={`items.${i}.href`} value={s.href} /></A>)}</div></div></section>
  );
};

const Calculators = ({ p }) => <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/calculators" hrefLabel="Open full calculators →" /><CalculatorTabs /></div></section>;

function Agents({ p }) {
  let d = usePublic('/api/site/agents');
  const sample = useSamples() && d && !d.data.length;
  if (sample) d = { data: DEMO_AGENTS };
  if (d && !d.data.length) return null;
  return <section className="sec"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/agents" />{sample && <SampleNote what="agents" />}{d && <div className="agrid">{d.data.slice(0, p.limit || 4).map((a) => <AgentCard key={a.id} a={a} />)}</div>}</div></section>;
}

const Testimonials = ({ p }) => (
  <section className="sec soft"><div className="wrap"><Head title={p.title} />
    <div className="tgrid">{(p.items || []).map((t, i) => ({ ...t, _i: i })).filter((t) => t.quote).map((t) => <figure key={t._i} className="tcard"><blockquote>“<Ed value={t.quote} path={`items.${t._i}.quote`} />”</blockquote><figcaption><span className="av">{(t.name || '?')[0]}</span><div><Ed as="b" value={t.name} path={`items.${t._i}.name`} /><Ed as="small" value={t.role} path={`items.${t._i}.role`} /></div></figcaption></figure>)}</div></div></section>
);

const Partners = ({ p }) => {
  const items = (p.items || []).filter((i) => i.logo);
  if (!items.length) return null;
  return (
    <section className="sec"><div className="wrap"><Head title={p.title} />
      <ul className="plogos">{items.map((i, k) => { const img = <img src={imgUrl(i.logo)} alt={i.name || ''} loading="lazy" />; return <li key={k}>{i.href ? <a href={i.href} target="_blank" rel="noopener noreferrer nofollow" aria-label={i.name || 'Partner'}>{img}</a> : img}</li>; })}</ul>
    </div></section>
  );
};

/** Only video, map and calendar addresses from known hosts become an embedded frame; anything else shows nothing. */
export function embedSrc(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.replace(/^www\./, '');
  const yt = (id) => (id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null);
  if (h === 'youtube.com' || h === 'youtube-nocookie.com') return yt(/^\/(embed|shorts)\//.test(u.pathname) ? u.pathname.split('/')[2] : u.searchParams.get('v'));
  if (h === 'youtu.be') return yt(u.pathname.slice(1));
  if (h === 'vimeo.com' || h === 'player.vimeo.com') { const id = u.pathname.match(/(\d{5,})/)?.[1]; return id ? `https://player.vimeo.com/video/${id}` : null; }
  if (h === 'google.com' && u.pathname.startsWith('/maps/embed')) return u.toString();
  if (h === 'calendly.com') return u.toString();
  if (h === 'openstreetmap.org' && u.pathname.startsWith('/export/embed')) return u.toString();
  return null;
}
const Embed = ({ p }) => {
  const src = embedSrc(p.url);
  if (!src) return null;
  return (
    <section className="sec"><div className="wrap"><Head title={p.title} />
      <div className="embed"><iframe src={src} title={p.title || 'Embedded content'} style={{ height: Math.min(900, Math.max(200, Number(p.height) || 420)) }} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms" /></div>
    </div></section>
  );
};

function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Choose a PNG, JPG or WebP photo'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('The photo could not be read'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That photo could not be opened'));
      img.onload = () => {
        const side = Math.min(img.width, img.height), size = Math.min(256, side), c = document.createElement('canvas'); c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        let out = c.toDataURL('image/webp', 0.82); if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.8);
        resolve(out);
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
/** Approved reviews plus a form so real customers can add theirs; the company approves each one in the editor. */
function Reviews({ p }) {
  const d = usePublic('/api/site/reviews');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', role: '', company: '', rating: 5, quote: '', email: '', consent: false, website: '' });
  const [photo, setPhoto] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const list = (d?.data || []).slice(0, Math.min(30, Math.max(1, Number(p.limit) || 12)));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await api.post('/api/site/reviews', { ...f, photo: photo || undefined }); setDone(true); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} />
      {!!list.length && <div className="tgrid">{list.map((t) => <figure key={t.id} className="tcard">{t.rating ? <div className="rstars" role="img" aria-label={`${t.rating} out of 5 stars`}>{'★'.repeat(t.rating)}<i>{'★'.repeat(5 - t.rating)}</i></div> : null}<blockquote>“{t.quote}”</blockquote><figcaption>{t.photo ? <img className="av" src={t.photo} alt="" width="40" height="40" loading="lazy" /> : <span className="av">{(t.name || '?')[0]}</span>}<div><b>{t.name}</b><small>{[t.role, t.company].filter(Boolean).join(' · ')}</small></div></figcaption></figure>)}</div>}
      <p style={{ textAlign: 'center', margin: '24px 0 0' }}>{!open && !done && <button type="button" className="btn" onClick={() => setOpen(true)}>Share your experience</button>}</p>
      {done && <p className="rthanks" role="status">Thank you. Your review was received and will appear once we have approved it.</p>}
      {open && !done && (
        <form className="rform" onSubmit={submit}>
          {err && <div className="rerr" role="alert">{err}</div>}
          <div className="rrow"><label>Your name<input required value={f.name} onChange={set('name')} maxLength={80} autoComplete="name" /></label><label>Company<input value={f.company} onChange={set('company')} maxLength={120} /></label></div>
          <div className="rrow"><label>Role<input value={f.role} onChange={set('role')} maxLength={80} /></label><label>Rating<select value={f.rating} onChange={(e) => setF((x) => ({ ...x, rating: Number(e.target.value) }))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}</select></label></div>
          <label>Your review<textarea required rows={4} minLength={20} maxLength={600} value={f.quote} onChange={set('quote')} /></label>
          <div className="rrow"><label>Email (never shown)<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label><label>Photo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const file = e.target.files[0]; if (!file) return; try { setPhoto(await shrinkPhoto(file)); } catch (x) { setErr(x.message); } }} /></label></div>
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={f.website} onChange={set('website')} style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
          <label className="rconsent"><input type="checkbox" checked={f.consent} onChange={set('consent')} /> <span>I agree that my review, name, company and photo may be shown on this website.</span></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send my review'}</button>
        </form>
      )}
    </div></section>
  );
}

function Blog({ p }) {
  let d = usePublic('/api/site/posts', { limit: p.limit || 3 });
  const sample = useSamples() && d && !d.data.length;
  if (sample) d = { data: DEMO_POSTS.slice(0, Number(p.limit) || 3) };
  if (d && !d.data.length) return null;
  return <section className="sec"><div className="wrap"><Head title={p.title} href="/site/blog" />{sample && <SampleNote what="articles" />}{d && <div className="bgrid">{d.data.map((x) => <PostCard key={x.id} p={x} />)}</div>}</div></section>;
}

function Cta({ p }) {
  const bg = imgUrl(p.image);
  return (
    <section className={`cta ${p.tone || 'dark'}`} style={bg ? { backgroundImage: `linear-gradient(rgba(4,36,34,.6), rgba(4,36,34,.6)), url(${bg})` } : undefined}>
      <ImgBtn path="image" label="Change background" /><div className="wrap"><Ed as="h2" value={p.headline} path="headline" />{p.text && <Ed as="p" value={p.text} path="text" />}{p.button_label && <A href={p.button_href} className="btn-p lg alt"><Ed value={p.button_label} path="button_label" /></A>}{p.button_label && <LinkBtn path="button_href" value={p.button_href} />}</div>
    </section>
  );
}

const TextBlock = ({ p }) => <section className="sec"><div className="wrap narrow" style={{ textAlign: p.align || 'left' }}>{p.title && <Ed as="h2" value={p.title} path="title" />}<EdRich value={p.html} path="html" /></div></section>;

const ImageText = ({ p }) => (
  <section className="sec"><div className={`wrap split ${p.image_side === 'left' ? 'rev' : ''}`}>
    <div className="split-text">{p.title && <Ed as="h2" value={p.title} path="title" />}<EdRich value={p.text} path="text" />{p.button_label && <A href={p.button_href} className="btn-p"><Ed value={p.button_label} path="button_label" /></A>}{p.button_label && <LinkBtn path="button_href" value={p.button_href} />}</div>
    <div className="split-img"><ImgBtn path="image" />{p.image ? <img src={imgUrl(p.image)} alt={p.title || ''} loading="lazy" /> : <Placeholder icon="🏡" />}</div>
  </div></section>
);

function Faq({ p }) {
  const [open, setOpen] = useState(0);
  return <section className="sec"><div className="wrap narrow"><Head title={p.title} />{(p.items || []).map((x, idx) => ({ ...x, _i: idx })).filter((i) => i.q).map((i, k) => (
    <div key={k} className={`faq ${open === k ? 'open' : ''}`}><button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? -1 : k)}>{i.q}<span>{open === k ? '−' : '+'}</span></button>{open === k && <div className="faq-a"><EdRich value={i.a} path={`items.${i._i}.a`} /></div>}</div>))}</div></section>;
}

function Contact({ p }) {
  const { config } = useSite();
  const c = config.contact;
  return (
    <section className="sec"><div className="wrap split">
      <div className="split-text"><Ed as="h2" value={p.title} path="title" />{p.text && <Ed as="p" value={p.text} path="text" />}
        {p.show_details && <ul className="cdetails">{c.phone && <li>📞 <a href={`tel:${c.phone}`}>{c.phone}</a></li>}{c.landline && <li>☎️ <a href={`tel:${c.landline}`}>{c.landline}</a></li>}{c.whatsapp && <li>💬 <a href={waLink(c.whatsapp)} target="_blank" rel="noreferrer">WhatsApp {c.whatsapp}</a></li>}{c.email && <li>✉️ <a href={`mailto:${c.email}`}>{c.email}</a></li>}{c.address && <li>📍 {c.address}</li>}{c.hours && <li>🕘 {c.hours}</li>}</ul>}</div>
      {p.show_form && <InquiryForm title="Send us a message" kind="contact" />}
    </div></section>
  );
}

/** A gallery with no photos yet shows nothing to visitors (the editor still shows its title so it can be filled). */
const Gallery = ({ p }) => (!useEditing() && !useContext(ShowEmptyCtx) && !(p.images || []).some((i) => i.src) ? null : <GalleryInner p={p} />);
const GalleryInner = ({ p }) => <section className="sec"><div className="wrap"><Head title={p.title} /><div className="ggrid">{(p.images || []).map((x, idx) => ({ ...x, _i: idx })).filter((i) => i.src).map((i) => <figure key={i._i}><ImgBtn path={`images.${i._i}.src`} /><img src={imgUrl(i.src)} alt={i.caption || ''} loading="lazy" />{i.caption && <figcaption>{i.caption}</figcaption>}</figure>)}</div></div></section>;

function Leadership({ p }) {
  const all = (p.members || []).filter((m) => m.name);
  if (!all.length) return null;
  const directors = all.filter((m) => m.director), team = all.filter((m) => !m.director);
  const contact = (m) => (m.phone || m.email) && <div className="mem-contact">{m.phone && <a href={`tel:${m.phone}`}>📞 {m.phone}</a>}{m.email && <a href={`mailto:${m.email}`}>✉️ {m.email}</a>}</div>;
  return (
    <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} />
      {directors.map((m, i) => (
        <article key={i} className={`director ${i % 2 ? 'rev' : ''}`}>
          <div className="director-img">{m.photo ? <img src={imgUrl(m.photo)} alt={m.name} loading="lazy" /> : <Placeholder icon="👤" />}</div>
          <div className="director-body"><span className="eyebrow">{m.role}</span><h3>{m.name}</h3><Markdown text={m.bio} />{contact(m)}</div>
        </article>
      ))}
      {team.length > 0 && <div className="team-grid">{team.map((m, i) => (
        <article key={i} className="member">{m.photo ? <img src={imgUrl(m.photo)} alt={m.name} loading="lazy" /> : <span className="av lg">{m.name[0]}</span>}<h4>{m.name}</h4><small>{m.role}</small>{m.bio && <p>{m.bio}</p>}{contact(m)}</article>
      ))}</div>}
    </div></section>
  );
}

function ProjectInfo({ p }) {
  const line = (t) => { const [a, ...b] = String(t).split('|'); return [a.trim(), b.join('|').trim()]; };
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} />
      {p.intro && <p className="pi-intro">{p.intro}</p>}
      {(p.stats || []).length > 0 && <div className="pi-stats">{p.stats.map((s, i) => <div key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div>}
      <div className="pi-groups">{(p.groups || []).map((g, i) => (
        <div key={i} className="pi-group"><h3>{g.heading}</h3>
          <ul>{String(g.items || '').split('\n').map((t) => t.trim()).filter(Boolean).map((t, k) => { const [a, b] = line(t); return <li key={k}><b>{a}</b>{b && <small>{b}</small>}</li>; })}</ul></div>
      ))}</div>
    </div></section>
  );
}

/** Free-form columns (1–4) with image, heading, text and button — the general-purpose layout block. */
function Columns({ p }) {
  const items = (p.items || []).map((x, idx) => ({ ...x, _i: idx })).filter((x) => x.title || x.text || x.image);
  const n = Math.min(4, Math.max(1, Number(p.cols) || items.length || 1));
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} subtitle={p.subtitle} />
      <div className={`cols-grid va-${p.valign || 'top'}`} style={{ '--cols': n, '--n': items.length + 1 }}>
        {items.map((x, i) => (
          <div key={i} className="cols-item" style={{ '--i': i + 1 }}>
            <ImgBtn path={`items.${x._i}.image`} />
            {x.image && <img src={imgUrl(x.image)} alt={x.title || ''} loading="lazy" decoding="async" />}
            {x.title && <Ed as="h3" value={x.title} path={`items.${x._i}.title`} />}
            {x.text && <EdRich value={x.text} path={`items.${x._i}.text`} />}
            {x.button_label && <A href={x.button_href} className="btn-p"><Ed value={x.button_label} path={`items.${x._i}.button_label`} /></A>}{x.button_label && <LinkBtn path={`items.${x._i}.button_href`} value={x.button_href} />}
          </div>
        ))}
      </div>
    </div></section>
  );
}

const Spacer = ({ p }) => <div className="spacer" style={{ height: Number(p.height) || 40 }} aria-hidden="true" />;

const METRICS = { listings: 'Properties available', featured: 'Featured properties', for_rent: 'Properties for rent', sold: 'Properties sold', projects: 'Live projects', agents: 'Listing agents', articles: 'Articles published' };
/** Numbers pulled live from the ERP (available listings, projects, sold units …) — they update themselves. */
function LiveStats({ p }) {
  const d = usePublic('/api/site/metrics');
  return (
    <section className="stats live"><div className="wrap">
      {(p.items || []).map((it, i) => <div key={i}><b>{d ? Number(d[it.metric] ?? 0).toLocaleString('en-PK') + (it.suffix || '') : '…'}</b><span>{it.label || METRICS[it.metric] || it.metric}</span></div>)}
    </div></section>
  );
}

/** Book a site visit: picks project, day and time slot, then arrives in the CRM as a lead with the request attached. */
function Booking({ p }) {
  const opts = usePublic('/api/site/booking-options');
  const slots = String(p.slots || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const day = (n) => new Date(Date.now() + 5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ name: '', phone: '', project: '', date: day(1), time: slots[0] || '', note: '', website: '' });
  const [st, setSt] = useState({ busy: false, done: '', err: '' });
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, done: '', err: '' });
    const dow = new Date(f.date).getUTCDay();
    if (p.skip_friday && dow === 5) return setSt({ busy: false, done: '', err: 'Visits are not available on Fridays — please pick another day.' });
    try {
      const r = await api.post('/api/site/inquiry', { name: f.name, phone: f.phone, kind: 'visit', website: f.website, message: `Site visit request: ${f.project || 'any project'} on ${f.date}${f.time ? ` at ${f.time}` : ''}.${f.note ? ` ${f.note}` : ''}` });
      setSt({ busy: false, done: r.reference, err: '' });
    } catch (er) { setSt({ busy: false, done: '', err: er.message }); }
  };
  return (
    <section className="sec soft"><div className="wrap narrow">
      <Head title={p.title} subtitle={p.subtitle} />
      {st.done ? <div className="inq ok"><b>Visit requested!</b><p>We will confirm your visit on {f.date}{f.time ? ` (${f.time})` : ''} by phone. Reference <code>{st.done}</code>.</p></div> : (
        <form className="inq booking" onSubmit={submit}>
          {st.err && <div className="inq-err" role="alert">{st.err}</div>}
          <div className="two"><input required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /><input required placeholder="Phone number" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></div>
          <select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">Any project</option>{(opts?.projects || []).map((x) => <option key={x.id}>{x.name}</option>)}</select>
          <div className="two"><input type="date" required min={day(0)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />{slots.length > 0 && <select value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}>{slots.map((s) => <option key={s}>{s}</option>)}</select>}</div>
          <textarea rows={2} placeholder="Anything we should know? (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
          <button className="btn-p" disabled={st.busy}>{st.busy ? 'Booking…' : 'Book my visit'}</button>
        </form>
      )}
    </div></section>
  );
}

/** Sign-in doors to the customer and vendor portals. */
const Portal = ({ p }) => (
  <section className="sec"><div className="wrap">
    <Head title={p.title} subtitle={p.subtitle} />
    <div className="portal-cards">
      {p.show_customer !== false && <A href="/portal/login" className="portal-card"><span>🏠</span><h3>Customer portal</h3><p>{siteCopy('portal_blurb', 'See your plot or house, payments, receipts, documents and construction progress.')}</p><b>Sign in →</b></A>}
      {p.show_vendor !== false && <A href="/vendor/login" className="portal-card"><span>🧰</span><h3>Vendor portal</h3><p>Check payments and ledger, and bid on open tenders and contracts.</p><b>Sign in →</b></A>}
    </div>
  </div></section>
);

const Banner = ({ p }) => { const inner = <div className="wrap"><Ed value={p.text} path="text" /><LinkBtn path="href" value={p.href} /></div>; return p.href ? <A href={p.href} className={`banner ${p.tone || 'primary'}`}>{inner}</A> : <div className={`banner ${p.tone || 'primary'}`}>{inner}</div>; };

const MAP = { hero: Hero, listings: Listings, projects: Projects, stats: Stats, services: Services, calculators: Calculators, agents: Agents, testimonials: Testimonials, partners: Partners, reviews: Reviews, embed: Embed, blog: Blog, cta: Cta, text: TextBlock, imagetext: ImageText, faq: Faq, contact: Contact, gallery: Gallery, banner: Banner, leadership: Leadership, projectinfo: ProjectInfo, columns: Columns, spacer: Spacer, livestats: LiveStats, booking: Booking, portal: Portal };

/**
 * Renders a page's sections. Each one sits in a wrapper (#sb-<id>) so the responsive layout settings can be compiled
 * into one small stylesheet: desktop rules, then @media (max-width:768px) for tablet and (max-width:480px) for mobile.
 * `wrap` lets the visual editor add its selection / drag handles around every block.
 */
export function SectionRenderer({ sections, wrap, editor, readonly }) {
  const list = sections || [];
  const css = useMemo(() => sectionCss(list, { keepHidden: !!editor }), [list, editor]);
  const body = (
    <>
      {css && <style>{css}</style>}
      {list.map((s, i) => {
        const C = MAP[s.type]; if (!C) return null;
        const node = <div key={s.id} id={`sb-${safeId(s.id)}`} className={`sb ${editor ? 'sb-ed' : ''}`} data-sid={s.id} data-type={s.type}>{editor && !readonly ? <EditCtx.Provider value={{ sid: s.id, props: s.props || {}, post: postToEditor }}><C p={s.props || {}} /></EditCtx.Provider> : <C p={s.props || {}} />}{s.style?.anchor && <span id={s.style.anchor} className="sb-anchor" />}</div>;
        return wrap ? wrap(node, s, i) : node;
      })}
    </>
  );
  return editor ? <ShowEmptyCtx.Provider value>{body}</ShowEmptyCtx.Provider> : body;
}
