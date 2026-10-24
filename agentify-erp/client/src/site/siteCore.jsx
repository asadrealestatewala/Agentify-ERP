import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { getRegion } from '../format.js';

const SiteCtx = createContext(null);
export const useSite = () => useContext(SiteCtx);

export const FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather', 'DM Sans', 'Manrope', 'Raleway', 'Work Sans', 'Source Sans 3'];

/** Price text in the workspace's style: "PKR 1.25 Crore" in Pakistan, "$450,000" / "$1.25M" / "£1,850 pcm" / "AED 2.4M" elsewhere. Amounts are in the workspace's stored units. */
export const priceText = (n, purpose) => getRegion().price.priceText(n, purpose);
/** The exact amount in the workspace's style. */
export const fullPrice = (n) => getRegion().price.fullPrice(n);
/** Major units typed by a visitor (e.g. dollars) to the stored unit (cents); unchanged in Pakistan. */
export const minorOf = (major) => Math.round(Number(major || 0) * getRegion().price.unit);
/** Region-specific website wording from the pack's site_copy, with the original text as the fallback (Pakistan). */
export const siteCopy = (key, fallback) => getRegion().config.site_copy?.[key] ?? fallback;
export const isPK = () => getRegion().config.region === 'PK';
/** An example amount for an input hint: the Pakistani figure there, a smaller one elsewhere. */
export const exampleAmount = (pk) => `e.g. ${(isPK() ? pk : Math.round(pk / 20)).toLocaleString(getRegion().config.locale)}`;
/** Currency code shown in input labels. */
export const curCode = () => getRegion().config.currency;
/** Whole-unit input that types with thousands separators (5,000,000) and reads back as a plain number string of major units. */
export function MoneyBox({ value, onChange, placeholder, ...rest }) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  const locale = getRegion().config.locale;
  return (
    <>
      <input inputMode="numeric" autoComplete="off" value={digits ? Number(digits).toLocaleString(locale) : ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} {...rest} />
      {Number(digits) > 0 ? <small className="money-words">{priceText(minorOf(digits))}</small> : null}
    </>
  );
}
export const imgUrl = (p) => (!p ? null : /^(https?:|data:|\/)/.test(p) ? p : `/uploads/${p}`);
export const waLink = (num, text) => `https://wa.me/${String(num || '').replace(/[^\d]/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** A preview link (?preview=…) shows the unpublished draft; the token is kept for the rest of the visit so every page uses it. */
export function previewToken() {
  try {
    const q = new URLSearchParams(window.location.search).get('preview');
    if (q) sessionStorage.setItem('site_preview', q);
    return q || sessionStorage.getItem('site_preview') || '';
  } catch { return ''; }
}
export const withPreview = (url) => { const t = previewToken(); return t ? `${url}${url.includes('?') ? '&' : '?'}preview=${encodeURIComponent(t)}` : url; };

/** Loads the site configuration once and injects theme variables + Google font. `override` powers the live editor preview. */
export function SiteProvider({ children, override }) {
  const [state, setState] = useState(override ? { config: override.config, menu: [] } : null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (override) return;
    api.get(withPreview('/api/site/bootstrap')).then((d) => {
      // an expired or revoked preview link falls back to the live site; forget it so later pages do the same
      if (!d.preview) { try { sessionStorage.removeItem('site_preview'); } catch { /* storage unavailable */ } }
      setState(d);
    }).catch((e) => setErr(e.message));
  }, [override]);
  const config = override?.config || state?.config;
  useOrgSchema(override ? null : config);
  useEffect(() => {
    if (!config) return undefined;
    const fonts = [...new Set([config.theme.font_heading, config.theme.font_body])].filter(Boolean);
    const id = 'site-fonts';
    let link = document.getElementById(id);
    if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
    link.href = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`;
    return undefined;
  }, [config?.theme?.font_heading, config?.theme?.font_body]); // eslint-disable-line
  const value = useMemo(() => (config ? { config, menu: state?.menu || [], preview: !!override, draft: !!state?.preview, workspaceUrl: state?.workspace_url || '' } : null), [config, state, override]);
  if (err) return <div className="site-error">The website could not be loaded: {err}</div>;
  if (state?.offline) return <div className="site-offline" role="status"><h1>{state.company?.name || 'This website'}</h1><p>This website is not available at the moment. Please check back soon.</p></div>;
  if (!value) return <div className="center-box"><span className="spinner" /></div>;
  const t = config.theme;
  const style = {
    '--s-primary': t.primary, '--s-accent': t.accent, '--s-dark': t.dark, '--s-bg': t.bg, '--s-soft': t.soft, '--s-radius': `${t.radius ?? 12}px`,
    '--s-font-h': `'${t.font_heading}', system-ui, sans-serif`, '--s-font-b': `'${t.font_body}', system-ui, sans-serif`,
  };
  return <SiteCtx.Provider value={value}><div className="site" style={style}>{children}</div></SiteCtx.Provider>;
}

