import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { InstallmentCalculator } from './Calculators.jsx';
import ChatBot from './ChatBot.jsx';
import { resolveStyle } from '../../../shared/sectionStyle.js';
import { CalculatorTabs } from './ConstructionTools.jsx';
import { A, safeHref, AgentCard, InquiryForm, Placeholder, PostCard, ProjectCard, PropertyCard, SearchBox, SectionRenderer, usePublic } from './components.jsx';
import { Markdown, SECTION_TYPES, SiteProvider, withPreview, fullPrice, imgUrl, priceText, useSite, useTitle, waLink, MoneyBox, minorOf, curCode, siteCopy, isPK, exampleAmount } from './siteCore.jsx';
import { getRegion } from '../format.js';
import './site.css';

/** Header looks a theme can choose: white (default), dark, or see-through over the first block. */
export const HEADER_STYLES = ['light', 'dark', 'transparent'];
const SOCIAL_ICON = { Facebook: 'f', Instagram: '◎', YouTube: '▶', WhatsApp: '✆', 'X (Twitter)': '𝕏', Twitter: '𝕏', LinkedIn: 'in', TikTok: '♪', Website: '🌐', Other: '🔗' };

export function Header() {
  const { config, menu, preview } = useSite();
  const [open, setOpen] = useState(false);
  const h = config.header, b = config.brand, c = config.contact || {};
  const hs = HEADER_STYLES.includes(h.style) ? h.style : 'light';
  const links = [...h.links, ...menu.filter((m) => !h.links.some((l) => l.href.endsWith(`/p/${m.slug}`))).map((m) => ({ label: m.title, href: `/site/p/${m.slug}` }))];
  return (
    <header className={`s-header hs-${hs} ${h.sticky && hs !== 'transparent' ? 'sticky' : ''}${h.topbar ? ' has-topbar' : ''}${links.length > 8 ? ' nav-many' : ''}`}>
      {h.topbar && (c.phone || c.email || c.hours || (config.social || []).length > 0) && (
        <div className="s-topbar"><div className="wrap">
          <span className="tb-info">{c.phone && <a href={`tel:${c.phone}`}>📞 {c.phone}</a>}{c.email && <a href={`mailto:${c.email}`}>✉️ {c.email}</a>}{c.hours && <span>🕘 {c.hours}</span>}</span>
          <span className="tb-social">{(config.social || []).filter((s) => safeHref(s.url)).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" aria-label={s.platform} title={s.platform}>{SOCIAL_ICON[s.platform] || '🔗'}</a>)}</span>
        </div></div>
      )}
      <div className="wrap row">
        <Link to="/site" className="brand" aria-label={b.name}>{b.logo ? <img src={imgUrl(b.logo)} alt={b.name} /> : <><span className="mark">⌂</span><span><b>{b.name}</b>{b.tagline && <small>{b.tagline}</small>}</span></>}</Link>
        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-label="Main">
          {links.map((l, i) => <A key={i} href={l.href}>{l.label}</A>)}
          <A href={h.cta_href || '/login'} className="btn-p sm mobile-only">{h.cta_label}</A>
        </nav>
        <div className="hright">
          {h.show_phone && config.contact.phone && <a href={`tel:${config.contact.phone}`} className="hphone">📞 {config.contact.phone}</a>}
          {h.cta_label && <A href={h.cta_href || '/login'} className="btn-p sm desk-only">{h.cta_label}</A>}
          <button className="burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '✕' : '☰'}</button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { config } = useSite();
  const f = config.footer, b = config.brand, c = config.contact;
  const wa = c.whatsapp;
  const map = c.address && f.show_map !== false ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}` : '';
  return (
    <footer className={`s-footer ${f.style === 'light' ? 'fs-light' : ''}`}>
      {f.show_cta !== false && f.cta_title && (
        <div className="fcta"><div className="wrap">
          <div><h3>{f.cta_title}</h3>{f.cta_text && <p>{f.cta_text}</p>}</div>
          <div className="fcta-btns">
            {c.phone && <a className="btn-p lg alt" href={`tel:${c.phone}`}>📞 Call {c.phone}</a>}
            {wa && <a className="btn-o lg" href={waLink(wa, 'Hello, I would like to know more about your properties.')} target="_blank" rel="noreferrer">💬 WhatsApp us</a>}
          </div>
        </div></div>
      )}
      <div className="wrap fgrid">
        <div className="fabout">
          <div className="brand light">{b.logo ? <img src={imgUrl(b.logo)} alt={b.name} /> : <><span className="mark">⌂</span><b>{b.name}</b></>}</div>
          <p>{f.about}</p>
          {f.show_social && <div className="social">{(config.social || []).filter((s) => safeHref(s.url)).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" aria-label={s.platform} title={s.platform}>{SOCIAL_ICON[s.platform] || '🔗'}</a>)}</div>}
        </div>
        {(f.columns || []).map((col, i) => <nav key={i} aria-label={col.title}><h5>{col.title}</h5><ul>{(col.links || []).map((l, j) => <li key={j}><A href={l.href}>{l.label}</A></li>)}</ul></nav>)}
        <div className="fcontact-col"><h5>Visit & contact</h5>
          <ul className="fcontact">
            {c.address && <li><span aria-hidden="true">📍</span><span>{map ? <a href={map} target="_blank" rel="noreferrer">{c.address}</a> : c.address}</span></li>}
            {c.phone && <li><span aria-hidden="true">📞</span><a href={`tel:${c.phone}`}>{c.phone}</a></li>}
            {c.landline && <li><span aria-hidden="true">☎️</span><a href={`tel:${c.landline}`}>{c.landline}</a></li>}
            {c.email && <li><span aria-hidden="true">✉️</span><a href={`mailto:${c.email}`}>{c.email}</a></li>}
            {f.show_hours !== false && c.hours && <li><span aria-hidden="true">🕘</span><span>{c.hours}</span></li>}
          </ul>
        </div>
      </div>
      <div className="fbar"><div className="wrap fbar-in"><span>{(f.copyright || '').replace('{year}', new Date().getFullYear())}</span><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top ↑</button></div></div>
    </footer>
  );
}

function SiteLayout() {
  const { config, draft } = useSite();
  const wa = config.contact.whatsapp;
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <>
      {draft && <div className="s-draft-bar" role="status">Preview of unpublished changes. Visitors still see the published website. <a href="/site" onClick={() => { try { sessionStorage.removeItem('site_preview'); } catch { /* storage unavailable */ } }}>See the live website</a></div>}
      <Header />
      <main id="site-main"><Outlet /></main>
      <Footer />
      <ChatBot />
      {wa && <a className="wa-float" href={waLink(wa, 'Hello, I would like to know more about your properties.')} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">💬</a>}
    </>
  );
}

// ---------------------------------------------------------------- generic builder pages
export function PageView({ slug: fixed }) {
  const params = useParams();
  const slug = fixed || params.slug;
  const [page, setPage] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { setPage(null); setErr(false); api.get(withPreview(`/api/site/pages/${slug}`)).then(setPage).catch(() => setErr(true)); window.scrollTo(0, 0); }, [slug]);
  useTitle(page && slug !== 'home' ? (page.seo_title || page.title) : '', page?.seo_desc);
  if (err) return <NotFound />;
  if (!page) return <div className="center-box"><span className="spinner" /></div>;
  return <SectionRenderer sections={page.sections} />;
}

const NotFound = () => <div className="wrap narrow sec center"><h2>We couldn’t find that page</h2><p className="muted">It may have moved or is no longer available.</p><Link to="/site" className="btn-p">Back to home</Link></div>;

const Crumbs = ({ items }) => <nav className="crumbs wrap" aria-label="Breadcrumb">{items.map((c, i) => <span key={i}>{c.href ? <Link to={c.href}>{c.label}</Link> : c.label}{i < items.length - 1 && ' › '}</span>)}</nav>;

// ---------------------------------------------------------------- property search
const SORTS = [['', 'Featured first'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['area', 'Largest area'], ['oldest', 'Oldest first']];

function Properties() {
  const [sp, setSp] = useSearchParams();
  const facets = usePublic('/api/site/facets');
  const [view, setView] = useState('grid');
  const [showF, setShowF] = useState(false);
  const q = Object.fromEntries(sp.entries());
  // prices are typed in whole currency units and stored in the smallest unit (cents)
  const apiQ = { ...q, ...(q.min_price ? { min_price: minorOf(q.min_price) } : {}), ...(q.max_price ? { max_price: minorOf(q.max_price) } : {}) };
  const d = usePublic('/api/site/listings', { ...apiQ, limit: 12 });
  const set = (patch) => { const n = { ...q, ...patch, page: patch.page ?? '' }; for (const k of Object.keys(n)) if (n[k] === '' || n[k] == null) delete n[k]; setSp(n); };
  const rent = q.purpose === 'Rent';
  useTitle(rent ? 'Properties for rent' : q.purpose === 'Sell' ? 'Properties for sale' : 'Properties');
  const active = ['city', 'type', 'q', 'min_price', 'max_price', 'beds', 'installment', 'ready', 'featured', 'project_id', 'min_area', 'max_area', 'unit'].filter((k) => q[k]);
  return (
    <div className="wrap sec">
      <div className="listing-top">
        <div><h1>{rent ? 'Properties for rent' : q.purpose === 'Sell' ? 'Properties for sale' : 'All properties'}{q.city ? ` in ${q.city}` : ''}</h1><div className="muted">{d ? `${d.total} result${d.total === 1 ? '' : 's'}` : 'Searching…'}</div></div>
        <div className="row">
          <div className="seg2"><button className={!q.purpose ? 'on' : ''} onClick={() => set({ purpose: '' })}>All</button><button className={q.purpose === 'Sell' ? 'on' : ''} onClick={() => set({ purpose: 'Sell' })}>Buy</button><button className={rent ? 'on' : ''} onClick={() => set({ purpose: 'Rent' })}>Rent</button></div>
          <select aria-label="Sort" value={q.sort || ''} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <div className="seg2 desk-only"><button aria-label="Grid view" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>▦</button><button aria-label="List view" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>☰</button></div>
          <button className="btn-s mobile-only" onClick={() => setShowF(!showF)}>⚙ Filters{active.length ? ` (${active.length})` : ''}</button>
        </div>
      </div>
      <div className="listing-layout">
        <aside className={`filters ${showF ? 'open' : ''}`}>
          <h4>Filters</h4>
          <label>Keyword<input value={q.q || ''} placeholder={siteCopy('keyword_placeholder', 'Location, project, plot…')} onChange={(e) => set({ q: e.target.value })} /></label>
          <label>City<select value={q.city || ''} onChange={(e) => set({ city: e.target.value })}><option value="">All</option>{facets?.cities.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label>Property type<select value={q.type || ''} onChange={(e) => set({ type: e.target.value })}><option value="">All</option>{facets?.types.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label>Project<select value={q.project_id || ''} onChange={(e) => set({ project_id: e.target.value })}><option value="">All</option>{facets?.projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="two"><label>Min price ({curCode()})<MoneyBox value={q.min_price} placeholder={exampleAmount(2000000)} onChange={(v) => set({ min_price: v })} /></label><label>Max price ({curCode()})<MoneyBox value={q.max_price} placeholder={exampleAmount(10000000)} onChange={(v) => set({ max_price: v })} /></label></div>
          {facets?.units?.length > 1 && <label>Size unit<select value={q.unit || ''} onChange={(e) => set({ unit: e.target.value })}><option value="">All</option>{facets.units.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>}
          <div className="two"><label>Min area ({getRegion().config.area?.labels?.[getRegion().config.area?.default] || 'area'})<input type="number" min="0" value={q.min_area || ''} onChange={(e) => set({ min_area: e.target.value })} /></label><label>Max area<input type="number" min="0" value={q.max_area || ''} onChange={(e) => set({ max_area: e.target.value })} /></label></div>
          <label>Bedrooms<div className="chips">{['', '1', '2', '3', '4', '5', '6+'].map((b) => <button key={b} className={(q.beds || '') === b ? 'on' : ''} onClick={() => set({ beds: b })}>{b || 'Any'}</button>)}</div></label>
          {getRegion().config.calculators?.installments !== false && <label className="chk"><input type="checkbox" checked={q.installment === '1'} onChange={(e) => set({ installment: e.target.checked ? '1' : '' })} /> Installments available</label>}
          <label className="chk"><input type="checkbox" checked={q.ready === '1'} onChange={(e) => set({ ready: e.target.checked ? '1' : '' })} /> Ready for possession</label>
          <label className="chk"><input type="checkbox" checked={q.featured === '1'} onChange={(e) => set({ featured: e.target.checked ? '1' : '' })} /> Featured only</label>
          {active.length > 0 && <button className="btn-s" onClick={() => setSp(q.purpose ? { purpose: q.purpose } : {})}>Clear all filters</button>}
        </aside>
        <section>
          {active.length > 0 && <div className="active-f">{active.map((k) => <button key={k} onClick={() => set({ [k]: '' })}>{k.replace('_', ' ')}: {q[k]} ✕</button>)}</div>}
          {!d ? <div className="pgrid">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton tall" />)}</div> : !d.data.length ? (
            <div className="empty-state"><h3>No properties match your search</h3><p>Try removing a filter or widening your budget.</p><button className="btn-p" onClick={() => setSp({})}>Show all properties</button></div>
          ) : <div className={view === 'list' ? 'plist' : 'pgrid'}>{d.data.map((p) => <PropertyCard key={p.id} p={p} />)}</div>}
          {d && d.pages > 1 && (
            <div className="pager"><button disabled={(d.page || 1) <= 1} onClick={() => set({ page: String((d.page || 1) - 1) })}>← Prev</button>
              {Array.from({ length: d.pages }, (_, i) => i + 1).slice(0, 12).map((n) => <button key={n} className={n === (d.page || 1) ? 'on' : ''} onClick={() => set({ page: String(n) })}>{n}</button>)}
              <button disabled={(d.page || 1) >= d.pages} onClick={() => set({ page: String((d.page || 1) + 1) })}>Next →</button></div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- property detail
const yt = (u) => { const m = /(?:youtu\.be\/|v=|embed\/)([\w-]{11})/.exec(u || ''); return m ? `https://www.youtube.com/embed/${m[1]}` : null; };
const FEATURE = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', floors: 'Floors', kitchen: 'Kitchens', garage: 'Garage', lawn: 'Lawn', drawing_room: 'Drawing room', dining_room: 'Dining room', corner: 'Corner', park_facing: 'Park facing', main_road: 'On main road', boulevard: 'Boulevard', possession: 'Possession', development_status: 'Development' };

function Lightbox({ images, index, onClose, onIndex }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') onIndex((index + 1) % images.length); if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [index, images.length]); // eslint-disable-line
  return (
    <div className="lightbox2" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="lb-x" aria-label="Close" onClick={onClose}>✕</button>
      <button className="lb-n prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }}>‹</button>
      <img src={imgUrl(images[index].url)} alt={images[index].caption || ''} onClick={(e) => e.stopPropagation()} />
      <button className="lb-n next" aria-label="Next" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }}>›</button>
      <div className="lb-c">{index + 1} / {images.length}</div>
    </div>
  );
}

