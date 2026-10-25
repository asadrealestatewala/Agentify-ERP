import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Puck, usePuck } from '@puckeditor/core';
import '@puckeditor/core/no-external.css'; // the default stylesheet loads a font from rsms.me, which the CSP blocks
import RichEditor from '../../components/RichEditor.jsx';
import StyleEditor from '../../components/StyleEditor.jsx';
import BuilderCanvas from '../../components/BuilderCanvas.jsx';
import { ConfirmDialog, Field, Loading, Modal, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useAuth, useLookups, useToast } from '../../context.jsx';
import { FONTS, SECTION_TYPES, SiteProvider } from '../../site/siteCore.jsx';
import { SectionRenderer, ShowEmptyCtx } from '../../site/components.jsx';
import { Header, Footer } from '../../site/SiteApp.jsx';
import { SITE_THEMES, listingPhotos, themeConfig, themePages } from '../../site/themeBuild.js';
import { BlogTab, FieldRow, ImagePicker, LINKS, PublishPanel, ReviewsTab, SITE_GROUPS, getPath, setPath } from './siteShared.jsx';
import { toPuck, fromPuck } from '../../../../shared/puckAdapter.js';

/**
 * The website editor ("Website studio"): one place for the whole website, laid out like a site editor.
 * Left: the design menu (pages, themes, identity, styles, navigation, blog, reviews, settings, publishing) and, while a
 * page is open, its blocks and outline. Middle: the page as visitors will see it, at desktop, tablet or phone width.
 * Right: the settings of the selected block. Everything is a draft until Publish, through the same /api/site-admin API.
 */

// ---------------------------------------------------------------- site configuration shared with the canvas
// The canvas renders inside Puck's iframe; it reads the draft configuration from this small store so colour and font
// changes show at once without rebuilding the editor.
function createCfgStore() {
  let value = null; const subs = new Set();
  return { get: () => value, set: (v) => { value = v; subs.forEach((f) => f()); }, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };
}
const cfgStore = createCfgStore();
const useCanvasCfg = () => useSyncExternalStore(cfgStore.subscribe, cfgStore.get);

const StudioCtx = createContext({ device: 'desktop', setDevice: () => {} });
const DEVICES = [['desktop', 'Desktop', 1280, '🖥'], ['tablet', 'Tablet', 768, '📱'], ['mobile', 'Phone', 375, '📲']];

// ---------------------------------------------------------------- block fields in Puck's terms
const opts = (list) => list.map((o) => (typeof o === 'object' ? { label: String(o.label ?? o.value), value: o.value } : { label: String(o), value: o }));
const summary = (item) => String(Object.values(item || {}).find((v) => typeof v === 'string' && v.trim()) || 'Item').slice(0, 40);
const box = (label, node) => <div className="pk-field"><span className="pk-label">{label}</span>{node}</div>;

function puckField(f, ctx) {
  const label = f.label;
  switch (f.type) {
    case 'textarea': return { type: 'textarea', label };
    case 'number': case 'range': return { type: 'number', label, min: f.min, max: f.max, step: f.step };
    case 'bool': return { type: 'radio', label, options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] };
    case 'select': return { type: 'select', label, options: opts(f.options) };
    case 'font': return { type: 'select', label, options: opts(FONTS) };
    case 'project': return { type: 'select', label, options: [{ label: 'Choose a project', value: '' }, ...ctx.projects.map((p) => ({ label: p.name, value: p.id }))] };
    case 'ptype': return { type: 'select', label, options: [{ label: 'Any type', value: '' }, ...opts(ctx.ptypes)] };
    case 'image': return { type: 'custom', label, render: ({ value, onChange }) => box(label, <ImagePicker value={value || ''} onChange={onChange} />) };
    case 'rich': return { type: 'custom', label, render: ({ value, onChange }) => box(label, <RichEditor value={value || ''} onChange={onChange} minHeight={180} />) };
    case 'color': return { type: 'custom', label, render: ({ value, onChange }) => box(label, <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />) };
    case 'lines': return { type: 'custom', label, render: ({ value, onChange }) => box(label, <textarea className="textarea" rows={5} value={(value || []).join('\n')} onChange={(e) => onChange(e.target.value.split('\n').slice(0, 8))} />) };
    case 'list': {
      const arrayFields = Object.fromEntries(f.item.map((x) => [x.key, puckField(x, ctx)]));
      return { type: 'array', label, arrayFields, defaultItemProps: JSON.parse(JSON.stringify(f.blank || {})), getItemSummary: summary };
    }
    default: return { type: 'text', label };
  }
}