/** Tiny markdown: # headings, **bold**, - lists, [text](url), blank-line paragraphs. No raw HTML is ever rendered. */
const HTML_RE = /<\/?(p|h[2-4]|div|ul|ol|figure|img|blockquote|strong|em|span|br)\b/i;
/** HTML written in the rich-text editor. It is sanitised on the server when saved and again when served. */
function RichHtml({ html }) {
  useEffect(() => {
    const fonts = [...new Set([...String(html).matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]))].filter((f) => !['Georgia', 'Times New Roman', 'Arial', 'Courier New'].includes(f));
    if (!fonts.length) return undefined;
    const id = 'rich-fonts'; let link = document.getElementById(id);
    if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
    link.href = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700`).join('&')}&display=swap`;
    return undefined;
  }, [html]);
  return <div className="md rich" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function Markdown({ text }) {
  if (HTML_RE.test(String(text || ''))) return <RichHtml html={String(text)} />;
  const inline = (s) => String(s).split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((p, i) => {
    if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (m) return /^(https?:|\/|mailto:|tel:)/.test(m[2]) ? <a key={i} href={m[2]} {...(/^https?:/.test(m[2]) ? { target: '_blank', rel: 'noreferrer' } : {})}>{m[1]}</a> : p;
    return p;
  });
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}</ul>;
        if (/^#{1,3}\s/.test(b)) { const lvl = b.match(/^#+/)[0].length; const Tag = `h${lvl + 1}`; return <Tag key={i}>{inline(b.replace(/^#+\s*/, ''))}</Tag>; }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </div>
  );
}

const setMeta = (attr, key, content) => {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) { m?.remove(); return; }
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); }
  m.setAttribute('content', content);
};
export function useTitle(title, desc, image) {
  const site = useSite() || {};
  const { config } = site;
  useEffect(() => {
    if (site.preview) return;
    const full = title ? `${title} · ${config?.brand?.name || ''}` : (config?.seo?.title || config?.brand?.name || 'Website');
    const d = desc || config?.seo?.description || '';
    const base = (config?.seo?.base_url || window.location.origin).replace(/\/+$/, '');
    const img = image || config?.seo?.image;
    const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : `${base}${/^\//.test(u) ? u : `/uploads/${u}`}`);
    document.title = full;
    setMeta('name', 'description', d); setMeta('name', 'keywords', config?.seo?.keywords);
    setMeta('name', 'robots', config?.seo?.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    setMeta('property', 'og:title', full); setMeta('property', 'og:description', d); setMeta('property', 'og:type', 'website'); setMeta('property', 'og:site_name', config?.brand?.name);
    setMeta('property', 'og:url', `${base}${window.location.pathname}`); setMeta('property', 'og:image', abs(img));
    setMeta('name', 'twitter:card', img ? 'summary_large_image' : 'summary'); setMeta('name', 'twitter:title', full); setMeta('name', 'twitter:description', d); setMeta('name', 'twitter:image', abs(img));
    let link = document.head.querySelector('link[rel=canonical]'); if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = `${base}${window.location.pathname}`;
  }, [title, desc, image, config]); // eslint-disable-line
}

