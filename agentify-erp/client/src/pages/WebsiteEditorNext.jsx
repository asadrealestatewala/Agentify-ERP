import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Puck } from '@puckeditor/core';
import '@puckeditor/core/no-external.css'; // the default stylesheet loads a font from rsms.me, which the CSP blocks
import RichEditor from '../components/RichEditor.jsx';
import { Loading } from '../components/ui.jsx';
import { api } from '../api.js';
import { useLookups, useToast } from '../context.jsx';
import { FONTS, SECTION_TYPES, SiteProvider } from '../site/siteCore.jsx';
import { SectionRenderer } from '../site/components.jsx';
import { Header, Footer } from '../site/SiteApp.jsx';
import { ImagePicker } from './WebsiteEditor.jsx';
import { toPuck, fromPuck } from '../../../shared/puckAdapter.js';

/**
 * Trial of the Puck visual editor (stage 2 of the website builder plan). It edits the same pages as the current editor
 * (site_pages through /api/site-admin, so the same validation, versions, draft and Publish apply) and renders the same
 * blocks as the public website. Off by default: it is only linked when localStorage "agentify-visual-editor" is "1".
 */

const opts = (list) => list.map((o) => (typeof o === 'object' ? { label: String(o.label ?? o.value), value: o.value } : { label: String(o), value: o }));
const summary = (item) => String(Object.values(item || {}).find((v) => typeof v === 'string' && v.trim()) || 'Item').slice(0, 40);

/** One field of SECTION_TYPES, in Puck's terms. */
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
    case 'image': return { type: 'custom', label, render: ({ value, onChange }) => <div className="pk-field"><span className="pk-label">{label}</span><ImagePicker value={value || ''} onChange={onChange} /></div> };
    case 'rich': return { type: 'custom', label, render: ({ value, onChange }) => <div className="pk-field"><span className="pk-label">{label}</span><RichEditor value={value || ''} onChange={onChange} minHeight={180} /></div> };
    case 'color': return { type: 'custom', label, render: ({ value, onChange }) => <label className="pk-field"><span className="pk-label">{label}</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} /></label> };
    case 'lines': return { type: 'custom', label, render: ({ value, onChange }) => <label className="pk-field"><span className="pk-label">{label}</span><textarea className="textarea" rows={5} value={(value || []).join('\n')} onChange={(e) => onChange(e.target.value.split('\n').slice(0, 8))} /></label> };
    case 'list': {
      const arrayFields = Object.fromEntries(f.item.map((x) => [x.key, puckField(x, ctx)]));
      return { type: 'array', label, arrayFields, defaultItemProps: JSON.parse(JSON.stringify(f.blank || {})), getItemSummary: summary };
    }
    default: return { type: 'text', label };
  }
}

/** The Puck configuration: one component per website block, drawn by the same renderer the public site uses. */
function buildConfig(ctx, siteConfig) {
  const components = {};
  for (const [type, T] of Object.entries(SECTION_TYPES)) {
    const fields = Object.fromEntries(T.fields.map((f) => [f.key, puckField(f, ctx)]));
    const conditional = T.fields.filter((f) => f.showIf);
    components[type] = {
      label: `${T.icon} ${T.label}`,
      defaultProps: JSON.parse(JSON.stringify(T.defaults)),
      fields,
      ...(conditional.length ? { resolveFields: (data) => Object.fromEntries(T.fields.filter((f) => !f.showIf || f.showIf(data.props || {})).map((f) => [f.key, fields[f.key]])) } : {}),
      render: ({ id, __style, __extra, __numId, __noProps, puck, editMode, ...props }) => <SectionRenderer sections={[{ id, type, props, style: __style }]} />, // eslint-disable-line no-unused-vars
    };
  }
  return {
    categories: {
      layout: { title: 'Layout', components: ['columns', 'imagetext', 'text', 'spacer', 'gallery', 'embed', 'banner', 'cta'] },
      erp: { title: 'Data from the ERP', components: ['listings', 'projects', 'agents', 'livestats', 'blog', 'calculators', 'contact', 'booking', 'portal'] },
      content: { title: 'Content', components: ['hero', 'stats', 'services', 'testimonials', 'reviews', 'partners', 'faq', 'leadership', 'projectinfo'] },
    },
    components,
    root: { fields: {}, render: ({ children }) => <SiteProvider override={{ config: siteConfig }}><Header />{children}<Footer /></SiteProvider> },
  };
}

const VIEWPORTS = [{ width: 375, height: 'auto', label: 'Mobile', icon: 'Smartphone' }, { width: 768, height: 'auto', label: 'Tablet', icon: 'Tablet' }, { width: 1280, height: 'auto', label: 'Desktop', icon: 'Monitor' }];

export default function WebsiteEditorNext() {
  const toast = useToast();
  const { projects, list } = useLookups();
  const ctx = useMemo(() => ({ projects, ptypes: list('property_type') }), [projects, list]);
  const [pages, setPages] = useState(null);
  const [page, setPage] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(null);

  useEffect(() => { api.get('/api/site-admin/config').then(setCfg); api.get('/api/site-admin/pages').then(setPages); }, []);
  const open = useCallback(async (id) => { const p = await api.get(`/api/site-admin/pages/${id}`); latest.current = null; setPage(p); }, []);
  useEffect(() => { if (pages && !page) { const home = pages.find((p) => p.slug === 'home') || pages[0]; if (home) open(home.id); } }, [pages, page, open]);

  const config = useMemo(() => (cfg ? buildConfig(ctx, cfg) : null), [ctx, cfg]);
  const data = useMemo(() => (page ? toPuck(page.sections) : null), [page]);
  if (!config || !page || !pages) return <Loading />;

  const save = async () => {
    if (!latest.current) { toast('No changes to save', 'ok'); return; }
    setBusy(true);
    try {
      const p = await api.put(`/api/site-admin/pages/${page.id}`, { sections: fromPuck(latest.current) });
      latest.current = null; setPage(p);
      toast('Draft saved. Publish it from the current editor to put it live.', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const switchTo = (id) => { if (latest.current && !window.confirm('This page has unsaved changes. Switch anyway?')) return; open(Number(id)); };

  return (
    <div className="pk-shell">
      <Puck
        key={page.id}
        config={config}
        data={data}
        viewports={VIEWPORTS}
        iframe={{ enabled: true, waitForStyles: true }}
        headerTitle={`${page.title} (trial editor)`}
        onChange={(d) => { latest.current = d; }}
        onPublish={save}
        height="100%"
        overrides={{ headerActions: () => (
          <div className="pk-actions">
            <select className="input" aria-label="Page" value={page.id} onChange={(e) => switchTo(e.target.value)}>{pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
            <a className="btn" href="/website">Back to the current editor</a>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save draft'}</button>
          </div>
        ) }}
      />
    </div>
  );
}