function PropertyPage() {
  const { id } = useParams();
  const { config } = useSite();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(false);
  const [idx, setIdx] = useState(0);
  const [lb, setLb] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setP(null); setErr(false); setIdx(0); api.get(`/api/site/listings/${id}`).then(setP).catch(() => setErr(true)); window.scrollTo(0, 0); }, [id]);
  useTitle(p?.title, p?.short);
  if (err) return <NotFound />;
  if (!p) return <div className="center-box"><span className="spinner" /></div>;
  const imgs = p.images;
  const facts = [['Type', p.type], ['Purpose', p.purpose === 'Rent' ? 'For rent' : 'For sale'], ['Area', p.area ? `${p.area} ${p.unit}` : null], ['Bedrooms', p.bedrooms], ['Bathrooms', p.bathrooms], ['Project', p.project?.name], ...(isPK() ? [['Block / sector', [p.block, p.sector].filter(Boolean).join(' / ')], ['Plot / unit', p.plot_no]] : []), ['Possession', p.ready ? 'Ready' : null], ['Development', p.development_status || p.features?.development_status], ['Installments', p.installment ? 'Available' : null], ['Reference', p.code]].filter(([, v]) => v);
  const feats = Object.entries(p.features || {}).filter(([k, v]) => v && v !== '' && !['bedrooms', 'bathrooms', 'possession', 'development_status'].includes(k)).map(([k, v]) => (v === true ? FEATURE[k] || k : `${FEATURE[k] || k}: ${v}`));
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const share = async () => { try { if (navigator.share) await navigator.share({ title: p.title, url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } } catch { /* cancelled */ } };
  const map = p.lat && p.lng ? `https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - 0.008}%2C${p.lat - 0.005}%2C${p.lng + 0.008}%2C${p.lat + 0.005}&layer=mapnik&marker=${p.lat}%2C${p.lng}` : null;
  return (
    <div>
      <Crumbs items={[{ label: 'Home', href: '/site' }, { label: p.purpose === 'Rent' ? 'For rent' : 'For sale', href: `/site/properties?purpose=${p.purpose === 'Rent' ? 'Rent' : 'Sell'}` }, { label: p.city || 'Properties', href: p.city ? `/site/properties?city=${encodeURIComponent(p.city)}` : '/site/properties' }, { label: p.title }]} />
      <div className="wrap pdetail">
        <div className="pmain">
          <div className="gallery2">
            <button className="gmain" onClick={() => imgs.length && setLb(true)} aria-label="Open photo gallery">{imgs.length ? <img src={imgUrl(imgs[idx].url)} alt={p.title} /> : <Placeholder icon="🏠" label="Photos coming soon" />}{p.featured && <span className="featured-tag big">★ Featured</span>}{p.status === 'sold' && <span className="tag-sold big">Sold</span>}</button>
            {imgs.length > 1 && <div className="gthumbs">{imgs.slice(0, 8).map((m, i) => <button key={i} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} aria-label={`Photo ${i + 1}`}><img src={imgUrl(m.url)} alt="" loading="lazy" />{i === 7 && imgs.length > 8 && <span>+{imgs.length - 8}</span>}</button>)}</div>}
          </div>
          <div className="phead">
            <div><h1>{p.title}</h1><div className="ploc big">📍 {[p.location || p.area_name, p.city].filter(Boolean).join(', ')}</div></div>
            <div className="pprice"><b>{priceText(p.price, p.purpose)}</b>{p.discount > 0 && <small className="was">{priceText(p.total_price)}</small>}<small>{fullPrice(p.price)}{p.purpose === 'Rent' ? ' / month' : ''}</small></div>
          </div>
          <div className="row gap"><button className="btn-s" onClick={share}>{copied ? '✓ Link copied' : '↗ Share'}</button><button className="btn-s" onClick={() => window.print()}>🖨 Print</button></div>
          <section className="box"><h3>Overview</h3><dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
          {(p.description || p.short) && <section className="box"><h3>Description</h3><Markdown text={p.description || p.short} /></section>}
          {(p.amenities.length > 0 || feats.length > 0) && <section className="box"><h3>Features & amenities</h3><div className="chips2">{[...feats, ...p.amenities].map((a) => <span key={a}>✓ {a}</span>)}</div></section>}
          {p.videos.length > 0 && <section className="box"><h3>Video</h3>{p.videos.map((v) => (yt(v) ? <div key={v} className="video"><iframe title="Property video" src={yt(v)} allowFullScreen loading="lazy" /></div> : <p key={v}><a href={v} target="_blank" rel="noreferrer">▶ Watch video</a></p>))}</section>}
          {map && <section className="box"><h3>Location</h3><iframe title="Map" className="map" src={map} loading="lazy" /><a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a></section>}
          {p.installment && <section className="box"><h3>Installment plan</h3><InstallmentCalculator price={p.price} compact /></section>}
        </div>
        <aside className="pside">
          <div className="box sticky">
            {p.agent ? (
              <div className="agent-box">
                <div className="row gap"><span className="av lg">{p.agent.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><div><small className="muted">Listing agent</small><h4><Link to={`/site/agent/${p.agent.id}`}>{p.agent.name}</Link></h4></div></div>
                <div className="acts col">
                  {p.agent.phone && <a className="btn-p" href={`tel:${p.agent.phone}`}>📞 Call {p.agent.phone}</a>}
                  {p.agent.whatsapp && <a className="btn-s wa" href={waLink(p.agent.whatsapp, `Hi ${p.agent.name}, I'm interested in ${p.title} (${p.code}) — ${url}`)} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                  {p.agent.email && <a className="btn-s" href={`mailto:${p.agent.email}?subject=${encodeURIComponent(`Enquiry: ${p.title} (${p.code})`)}`}>✉️ {p.agent.email}</a>}
                </div>
              </div>
            ) : <div className="agent-box"><h4>Interested in this property?</h4><a className="btn-p" href={`tel:${config.contact.phone}`}>📞 Call us</a></div>}
            <InquiryForm propertyId={p.id} title="Request details" agent={p.agent} compact />
          </div>
        </aside>
      </div>
      {p.similar.length > 0 && <section className="sec soft"><div className="wrap"><h2>Similar properties</h2><div className="pgrid">{p.similar.map((x) => <PropertyCard key={x.id} p={x} />)}</div></div></section>}
      {lb && <Lightbox images={imgs} index={idx} onClose={() => setLb(false)} onIndex={setIdx} />}
    </div>
  );
}

// ---------------------------------------------------------------- projects / agents / blog / calculators
const PROJECT_KIND = { development: 'Plots & developments', construction: 'House construction' };
function ProjectsPage() {
  const [sp, setSp] = useSearchParams();
  const facets = usePublic('/api/site/facets');
  const q = Object.fromEntries(sp.entries());
  const d = usePublic('/api/site/projects', q);
  const set = (patch) => { const n = { ...q, ...patch }; for (const k of Object.keys(n)) if (n[k] === '' || n[k] == null) delete n[k]; setSp(n); };
  const kinds = facets?.project_kinds || [], statuses = facets?.project_statuses || [];
  const active = ['q', 'kind', 'status', 'available'].filter((k) => q[k]);
  useTitle('Projects');
  return (
    <div className="wrap sec">
      <h1>Our projects</h1><p className="muted">Planned communities with development progress you can follow.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, alignItems: 'center', margin: '16px 0 24px' }}>
        <input aria-label="Search projects" value={q.q || ''} placeholder="Search by name or location" onChange={(e) => set({ q: e.target.value })} />
        {kinds.length > 1 && <select aria-label="Project type" value={q.kind || ''} onChange={(e) => set({ kind: e.target.value })}><option value="">All types</option>{kinds.map((c) => <option key={c.value} value={c.value}>{PROJECT_KIND[c.value] || c.value} ({c.n})</option>)}</select>}
        {statuses.length > 1 && <select aria-label="Project status" value={q.status || ''} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{statuses.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select>}
        <label className="chk"><input type="checkbox" checked={q.available === '1'} onChange={(e) => set({ available: e.target.checked ? '1' : '' })} /> With properties available</label>
        {active.length > 0 && <button className="btn-s" onClick={() => setSp({})}>Clear filters</button>}
      </div>
      {!d ? null : !d.data.length ? <div className="empty-state"><h3>No projects match your search</h3><p>Try removing a filter.</p>{active.length > 0 && <button className="btn-p" onClick={() => setSp({})}>Show all projects</button>}</div> : <div className="jgrid">{d.data.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}
    </div>
  );
}

function ProjectPage() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { setP(null); api.get(`/api/site/projects/${id}`).then(setP).catch(() => setErr(true)); window.scrollTo(0, 0); }, [id]);
  useTitle(p?.name);
  if (err) return <NotFound />;
  if (!p) return <div className="center-box"><span className="spinner" /></div>;
  return (
    <div>
      <Crumbs items={[{ label: 'Home', href: '/site' }, { label: 'Projects', href: '/site/projects' }, { label: p.name }]} />
      <div className="wrap sec">
        <div className="phead"><div><h1>{p.name}</h1><div className="ploc big">📍 {p.location} · {p.dev_status}</div></div>{p.progress != null && <div className="pprice"><b>{p.progress}%</b><small>developed</small></div>}</div>
        {p.images.length > 0 && <div className="ggrid">{p.images.map((m, i) => <figure key={i}><img src={imgUrl(m.url)} alt={m.caption || p.name} loading="lazy" /></figure>)}</div>}
        <div className="box"><h3>About the project</h3><Markdown text={p.description} /><dl className="facts">{[['Developer', p.developer], ['Land area', p.total_land_area ? `${p.total_land_area} ${p.land_unit}` : null], ['Total units', p.total_units], ['Started', p.start_date], ['Expected completion', p.expected_completion]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
        {p.schedule && (
          <div className="box"><h3>Development progress</h3><div className="jbar big"><div style={{ width: `${p.schedule.summary.actual_pct}%` }} /></div><p className="muted">{p.schedule.summary.actual_pct}% complete{p.schedule.summary.health === 'delayed' ? ' — some activities are running behind schedule' : ''}</p>
            <ul className="steps">{p.schedule.tasks.map((t, i) => <li key={i} className={t.status}><span>{t.status === 'completed' ? '✓' : t.status === 'delayed' ? '!' : '•'}</span><b>{t.name}</b><i>{t.progress}%</i></li>)}</ul></div>
        )}
        <h2>Available in {p.name}</h2>
        {p.listings.length ? <div className="pgrid">{p.listings.map((x) => <PropertyCard key={x.id} p={x} />)}</div> : <p className="muted">No units are currently listed. Contact us for upcoming inventory.</p>}
      </div>
    </div>
  );
}

function AgentsPage() {
  const d = usePublic('/api/site/agents');
  useTitle('Our agents');
  return <div className="wrap sec"><h1>Our listing agents</h1><p className="muted">Each property is listed by one of our agents — contact them directly.</p>{d && (d.data.length ? <div className="agrid">{d.data.map((a) => <AgentCard key={a.id} a={a} />)}</div> : <p className="muted">No agents to show.</p>)}</div>;
}
function AgentPage() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.get(`/api/site/agents/${id}`).then(setA).catch(() => setErr(true)); }, [id]);
  useTitle(a?.name);
  if (err) return <NotFound />;
  if (!a) return <div className="center-box"><span className="spinner" /></div>;
  return (
    <div className="wrap sec">
      <div className="agent-hero"><span className="av xl">{a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><div><h1>{a.name}</h1><div className="muted">Listing agent · {a.listings.length} active listing(s)</div>
        <div className="acts">{a.phone && <a className="btn-p" href={`tel:${a.phone}`}>📞 {a.phone}</a>}{a.whatsapp && <a className="btn-s wa" href={waLink(a.whatsapp)} target="_blank" rel="noreferrer">💬 WhatsApp</a>}{a.email && <a className="btn-s" href={`mailto:${a.email}`}>✉️ Email</a>}</div></div></div>
      <h2>Listings by {a.name.split(' ')[0]}</h2><div className="pgrid">{a.listings.map((p) => <PropertyCard key={p.id} p={p} />)}</div>
    </div>
  );
}