/** Organisation structured data (JSON-LD) so search engines show the company name, logo, phone and address. */
export function useOrgSchema(config) {
  useEffect(() => {
    if (!config || config.seo?.noindex) return undefined;
    const base = (config.seo?.base_url || window.location.origin).replace(/\/+$/, '');
    const logo = config.brand?.logo ? (/^https?:/.test(config.brand.logo) ? config.brand.logo : `${base}/uploads/${config.brand.logo}`) : undefined;
    const data = { '@context': 'https://schema.org', '@type': config.seo?.org_type || 'RealEstateAgent', name: config.brand?.name, url: `${base}/site`, logo, image: logo, telephone: config.contact?.phone, email: config.contact?.email, description: config.seo?.description,
      address: config.contact?.address ? { '@type': 'PostalAddress', streetAddress: config.contact.address, addressCountry: ({ PK: 'PK', US: 'US', UK: 'GB', AE: 'AE', CA: 'CA' })[getRegion().config.region] || 'PK' } : undefined, openingHours: config.contact?.hours, areaServed: getRegion().config.region === 'PK' ? ['Islamabad', 'Rawalpindi'] : (config.contact?.city ? [config.contact.city] : undefined), sameAs: (config.social || []).map((s) => s.url).filter((u) => /^https?:/.test(u)) };
    let el = document.getElementById('org-schema');
    if (!el) { el = document.createElement('script'); el.id = 'org-schema'; el.type = 'application/ld+json'; document.head.appendChild(el); }
    el.textContent = JSON.stringify(data);
    return undefined;
  }, [config]);
}

/** Link-or-anchor helper: internal /site paths use the router, others open as normal links. */
export const isInternal = (h) => typeof h === 'string' && h.startsWith('/') && !h.startsWith('//');