/** Spacing, background, alignment and per-device visibility of a block (the same settings as the classic editor's Layout tab). */
function StyleFieldBox({ value, onChange }) {
  const { device, setDevice } = useContext(StudioCtx);
  return (
    <details className="pk-style" open={!!value}>
      <summary>Layout, spacing and mobile</summary>
      <StyleEditor style={value || {}} device={device} setDevice={setDevice} ImagePicker={ImagePicker} onChange={onChange} />
    </details>
  );
}
const STYLE_FIELD = { type: 'custom', label: 'Layout, spacing and mobile', render: ({ value, onChange }) => <StyleFieldBox value={value} onChange={onChange} /> };

function CanvasRoot({ children }) {
  const cfg = useCanvasCfg();
  if (!cfg) return null;
  return <ShowEmptyCtx.Provider value><SiteProvider override={{ config: cfg }}><Header /><main id="site-main">{children}</main><Footer /></SiteProvider></ShowEmptyCtx.Provider>;
}

export const PALETTE = [
  ['layout', 'Layout', ['columns', 'imagetext', 'text', 'spacer', 'gallery', 'embed', 'banner', 'cta']],
  ['erp', 'Data from the ERP', ['listings', 'projects', 'agents', 'livestats', 'blog', 'calculators', 'contact', 'booking', 'portal']],
  ['content', 'Content', ['hero', 'stats', 'services', 'testimonials', 'reviews', 'partners', 'faq', 'leadership', 'projectinfo']],
];

function buildConfig(ctx) {
  const components = {};
  for (const [type, T] of Object.entries(SECTION_TYPES)) {
    const fields = { ...Object.fromEntries(T.fields.map((f) => [f.key, puckField(f, ctx)])), __style: STYLE_FIELD };
    const conditional = T.fields.some((f) => f.showIf);
    components[type] = {
      label: `${T.icon} ${T.label}`,
      defaultProps: JSON.parse(JSON.stringify(T.defaults)),
      fields,
      ...(conditional ? { resolveFields: (data) => ({ ...Object.fromEntries(T.fields.filter((f) => !f.showIf || f.showIf(data.props || {})).map((f) => [f.key, fields[f.key]])), __style: STYLE_FIELD }) } : {}),
      render: ({ id, __style, __extra, __numId, __noProps, puck, editMode, ...props }) => <SectionRenderer sections={[{ id, type, props, style: __style }]} />, // eslint-disable-line no-unused-vars
    };
  }
  return {
    categories: Object.fromEntries(PALETTE.map(([k, title, list]) => [k, { title, components: list }])),
    components,
    root: { fields: {}, render: CanvasRoot },
  };
}

// ---------------------------------------------------------------- sidebar panels
const SIDE_MENU = [
  ['pages', 'Pages', '📄', 'Edit, add and arrange the pages of your website.'],
  ['themes', 'Themes', '🎨', 'Ready-made website designs. Preview one, then install it.'],
  ['identity', 'Identity', '🪪', 'Name, logo, contact details and social profiles.'],
  ['styles', 'Styles', '🖌️', 'Colours, fonts, corners, header and footer look.'],
  ['navigation', 'Navigation', '🧭', 'Header menu, header button and footer links.'],
  ['blog', 'Blog', '📰', 'Articles for your website.'],
  ['reviews', 'Reviews', '⭐', 'Approve reviews visitors send before they appear.'],
  ['settings', 'Settings', '⚙️', 'Search engines, listings, chatbot and calculators.'],
  ['publish', 'Publish and history', '🚀', 'Put the website live, share a preview, go back to an earlier version.'],
];