function BlogPage() {
  const [sp, setSp] = useSearchParams();
  const d = usePublic('/api/site/posts', { page: sp.get('page') || 1, limit: 9, tag: sp.get('tag') || undefined });
  useTitle('Blog');
  return (
    <div className="wrap sec"><h1>Blog</h1>{sp.get('tag') && <p>Tagged <b>{sp.get('tag')}</b> · <button className="linkbtn" onClick={() => setSp({})}>clear</button></p>}
      {d && (d.data.length ? <div className="bgrid">{d.data.map((p) => <PostCard key={p.id} p={p} />)}</div> : <p className="muted">No articles yet.</p>)}
      {d && d.pages > 1 && <div className="pager">{Array.from({ length: d.pages }, (_, i) => i + 1).map((n) => <button key={n} className={String(n) === (sp.get('page') || '1') ? 'on' : ''} onClick={() => setSp({ page: String(n) })}>{n}</button>)}</div>}
    </div>
  );
}
function PostPage() {
  const { slug } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { setP(null); api.get(`/api/site/posts/${slug}`).then(setP).catch(() => setErr(true)); window.scrollTo(0, 0); }, [slug]);
  const { config } = useSite();
  useTitle(p?.seo_title || p?.title, p?.seo_desc || p?.excerpt, p?.cover);
  useEffect(() => {
    if (!p) return undefined;
    const base = (config.seo?.base_url || window.location.origin).replace(/\/+$/, '');
    const abs = (u) => (!u ? undefined : /^https?:/.test(u) ? u : `${base}${u}`);
    const data = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.seo_desc || p.excerpt, image: abs(p.cover), datePublished: p.published_at, dateModified: p.updated_at || p.published_at,
      author: { '@type': 'Person', name: p.author || config.brand?.name }, publisher: { '@type': 'Organization', name: config.brand?.name }, mainEntityOfPage: `${base}/site/blog/${p.slug}`, wordCount: undefined };
    let el = document.getElementById('post-schema');
    if (!el) { el = document.createElement('script'); el.id = 'post-schema'; el.type = 'application/ld+json'; document.head.appendChild(el); }
    el.textContent = JSON.stringify(data);
    return () => el.remove();
  }, [p, config]);
  if (err) return <NotFound />;
  if (!p) return <div className="center-box"><span className="spinner" /></div>;
  const url = encodeURIComponent(`${(config.seo?.base_url || window.location.origin).replace(/\/+$/, '')}/site/blog/${p.slug}`);
  return (
    <div>
      <Crumbs items={[{ label: 'Home', href: '/site' }, { label: 'Blog', href: '/site/blog' }, { label: p.title }]} />
      <article className="wrap narrow sec post">
        <h1>{p.title}</h1><div className="muted">{(p.published_at || '').slice(0, 10)}{p.author ? ` · ${p.author}` : ''}{p.reading_min ? ` · ${p.reading_min} min read` : ''}</div>
        {p.cover && <img className="post-cover" src={imgUrl(p.cover)} alt={p.title} />}
        {(p.toc || []).length >= 3 && <nav className="toc" aria-label="In this article"><b>In this article</b><ol>{p.toc.map((h) => <li key={h.id} style={{ marginLeft: (h.level - 2) * 16 }}><a href={`#${h.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{h.text}</a></li>)}</ol></nav>}
        <Markdown text={p.body} />
        <div className="share"><b>Share</b><a href={`https://wa.me/?text=${encodeURIComponent(p.title)}%20${url}`} target="_blank" rel="noreferrer">WhatsApp</a><a href={`https://www.facebook.com/sharer/sharer.php?u=${url}`} target="_blank" rel="noreferrer">Facebook</a><button type="button" onClick={() => navigator.clipboard?.writeText(decodeURIComponent(url))}>Copy link</button></div>
        {p.tags.length > 0 && <div className="chips2">{p.tags.map((t) => <Link key={t} to={`/site/blog?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}</div>}
      </article>
      {p.related.length > 0 && <section className="sec soft"><div className="wrap"><h2>More to read</h2><div className="bgrid">{p.related.map((x) => <PostCard key={x.slug} p={x} />)}</div></div></section>}
    </div>
  );
}

function CalculatorsPage() {
  const [sp] = useSearchParams();
  useTitle('Calculators');
  return <div className="wrap sec"><h1>Calculators</h1><p className="muted">{isPK() ? 'Estimate what your home will cost to build, the materials it needs and the payment milestones.' : 'Work out a monthly payment, the costs of buying and what it takes to build. Figures are estimates only.'}</p><CalculatorTabs defaultTab={sp.get('tab') || 'cost'} /></div>;
}

/** Public website mounted at /site/*. `override` renders the live preview inside the editor. */
export default function SiteApp() {
  return (
    <SiteProvider>
      <Routes>
        <Route path="__editor" element={<EditorCanvas />} />
        <Route element={<SiteLayout />}>
          <Route index element={<PageView slug="home" />} />
          <Route path="p/:slug" element={<PageView />} />
          <Route path="properties" element={<Properties />} />
          <Route path="property/:id" element={<PropertyPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="project/:id" element={<ProjectPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agent/:id" element={<AgentPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<PostPage />} />
          <Route path="calculators" element={<CalculatorsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SiteProvider>
  );
}

/**
 * The visual editor's canvas: the real website rendered inside an iframe whose width is the chosen device, so the
 * generated @media rules respond exactly as they will for visitors. It receives the draft over postMessage and sends back
 * selections, drops and block actions — nothing here can reach the database.
 */
export function EditorCanvas() {
  const [st, setSt] = useState(null);
  const [drag, setDrag] = useState(null); // { overId, before }
  const ref = useRef(null);
  const post = (m) => window.parent.postMessage(m, window.location.origin);
  useEffect(() => {
    document.title = 'Editor canvas';
    let m = document.querySelector('meta[name=robots]'); if (!m) { m = document.createElement('meta'); m.name = 'robots'; document.head.appendChild(m); } m.content = 'noindex, nofollow';
    const h = (e) => { if (e.origin === window.location.origin && e.data?.t === 'state') setSt(e.data); };
    window.addEventListener('message', h); post({ t: 'ready' });
    return () => window.removeEventListener('message', h);
  }, []);
  const selected = st?.selected;
  const fromCanvas = useRef(false);
  useEffect(() => {
    if (!selected || fromCanvas.current) { fromCanvas.current = false; return; }
    document.querySelector(`[data-sid="${selected}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selected]);
  if (!st) return <div className="center-box"><span className="spinner" /></div>;
  const { sections, device } = st;
  const drop = (e, beforeId) => {
    e.preventDefault(); e.stopPropagation(); setDrag(null);
    const move = e.dataTransfer.getData('application/x-sb-move'), type = e.dataTransfer.getData('application/x-sb-type');
    if (move) post({ t: 'move', id: move, beforeId }); else if (type) post({ t: 'add', type, beforeId });
  };
  const over = (e, sid, nextId) => {
    if (![...e.dataTransfer.types].some((t) => t.startsWith('application/x-sb'))) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect(); const top = e.clientY < r.top + r.height / 2;
    setDrag({ overId: sid, before: top ? sid : nextId, pos: top ? 'top' : 'bottom' });
  };
  const wrap = (node, s, i) => {
    const hidden = resolveStyle(s.style, device, 'hide').value === true;
    const nextId = sections[i + 1]?.id ?? null;
    const T = SECTION_TYPES[s.type] || { label: s.type, icon: '▫️' };
    const btn = (t, label, title) => <button type="button" title={title} aria-label={title} onClick={(e) => { e.stopPropagation(); post({ t, id: s.id }); }}>{label}</button>;
    return (
      <div key={s.id} className={`sb-edwrap ${selected === s.id ? 'sel' : ''} ${hidden ? 'is-hidden' : ''} ${drag?.overId === s.id ? `drop-${drag.pos}` : ''}`}
        onClick={(e) => { e.stopPropagation(); fromCanvas.current = true; post({ t: 'select', id: s.id }); }}
        onDragOver={(e) => over(e, s.id, nextId)} onDragLeave={() => setDrag((d) => (d?.overId === s.id ? null : d))} onDrop={(e) => drop(e, drag?.overId === s.id ? drag.before : nextId)}>
        {node}
        {hidden && <div className="sb-hidden-tag">Hidden on {device}</div>}
        <div className="sb-chip" onClick={(e) => e.stopPropagation()}>
          <span className="sb-grip" draggable title="Drag to move this block" onDragStart={(e) => { e.dataTransfer.setData('application/x-sb-move', s.id); e.dataTransfer.effectAllowed = 'move'; }}>⠿ {T.icon} {T.label}</span>
          {btn('up', '↑', 'Move up')}{btn('down', '↓', 'Move down')}{btn('dup', '⧉', 'Duplicate')}{btn('hide', hidden ? '👁' : '🙈', hidden ? `Show on ${device}` : `Hide on ${device}`)}{btn('del', '🗑', 'Delete')}
        </div>
      </div>
    );
  };
  return (
    <SiteProvider override={{ config: st.config }}>
      <div ref={ref} className={`sb-canvas ${device}`} onClickCapture={(e) => { if (e.target.closest('a,button[type=submit]') && !e.target.closest('.sb-chip')) e.preventDefault(); }} onClick={() => post({ t: 'select', id: null })}>
        <Header />
        <SectionRenderer sections={sections} editor readonly={!!st.readonly} wrap={wrap} />
        <div className={`sb-endzone ${drag?.overId === '__end' ? 'drop' : ''}`} onDragOver={(e) => { if ([...e.dataTransfer.types].some((t) => t.startsWith('application/x-sb'))) { e.preventDefault(); setDrag({ overId: '__end', before: null }); } }} onDragLeave={() => setDrag(null)} onDrop={(e) => drop(e, null)}>
          {sections.length ? 'Drop a block here to add it at the end' : 'This page is empty — drag a block here or use “Add block” in the panel'}
        </div>
        <Footer />
      </div>
    </SiteProvider>
  );
}