// ------------------------------------------------------------------ section schema (shared by renderer defaults and the editor)
const opt = (...a) => a.map((x) => (Array.isArray(x) ? { value: x[0], label: x[1] } : { value: x, label: x }));
export const SECTION_TYPES = {
  hero: { label: 'Hero banner', icon: '🖼️', desc: 'Big headline with image and property search', defaults: { headline: 'Find your place', subheadline: 'Plots, homes and commercial spaces with flexible installment plans.', image: '', overlay: 55, show_search: true, height: 'tall', cta_label: '', cta_href: '' },
    fields: [{ key: 'headline', label: 'Headline', type: 'text' }, { key: 'subheadline', label: 'Sub-headline', type: 'textarea' }, { key: 'image', label: 'Background image', type: 'image' }, { key: 'overlay', label: 'Dark overlay %', type: 'range', min: 0, max: 90 }, { key: 'height', label: 'Height', type: 'select', options: opt(['tall', 'Tall'], ['medium', 'Medium']) }, { key: 'show_search', label: 'Show property search box', type: 'bool' }, { key: 'cta_label', label: 'Button text', type: 'text' }, { key: 'cta_href', label: 'Button link', type: 'text' }] },
  listings: { label: 'Property listings', icon: '🏠', desc: 'Featured, latest or filtered properties', defaults: { title: 'Featured properties', subtitle: '', source: 'featured', project_id: '', property_type: '', purpose: '', limit: 8, layout: 'grid', view_all_href: '/site/properties' },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'source', label: 'Show', type: 'select', options: opt(['featured', 'Featured properties'], ['latest', 'Latest listings'], ['project', 'From one project'], ['type', 'One property type']) }, { key: 'project_id', label: 'Project', type: 'project', showIf: (p) => p.source === 'project' }, { key: 'property_type', label: 'Property type', type: 'ptype', showIf: (p) => p.source === 'type' }, { key: 'purpose', label: 'Purpose', type: 'select', options: opt(['', 'Any'], ['Sell', 'For sale'], ['Rent', 'For rent']) }, { key: 'limit', label: 'How many', type: 'number', min: 1, max: 24 }, { key: 'layout', label: 'Layout', type: 'select', options: opt(['grid', 'Grid'], ['carousel', 'Scrolling carousel']) }, { key: 'view_all_href', label: '“View all” link', type: 'text' }] },
  projects: { label: 'Projects', icon: '🏗️', desc: 'Project cards with progress', defaults: { title: 'Our projects', subtitle: '', limit: 3 }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'limit', label: 'How many', type: 'number', min: 1, max: 12 }] },
  stats: { label: 'Numbers / stats', icon: '📊', desc: 'Years, projects, customers…', defaults: { items: [{ value: '10+', label: 'Years' }, { value: '500+', label: 'Customers' }] }, fields: [{ key: 'items', label: 'Numbers', type: 'list', item: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'label', label: 'Label', type: 'text' }], blank: { value: '', label: '' } }] },
  services: { label: 'Services', icon: '🧩', desc: 'Icon cards with links', defaults: { title: 'How we help', items: [{ icon: '🏡', title: 'Buy', text: 'Browse verified properties.', href: '/site/properties' }] }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'items', label: 'Cards', type: 'list', item: [{ key: 'icon', label: 'Icon (emoji)', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'href', label: 'Link', type: 'text' }], blank: { icon: '⭐', title: '', text: '', href: '' } }] },
  calculators: { label: 'Calculators', icon: '🧮', desc: 'Installment plan & construction calculators', defaults: { title: 'Plan your purchase', subtitle: '' }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }] },
  agents: { label: 'Listing agents', icon: '🧑‍💼', desc: 'Agents who publish listings, with contact buttons', defaults: { title: 'Meet our agents', subtitle: '', limit: 4 }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'limit', label: 'How many', type: 'number', min: 1, max: 12 }] },
  testimonials: { label: 'Testimonials', icon: '💬', desc: 'Customer quotes', defaults: { title: 'What customers say', items: [{ name: '', role: '', quote: '' }] }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'items', label: 'Quotes', type: 'list', item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'quote', label: 'Quote', type: 'textarea' }], blank: { name: '', role: '', quote: '' } }] },
  partners: { label: 'Partner logos', icon: '🤝', desc: 'Logos of companies you work with. Add only companies that agreed to be listed.', defaults: { title: 'Our partners', items: [{ name: '', logo: '', href: '' }] },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'items', label: 'Partners (only companies that agreed to be listed)', type: 'list', item: [{ key: 'name', label: 'Company', type: 'text' }, { key: 'logo', label: 'Logo', type: 'image' }, { key: 'href', label: 'Website (optional)', type: 'text' }], blank: { name: '', logo: '', href: '' } }] },
  reviews: { label: 'Customer reviews', icon: '⭐', desc: 'Shows approved reviews and lets visitors send one. You approve each in the Reviews tab.', defaults: { title: 'What our customers say', subtitle: '', limit: 12 }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'limit', label: 'How many to show', type: 'number', min: 1, max: 30 }] },
  embed: { label: 'Video, map or calendar', icon: '▶️', desc: 'YouTube, Vimeo, Google Maps, OpenStreetMap or Calendly', defaults: { title: '', url: '', height: 420 }, fields: [{ key: 'title', label: 'Title (optional)', type: 'text' }, { key: 'url', label: 'Link (YouTube or Vimeo video, Google Maps embed link, Calendly page)', type: 'text' }, { key: 'height', label: 'Height (px)', type: 'number', min: 200, max: 900 }] },
  blog: { label: 'Latest blog posts', icon: '📰', desc: 'Newest published articles', defaults: { title: 'From the blog', limit: 3 }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'limit', label: 'How many', type: 'number', min: 1, max: 9 }] },
  cta: { label: 'Call to action', icon: '📣', desc: 'Banner with a button', defaults: { headline: 'Ready to get started?', text: '', button_label: 'Contact us', button_href: '/site/p/contact', image: '', tone: 'dark' }, fields: [{ key: 'headline', label: 'Headline', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'button_label', label: 'Button text', type: 'text' }, { key: 'button_href', label: 'Button link', type: 'text' }, { key: 'image', label: 'Background image', type: 'image' }, { key: 'tone', label: 'Colour', type: 'select', options: opt(['dark', 'Dark'], ['primary', 'Primary colour'], ['light', 'Light']) }] },
  text: { label: 'Text block', icon: '📝', desc: 'Headline and paragraphs', defaults: { title: '', html: 'Write here…', align: 'left' }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'html', label: 'Text', type: 'rich' }, { key: 'align', label: 'Alignment', type: 'select', options: opt(['left', 'Left'], ['center', 'Centre']) }] },
  imagetext: { label: 'Image + text', icon: '🖼️', desc: 'Picture beside copy', defaults: { title: '', text: '', image: '', image_side: 'right', button_label: '', button_href: '' }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea', rows: 6 }, { key: 'image', label: 'Image', type: 'image' }, { key: 'image_side', label: 'Image side', type: 'select', options: opt(['right', 'Right'], ['left', 'Left']) }, { key: 'button_label', label: 'Button text', type: 'text' }, { key: 'button_href', label: 'Button link', type: 'text' }] },
  faq: { label: 'FAQ', icon: '❓', desc: 'Questions and answers', defaults: { title: 'Frequently asked questions', items: [{ q: '', a: '' }] }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'items', label: 'Questions', type: 'list', item: [{ key: 'q', label: 'Question', type: 'text' }, { key: 'a', label: 'Answer', type: 'textarea' }], blank: { q: '', a: '' } }] },
  contact: { label: 'Contact form', icon: '✉️', desc: 'Enquiry form + contact details (creates CRM leads)', defaults: { title: 'Contact us', text: '', show_form: true, show_details: true }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Intro', type: 'textarea' }, { key: 'show_form', label: 'Show enquiry form', type: 'bool' }, { key: 'show_details', label: 'Show phone / email / address', type: 'bool' }] },
  gallery: { label: 'Image gallery', icon: '🖼️', desc: 'Grid of photos', defaults: { title: 'Gallery', images: [] }, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'images', label: 'Photos', type: 'list', item: [{ key: 'src', label: 'Image', type: 'image' }, { key: 'caption', label: 'Caption', type: 'text' }], blank: { src: '', caption: '' } }] },
  leadership: { label: 'Director & team', icon: '👔', desc: 'Directors and team members with photo, role and contact — add as many as you need', defaults: { title: 'Leadership & team', subtitle: '', members: [{ name: '', role: '', bio: '', photo: '', phone: '', email: '', director: true }] },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'members', label: 'Directors & team members (use “Add” for another director or team member)', type: 'list', item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'role', label: 'Role / designation', type: 'text' }, { key: 'director', label: 'Show as a director (large card)', type: 'bool' }, { key: 'photo', label: 'Photo', type: 'image' }, { key: 'bio', label: 'About', type: 'textarea' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }], blank: { name: '', role: '', bio: '', photo: '', phone: '', email: '', director: false } }] },
  projectinfo: { label: 'Company & project information', icon: '🗂️', desc: 'Track record numbers plus lists of ongoing, personal and other projects', defaults: { title: 'Our projects', intro: '', stats: [{ value: '200+', label: 'Plots sold' }], groups: [{ heading: 'Ongoing projects', items: 'Project name | what was sold\nAnother project' }] },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'intro', label: 'Introduction', type: 'textarea', rows: 4 }, { key: 'stats', label: 'Track-record numbers', type: 'list', item: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'label', label: 'Label', type: 'text' }], blank: { value: '', label: '' } }, { key: 'groups', label: 'Project lists', type: 'list', item: [{ key: 'heading', label: 'Heading (e.g. Ongoing projects)', type: 'text' }, { key: 'items', label: 'One project per line. Add details after a “|” (e.g. B-17 Islamabad | 13+ plots sold)', type: 'textarea', rows: 6 }], blank: { heading: '', items: '' } }] },
  columns: { label: 'Columns', icon: '▥', desc: 'Flexible 1–4 column layout with image, text and button', defaults: { title: '', subtitle: '', cols: 3, valign: 'top', items: [{ image: '', title: 'First column', text: 'Write something here.', button_label: '', button_href: '' }, { image: '', title: 'Second column', text: 'Write something here.', button_label: '', button_href: '' }, { image: '', title: 'Third column', text: 'Write something here.', button_label: '', button_href: '' }] },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'cols', label: 'Columns on desktop (tablet and mobile can differ in the Layout tab)', type: 'select', options: opt(['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']) }, { key: 'valign', label: 'Vertical alignment', type: 'select', options: opt(['top', 'Top'], ['center', 'Middle']) }, { key: 'items', label: 'Columns', type: 'list', item: [{ key: 'image', label: 'Image', type: 'image' }, { key: 'title', label: 'Heading', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea', rows: 4 }, { key: 'button_label', label: 'Button text', type: 'text' }, { key: 'button_href', label: 'Button link', type: 'text' }], blank: { image: '', title: '', text: '', button_label: '', button_href: '' } }] },
  spacer: { label: 'Spacer', icon: '↕️', desc: 'Empty vertical space between blocks', defaults: { height: 40 }, fields: [{ key: 'height', label: 'Height (px)', type: 'number', min: 0, max: 400 }] },
  livestats: { label: 'Live numbers (from the ERP)', icon: '📈', desc: 'Available properties, live projects, sold units… updated automatically', defaults: { items: [{ metric: 'listings', label: 'Properties available', suffix: '' }, { metric: 'projects', label: 'Live projects', suffix: '' }, { metric: 'sold', label: 'Properties sold', suffix: '+' }] },
    fields: [{ key: 'items', label: 'Numbers', type: 'list', item: [{ key: 'metric', label: 'Data from the ERP', type: 'select', options: opt(['listings', 'Properties available'], ['featured', 'Featured properties'], ['for_rent', 'Properties for rent'], ['sold', 'Properties sold'], ['projects', 'Live projects'], ['agents', 'Listing agents'], ['articles', 'Articles published']) }, { key: 'label', label: 'Label', type: 'text' }, { key: 'suffix', label: 'After the number (e.g. +)', type: 'text' }], blank: { metric: 'listings', label: '', suffix: '' } }] },
  booking: { label: 'Book a site visit', icon: '📅', desc: 'Visit-booking form: project, date and time slot → CRM lead', defaults: { title: 'Book a site visit', subtitle: 'Pick a day and time — our agent will confirm by phone.', slots: '10:00 AM\n12:00 PM\n3:00 PM\n5:00 PM', skip_friday: false },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'slots', label: 'Time slots (one per line)', type: 'textarea', rows: 5 }, { key: 'skip_friday', label: 'No visits on Fridays', type: 'bool' }] },
  portal: { label: 'Portal sign-in', icon: '🔑', desc: 'Customer and vendor portal sign-in cards', defaults: { title: 'Already a customer or vendor?', subtitle: 'Sign in to your portal.', show_customer: true, show_vendor: true },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'show_customer', label: 'Show the customer portal', type: 'bool' }, { key: 'show_vendor', label: 'Show the vendor portal', type: 'bool' }] },
  banner: { label: 'Page banner', icon: '🎌', desc: 'Slim headline strip', defaults: { text: 'Welcome', href: '', tone: 'primary' }, fields: [{ key: 'text', label: 'Text', type: 'text' }, { key: 'href', label: 'Link (optional)', type: 'text' }, { key: 'tone', label: 'Colour', type: 'select', options: opt(['primary', 'Primary'], ['dark', 'Dark'], ['accent', 'Accent']) }] },
};