const groupFields = (id) => SITE_GROUPS.find((g) => g.id === id)?.fields || [];
const STYLE_EXTRA = [
  { key: 'header.style', label: 'Header look', type: 'select', options: [{ value: 'light', label: 'White' }, { value: 'dark', label: 'Dark' }, { value: 'transparent', label: 'See-through over the first block' }] },
  { key: 'header.topbar', label: 'Show a top bar with phone, email and social icons', type: 'bool' },
  { key: 'header.sticky', label: 'Keep the header fixed while scrolling', type: 'bool' },
  { key: 'footer.style', label: 'Footer look', type: 'select', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] },
];
const PANEL_FIELDS = {
  identity: [...groupFields('brand'), ...groupFields('contact'), ...groupFields('social')],
  styles: [...groupFields('theme'), ...STYLE_EXTRA],
  navigation: [LINKS({ key: 'header.links', label: 'Header menu links' }), { key: 'header.cta_label', label: 'Header button text', type: 'text' }, { key: 'header.cta_href', label: 'Header button link', type: 'text' }, { key: 'header.show_phone', label: 'Show the phone number in the header', type: 'bool' }, ...groupFields('footer')],
};
const SETTINGS_GROUPS = ['seo', 'listing', 'bot', 'calc'];

function ConfigFields({ fields, cfg, setCfg, ctx }) {
  return <div className="stack" style={{ gap: 12 }}>{fields.map((f) => <FieldRow key={f.key} f={f} value={getPath(cfg, f.key)} ctx={ctx} onChange={(v) => setCfg((c) => setPath(c, f.key, v))} />)}</div>;
}

function SettingsPanel({ cfg, setCfg, ctx }) {
  const [open, setOpen] = useState('seo');
  return (
    <div className="stack" style={{ gap: 8 }}>
      {SITE_GROUPS.filter((g) => SETTINGS_GROUPS.includes(g.id)).map((g) => (
        <div key={g.id} className="st-acc">
          <button type="button" className="st-acc-h" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? '' : g.id)}><span>{g.title}</span><span aria-hidden="true">{open === g.id ? '−' : '+'}</span></button>
          {open === g.id && <div className="st-acc-b"><ConfigFields fields={g.fields} cfg={cfg} setCfg={setCfg} ctx={ctx} /></div>}
        </div>
      ))}
      <a className="st-link" href="/website/seo">Open the SEO manager ↗</a>
      <a className="st-link" href="/website/assistant">Chatbot knowledge ↗</a>
    </div>
  );
}

function PagesPanel({ pages, pageId, onOpen, onNew, canCreate }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {pages.map((p) => (
        <button key={p.id} type="button" className={`st-item ${p.id === pageId ? 'on' : ''}`} onClick={() => onOpen(p.id)}>
          <span aria-hidden="true">{p.slug === 'home' ? '🏠' : '📄'}</span>
          <span className="grow"><b>{p.title}</b><small>{p.slug === 'home' ? '/site' : `/site/p/${p.slug}`}{p.published ? '' : ' · hidden'}{p.show_in_menu ? ' · in menu' : ''}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      ))}
      {canCreate && <button type="button" className="st-btn" onClick={onNew}>+ Add a page</button>}
    </div>
  );
}

function ThemesPanel({ active, onPreview, previewing }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {SITE_THEMES.map((t) => (
        <button key={t.id} type="button" className={`st-theme ${previewing === t.id ? 'on' : ''}`} onClick={() => onPreview(t)}>
          <span className="st-theme-sw" aria-hidden="true">{['primary', 'accent', 'dark', 'soft'].map((k) => <i key={k} style={{ background: t.design.theme[k] }} />)}</span>
          <span className="grow">
            <b>{t.name}{active === t.id && <em className="st-pill">Installed</em>}</b>
            <small className="st-kind">{t.kind} · {t.design.theme.font_heading}</small>
            <small>{t.tagline}</small>
          </span>
        </button>
      ))}
      <p className="st-note">Every theme is built from the normal blocks, so you can change any text, photo, colour or font after installing it. Photos come from your own listings; replace them with your own pictures.</p>
    </div>
  );
}

function PagePanel({ meta, setMeta, page, canDelete, canCreate, onDuplicate, onDelete }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Field label="Page title"><input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
      {page.slug !== 'home' && <Field label="Web address" hint={`/site/p/${meta.slug}`}><input className="input" value={meta.slug} onChange={(e) => setMeta({ ...meta, slug: e.target.value })} /></Field>}
      <Toggle value={!!meta.published} onChange={(v) => setMeta({ ...meta, published: v })} label="Show this page on the website" />
      {page.slug !== 'home' && <Toggle value={!!meta.show_in_menu} onChange={(v) => setMeta({ ...meta, show_in_menu: v })} label="Show in the header menu" />}
      <Field label="Search-engine title"><input className="input" value={meta.seo_title || ''} onChange={(e) => setMeta({ ...meta, seo_title: e.target.value })} /></Field>
      <Field label="Search-engine description"><textarea className="textarea" rows={3} value={meta.seo_desc || ''} onChange={(e) => setMeta({ ...meta, seo_desc: e.target.value })} /></Field>
      <div className="row wrap" style={{ gap: 6 }}>
        {canCreate && <button type="button" className="st-btn sm" onClick={onDuplicate}>Duplicate page</button>}
        {page.slug !== 'home' && canDelete && <button type="button" className="st-btn sm danger" onClick={onDelete}>Delete page</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top bar (inside Puck, for undo and redo)
function TopBar({ title, device, setDevice, dirty, busy, pub, onSave, onPublish, editing }) {
  const { history } = usePuck();
  return (
    <div className="st-top">
      <a className="st-wp" href="/" title="Back to the dashboard" aria-label="Back to the dashboard">⌂</a>
      <span className="st-top-title">{title}</span>
      <span className="grow" />
      <div className="st-dev" role="group" aria-label="Preview width">{DEVICES.map(([k, l, , ic]) => <button key={k} type="button" className={device === k ? 'on' : ''} onClick={() => setDevice(k)} aria-pressed={device === k} title={l}>{ic}<span> {l}</span></button>)}</div>
      {editing && <><button type="button" className="st-tb" disabled={!history.hasPast} onClick={history.back} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button><button type="button" className="st-tb" disabled={!history.hasFuture} onClick={history.forward} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button></>}
      <a className="st-tb txt" href="/site" target="_blank" rel="noreferrer">View site ↗</a>
      <button type="button" className="st-tb txt" disabled={!dirty || busy} onClick={onSave}>{busy ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}</button>
      <button type="button" className={`st-tb txt primary ${dirty || pub?.changes || pub?.offline ? '' : 'quiet'}`} onClick={onPublish}>{pub?.offline ? 'Offline · Publish' : dirty || pub?.changes ? 'Publish…' : 'Published ✓'}</button>
    </div>
  );
}

/** Clicking a block on the page while another panel is open switches to editing that page, like a site editor. */
function SelectionWatcher({ onSelect }) {
  const { selectedItem } = usePuck();
  const id = selectedItem?.props?.id;
  useEffect(() => { if (id) onSelect(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function NoSelection() {
  const { selectedItem } = usePuck();
  if (selectedItem) return null;
  return <div className="st-hint"><b>Select a block</b><p>Click any block on the page to change its text, photos and settings here. Drag blocks from the left to add them; drag on the page to move them.</p></div>;
}

// ---------------------------------------------------------------- theme install dialog
function InstallDialog({ theme, built, onClose, onDone }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [design, setDesign] = useState(true);
  const [modes, setModes] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/api/site-admin/themes').then((r) => {
      const t = r.themes.find((x) => x.id === theme.id); setInfo(t);
      setModes(Object.fromEntries(t.pages.map((p) => [p.slug, p.exists ? 'replace' : 'add'])));
    }).catch((e) => toast(e.message, 'err'));
  }, [theme.id, toast]);
  const go = async () => {
    setBusy(true);
    try {
      const pages = built.pages.map((p) => ({ slug: p.slug, mode: modes[p.slug] || 'skip', sections: p.sections }));
      const r = await api.post(`/api/site-admin/themes/${theme.id}/install`, { design, pages });
      toast(`${theme.name} installed as a draft. Check the pages, then Publish to put it live.`, 'ok');
      onDone(r);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const nothing = !design && !Object.values(modes).some((m) => m !== 'skip');
  return (
    <Modal title={`Install the ${theme.name} theme`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!info || busy || nothing} onClick={go}>{busy ? 'Installing…' : 'Install as a draft'}</button></>}>
      {!info ? <Loading /> : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Choose what to install. Visitors keep seeing your current website until you press Publish. A page you replace keeps its current layout in its version history, and “Discard unpublished changes” in Publish takes everything back to the live website.</p>
          <Toggle value={design} onChange={setDesign} label={`Use the theme's colours, fonts, header and footer (${theme.design.theme.font_heading} / ${theme.design.theme.font_body})`} />
          <table className="table"><thead><tr><th>Page</th><th>On your website now</th><th>What to do</th></tr></thead><tbody>
            {info.pages.map((p) => (
              <tr key={p.slug}><td><b>{p.title}</b><div className="muted" style={{ fontSize: 12 }}>{p.slug === 'home' ? '/site' : `/site/p/${p.slug}`}</div></td>
                <td>{p.exists ? 'A page with this address exists' : 'New page'}</td>
                <td><select className="select" value={modes[p.slug]} onChange={(e) => setModes({ ...modes, [p.slug]: e.target.value })} aria-label={`What to do with ${p.title}`}>
                  {p.exists && <option value="replace">Replace my page (kept in history)</option>}
                  <option value="add">{p.exists ? 'Add beside it as a hidden page' : 'Add this page'}</option>
                  <option value="skip">Skip</option>
                </select></td></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- the editor
export default function WebsiteStudio() {
  const toast = useToast();
  const { can } = useAuth();
  const { projects, list } = useLookups();
  const ctx = useMemo(() => ({ projects, ptypes: list('property_type') }), [projects, list]);
  const canEdit = can('website', 'edit');
  const [pages, setPages] = useState(null);
  const [page, setPage] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cfg, setCfgState] = useState(null);
  const savedCfg = useRef('');
  const savedSections = useRef('');
  const savedMeta = useRef('');
  const latest = useRef(null);
  const [pageDirty, setPageDirty] = useState(false);
  const [view, setView] = useState('root');
  const [tab, setTab] = useState('blocks');
  const [device, setDevice] = useState('desktop');
  const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState(null);
  const [pubOpen, setPubOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { theme, built: { pages, config }, page: index }
  const [installing, setInstalling] = useState(null);
  const [newPage, setNewPage] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(true);
  const [epoch, setEpoch] = useState(0); // remounts the canvas after a theme install or discard

  const setCfg = useCallback((fn) => setCfgState((c) => { const n = typeof fn === 'function' ? fn(c) : fn; cfgStore.set(n); return n; }), []);
  const loadPub = useCallback(() => api.get('/api/site-admin/publish').then(setPub).catch(() => {}), []);
  const loadCfg = useCallback(async () => { const c = await api.get('/api/site-admin/config'); savedCfg.current = JSON.stringify(c); setCfg(c); }, [setCfg]);
  const loadPages = useCallback(() => api.get('/api/site-admin/pages').then((l) => { setPages(l); return l; }), []);
  const openPage = useCallback(async (id) => {
    const p = await api.get(`/api/site-admin/pages/${id}`);
    const m = { title: p.title, slug: p.slug, published: !!p.published, show_in_menu: !!p.show_in_menu, seo_title: p.seo_title || '', seo_desc: p.seo_desc || '' };
    latest.current = null; savedSections.current = JSON.stringify(p.sections); savedMeta.current = JSON.stringify(m);
    setPage(p); setMeta(m); setPageDirty(false);
  }, []);
  useEffect(() => {
    loadPub(); loadCfg();
    loadPages().then((l) => { const home = l.find((p) => p.slug === 'home') || l[0]; if (home) openPage(home.id); });
  }, [loadPub, loadCfg, loadPages, openPage]);

  const config = useMemo(() => buildConfig(ctx), [ctx]);
  const data = useMemo(() => (page ? toPuck(page.sections) : null), [page]);
  const cfgDirty = !!cfg && JSON.stringify(cfg) !== savedCfg.current;
  const metaDirty = !!meta && JSON.stringify(meta) !== savedMeta.current;
  const dirty = cfgDirty || pageDirty || metaDirty;
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const save = async () => {
    setBusy(true);
    try {
      if (cfgDirty) { await api.put('/api/site-admin/config', cfg); savedCfg.current = JSON.stringify(cfg); }
      if (pageDirty || metaDirty) {
        const sections = latest.current ? fromPuck(latest.current) : page.sections;
        const p = await api.put(`/api/site-admin/pages/${page.id}`, { ...meta, sections });
        savedSections.current = JSON.stringify(p.sections); savedMeta.current = JSON.stringify(meta);
        setPageDirty(false); loadPages();
      }
      setCfgState((c) => ({ ...c })); // re-evaluate dirty flags
      toast('Draft saved. Press Publish to put it live.', 'ok');
      loadPub();
    } catch (e) { toast(e.message, 'err'); throw e; } finally { setBusy(false); }
  };
  const confirmLeave = () => !(pageDirty || metaDirty) || window.confirm('This page has unsaved changes. Leave it anyway?');
  const switchPage = (id) => { if (id === page?.id) { setView('edit'); return; } if (!confirmLeave()) return; openPage(id).then(() => setView('edit')); };
  const reloadAll = async () => { await loadCfg(); const l = await loadPages(); const keep = l.find((p) => p.id === page?.id) || l.find((p) => p.slug === 'home') || l[0]; if (keep) await openPage(keep.id); setEpoch((e) => e + 1); loadPub(); };

  const previewTheme = async (t) => {
    const photos = await listingPhotos();
    const built = { pages: themePages(t, photos), config: themeConfig(cfg, t) };
    setPreview({ theme: t, built, page: 0 });
  };

  if (!canEdit) return null;
  if (!pages || !page || !cfg || !data) return <Loading />;
  const menuItem = SIDE_MENU.find((m) => m[0] === view);
  const pv = preview && preview.built.pages[preview.page];
  const width = DEVICES.find((d) => d[0] === device)[2];

  return (
    <StudioCtx.Provider value={{ device, setDevice }}>
      <div className={`st-shell ${mobilePanel ? 'm-panel' : 'm-canvas'}`}>
        <Puck key={`${page.id}-${epoch}`} config={config} data={data} iframe={{ enabled: true, waitForStyles: true }} viewports={DEVICES.map(([, label, w]) => ({ width: w, height: 'auto', label }))}
          onChange={(d) => { latest.current = d; setPageDirty(JSON.stringify(fromPuck(d)) !== savedSections.current); }}>
          <TopBar title={view === 'edit' ? `Editing: ${meta.title}` : preview ? `Theme preview: ${preview.theme.name}` : 'Website studio'} device={device} setDevice={setDevice} dirty={dirty} busy={busy} pub={pub} editing={view === 'edit'} onSave={() => save().catch(() => {})} onPublish={() => setPubOpen(true)} />
          <SelectionWatcher onSelect={() => { if (!preview && view !== 'edit') { setView('edit'); setTab('blocks'); } }} />
          <div className="st-body">
            <aside className="st-side" aria-label="Website design menu">
              {view === 'root' && (
                <>
                  <div className="st-side-h"><h2>Design</h2><p>Customise your website: pages, theme, colours, fonts and menus. Changes are drafts until you publish.</p></div>
                  <nav className="st-menu">{SIDE_MENU.map(([k, l, ic]) => <button key={k} type="button" onClick={() => { setView(k); setPreview(null); }}><span className="ic" aria-hidden="true">{ic}</span><span className="grow">{l}</span><span aria-hidden="true">›</span></button>)}</nav>
                </>
              )}
              {view === 'edit' && (
                <>
                  <div className="st-side-h row"><button type="button" className="st-back" onClick={() => setView('pages')} aria-label="Back to pages">‹</button><h2 className="grow">{meta.title}</h2></div>
                  <div className="st-tabs" role="tablist">{[['blocks', 'Add blocks'], ['outline', 'Outline'], ['page', 'Page']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
                  <div className="st-scroll st-puck">
                    {tab === 'blocks' && <Puck.Components />}
                    {tab === 'outline' && <Puck.Outline />}
                    {tab === 'page' && <PagePanel meta={meta} setMeta={setMeta} page={page} canDelete={can('website', 'delete')} canCreate={can('website', 'create')}
                      onDuplicate={async () => { if (!confirmLeave()) return; const r = await api.post(`/api/site-admin/pages/${page.id}/duplicate`); await loadPages(); await openPage(r.id); toast('Page duplicated. It stays hidden until you show it.', 'ok'); }}
                      onDelete={() => setConfirmDel(true)} />}
                  </div>
                </>
              )}
              {view !== 'root' && view !== 'edit' && (
                <>
                  <div className="st-side-h row"><button type="button" className="st-back" onClick={() => { setView('root'); setPreview(null); }} aria-label="Back">‹</button><div className="grow"><h2>{menuItem?.[1]}</h2><p>{menuItem?.[3]}</p></div></div>
                  <div className="st-scroll">
                    {view === 'pages' && <PagesPanel pages={pages} pageId={page.id} onOpen={switchPage} onNew={() => setNewPage({ title: '' })} canCreate={can('website', 'create')} />}
                    {view === 'themes' && <ThemesPanel active={cfg.active_theme} previewing={preview?.theme.id} onPreview={previewTheme} />}
                    {PANEL_FIELDS[view] && <ConfigFields fields={PANEL_FIELDS[view]} cfg={cfg} setCfg={setCfg} ctx={ctx} />}
                    {view === 'settings' && <SettingsPanel cfg={cfg} setCfg={setCfg} ctx={ctx} />}
                    {view === 'blog' && <div className="st-light"><BlogTab ctx={{ ...ctx, seoBase: cfg?.seo?.base_url }} /></div>}
                    {view === 'reviews' && <div className="st-light"><ReviewsTab canEdit={canEdit} canDelete={can('website', 'delete')} /></div>}
                    {view === 'publish' && (
                      <div className="stack" style={{ gap: 10 }}>
                        <p className="st-note">{pub?.offline ? 'The website is offline.' : dirty || pub?.changes ? 'You have changes that visitors do not see yet.' : 'Visitors see the latest version.'}</p>
                        <button type="button" className="st-btn primary" onClick={() => setPubOpen(true)}>Publish, preview link and history</button>
                        <p className="st-note">Each page also keeps its own saved versions: open the page, then use Outline or Page.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>
            <section className="st-main" aria-label="Page preview">
              {preview ? (
                <>
                  <div className="st-prevbar" role="status">
                    <b>{preview.theme.name}</b>
                    <div className="st-ptabs">{preview.built.pages.map((p, i) => <button key={p.slug} type="button" className={i === preview.page ? 'on' : ''} onClick={() => setPreview({ ...preview, page: i })}>{p.title}</button>)}</div>
                    <span className="grow" />
                    <button type="button" className="btn" onClick={() => setPreview(null)}>Close preview</button>
                    <button type="button" className="btn primary" onClick={() => { if (dirty) { toast('Save or discard your changes first', 'err'); return; } setInstalling(preview); }}>Install this theme</button>
                  </div>
                  <div className="st-frame" style={{ maxWidth: width }}><BuilderCanvas config={preview.built.config} sections={pv.sections} device={device} readonly actions={{}} /></div>
                </>
              ) : (
                <div className="st-frame" style={{ maxWidth: width }}><Puck.Preview /></div>
              )}
            </section>
            {view === 'edit' && !preview && <aside className="st-fields" aria-label="Block settings"><NoSelection /><Puck.Fields /></aside>}
          </div>
          <button type="button" className="st-mtoggle" onClick={() => setMobilePanel(!mobilePanel)}>{mobilePanel ? 'Show the page' : 'Show the menu'}</button>
        </Puck>
      </div>
      {pubOpen && <PublishPanel status={pub} dirty={dirty} onSaveFirst={save} onChanged={loadPub} onDiscarded={reloadAll} onClose={() => setPubOpen(false)} />}
      {installing && <InstallDialog theme={installing.theme} built={installing.built} onClose={() => setInstalling(null)} onDone={async () => { setInstalling(null); setPreview(null); await reloadAll(); setView('pages'); }} />}
      {newPage && (
        <Modal title="New page" size="sm" onClose={() => setNewPage(null)} footer={<><button className="btn" onClick={() => setNewPage(null)}>Cancel</button><button className="btn primary" disabled={!newPage.title.trim()} onClick={async () => {
          if (!confirmLeave()) return;
          try { const p = await api.post('/api/site-admin/pages', { title: newPage.title, sections: [{ id: `s${Date.now().toString(36)}`, type: 'banner', props: { text: newPage.title, href: '', tone: 'primary' } }] }); setNewPage(null); await loadPages(); await openPage(p.id); setView('edit'); toast('Page created. Add blocks from the left.', 'ok'); } catch (e) { toast(e.message, 'err'); }
        }}>Create page</button></>}>
          <Field label="Page title" required hint="The web address is made from the title"><input className="input" autoFocus value={newPage.title} onChange={(e) => setNewPage({ title: e.target.value })} /></Field>
        </Modal>
      )}
      {confirmDel && <ConfirmDialog danger title="Delete page" message={`Delete “${page.title}” permanently?`} confirmLabel="Delete" onCancel={() => setConfirmDel(false)} onConfirm={async () => {
        try { await api.del(`/api/site-admin/pages/${page.id}`); setConfirmDel(false); const l = await loadPages(); await openPage((l.find((p) => p.slug === 'home') || l[0]).id); setView('pages'); toast('Page deleted', 'ok'); } catch (e) { toast(e.message, 'err'); }
      }} />}
    </StudioCtx.Provider>
  );
}
