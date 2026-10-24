import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RichEditor from '../components/RichEditor.jsx';
import BuilderCanvas from '../components/BuilderCanvas.jsx';
import StyleEditor from '../components/StyleEditor.jsx';
import { resolveStyle } from '../../../shared/sectionStyle.js';
import SeoAssistant, { slugify } from '../components/SeoAssistant.jsx';
import Icon from '../components/Icon.jsx';
import { FileUploader } from '../components/Uploaders.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Select, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { FONTS, SECTION_TYPES, imgUrl } from '../site/siteCore.jsx';
import { SitePreview } from '../site/SiteApp.jsx';
import { TEMPLATES, buildSections } from '../site/siteTemplates.js';

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const root = Array.isArray(o) ? [...o] : { ...o }; let cur = root; ks.forEach((k, i) => { if (i === ks.length - 1) cur[k] = v; else { cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] || {}) }; cur = cur[k]; } }); return root; };
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ media picker
function ImagePicker({ value, onChange }) {
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [lib, setLib] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/api/site-admin/media').then(setLib).catch(() => {}), []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const upload = async (files) => {
    setBusy(true);
    try { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); const r = await api.upload('/api/site-admin/media', fd); await load(); if (r.length === 1) { onChange(r[0].path); setOpen(false); } toast('Uploaded', 'ok'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="row">
        <div style={{ width: 64, height: 44, borderRadius: 6, border: '1px dashed var(--border-2)', background: value ? `center/cover url(${imgUrl(value)})` : '#fafbfc', flexShrink: 0 }} />
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>{value ? 'Change' : 'Choose image'}</button>
        {value && <button type="button" className="btn sm ghost danger" onClick={() => onChange('')}>Remove</button>}
        <input className="input" style={{ height: 30, fontSize: 12 }} placeholder="or paste an image URL" value={/^https?:/.test(value || '') ? value : ''} onChange={(e) => onChange(e.target.value)} />
      </div>
      {open && (
        <Modal title="Image library" size="lg" onClose={() => setOpen(false)}>
          <div className="stack">
            <FileUploader multiple accept="image/*" onFiles={upload} busy={busy} label="Drop images here or click to upload" hint="JPG, PNG, WebP — up to 10 MB" />
            <div className="thumbs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {lib.map((m) => (
                <div key={m.id} className="thumb" style={{ cursor: 'pointer', outline: value === m.path ? '3px solid var(--primary)' : 'none' }} onClick={() => { onChange(m.path); setOpen(false); }} title={m.caption}>
                  <img src={imgUrl(m.path)} alt={m.caption || ''} loading="lazy" />
                  {can('website', 'delete') && <button type="button" className="x" aria-label="Delete from library" onClick={async (e) => { e.stopPropagation(); try { await api.del(`/api/site-admin/media/${m.id}`); toast('Image deleted', 'ok'); load(); } catch (er) { toast(er.message, 'err'); } }}>×</button>}
                </div>
              ))}
            </div>
            {!lib.length && <div className="muted">No images yet — upload your first one above.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ generic field editor (schema-driven)
function FieldEditor({ fields, values, onChange, ctx }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => <FieldRow key={f.key} f={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} ctx={ctx} />)}
    </div>
  );
}

function FieldRow({ f, value, onChange, ctx }) {
  const v = value ?? (f.type === 'list' ? [] : f.type === 'bool' ? false : '');
  switch (f.type) {
    case 'lines': return <Field label={f.label}><textarea className="textarea" rows={5} value={Array.isArray(v) ? v.join('\n') : v} onChange={(e) => onChange(e.target.value.split('\n').slice(0, 8))} /></Field>;
    case 'rich': return <Field label={f.label}><RichEditor value={v} onChange={onChange} minHeight={220} /></Field>;
    case 'textarea': return <Field label={f.label}><textarea className="textarea" rows={f.rows || 3} value={v} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'number': return <Field label={f.label}><input className="input" type="number" min={f.min} max={f.max} step={f.step} value={v} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} /></Field>;
    case 'range': return <Field label={`${f.label}: ${v}`}><input type="range" min={f.min} max={f.max} value={v} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} /></Field>;
    case 'bool': return <div className="row between"><span>{f.label}</span><Toggle value={!!v} onChange={onChange} /></div>;
    case 'select': return <Field label={f.label}><Select allowEmpty={false} value={v} onChange={onChange} options={f.options} /></Field>;
    case 'font': return <Field label={f.label}><Select allowEmpty={false} value={v} onChange={onChange} options={FONTS} /></Field>;
    case 'color': return <Field label={f.label}><div className="row"><input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 34, border: '1px solid var(--border-2)', borderRadius: 7, background: 'var(--surface)' }} /><input className="input" value={v} onChange={(e) => onChange(e.target.value)} style={{ width: 110 }} /></div></Field>;
    case 'image': return <Field label={f.label}><ImagePicker value={v} onChange={onChange} /></Field>;
    case 'project': return <Field label={f.label}><Select value={v} onChange={(x) => onChange(x ? Number(x) : '')} options={ctx.projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>;
    case 'ptype': return <Field label={f.label}><Select value={v} onChange={onChange} options={ctx.ptypes} /></Field>;
    case 'rates': return (
      <Field label={f.label}><div className="stack" style={{ gap: 6 }}>
        {Object.entries(v).map(([k, n]) => (
          <div key={k} className="row"><input className="input" style={{ width: 130 }} value={k} onChange={(e) => { const o = {}; Object.entries(v).forEach(([a, b]) => { o[a === k ? e.target.value : a] = b; }); onChange(o); }} />
            <input className="input" type="number" min="0" value={n} onChange={(e) => onChange({ ...v, [k]: Number(e.target.value) })} /><button type="button" className="btn sm ghost danger" onClick={() => { const o = { ...v }; delete o[k]; onChange(o); }}>×</button></div>
        ))}
        <button type="button" className="btn sm" style={{ width: 'fit-content' }} onClick={() => onChange({ ...v, [`Grade ${Object.keys(v).length + 1}`]: 3000 })}>Add grade</button></div></Field>
    );
    case 'list': return (
      <Field label={f.label}>
        <div className="stack" style={{ gap: 8 }}>
          {v.map((item, i) => (
            <div key={i} className="card" style={{ padding: 10, background: 'var(--surface-2)' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 12 }}>#{i + 1}</b>
                <div className="row" style={{ gap: 2 }}>
                  <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => { const a = [...v]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }} aria-label="Move up">↑</button>
                  <button type="button" className="btn sm ghost" disabled={i === v.length - 1} onClick={() => { const a = [...v]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; onChange(a); }} aria-label="Move down">↓</button>
                  <button type="button" className="btn sm ghost danger" onClick={() => onChange(v.filter((_, j) => j !== i))} aria-label="Remove">×</button>
                </div>
              </div>
              <FieldEditor fields={f.item} values={item} ctx={ctx} onChange={(k, val) => onChange(v.map((x, j) => (j === i ? { ...x, [k]: val } : x)))} />
            </div>
          ))}
          <button type="button" className="btn sm" style={{ width: 'fit-content' }} onClick={() => onChange([...v, JSON.parse(JSON.stringify(f.blank || {}))])}><Icon name="plus" size={13} />Add</button>
        </div>
      </Field>
    );
    default: return <Field label={f.label}><input className="input" value={v} onChange={(e) => onChange(e.target.value)} /></Field>;
  }
}

// ------------------------------------------------------------------ global site settings schema
const SOCIALS = ['Facebook', 'Instagram', 'YouTube', 'WhatsApp', 'X (Twitter)', 'LinkedIn', 'TikTok', 'Website', 'Other'].map((p) => ({ value: p, label: p }));
const LINKS = (label) => ({ key: label.key, label: label.label, type: 'list', item: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'href', label: 'Link (e.g. /site/properties)', type: 'text' }], blank: { label: '', href: '' } });
const SITE_GROUPS = [
  { id: 'brand', title: 'Brand & logo', fields: [{ key: 'brand.name', label: 'Website name', type: 'text' }, { key: 'brand.tagline', label: 'Tagline', type: 'text' }, { key: 'brand.logo', label: 'Logo (replaces the name in header & footer)', type: 'image' }] },
  { id: 'theme', title: 'Colours & fonts', fields: [{ key: 'theme.primary', label: 'Primary colour', type: 'color' }, { key: 'theme.accent', label: 'Accent colour', type: 'color' }, { key: 'theme.dark', label: 'Dark colour (footer, banners)', type: 'color' }, { key: 'theme.bg', label: 'Page background', type: 'color' }, { key: 'theme.soft', label: 'Soft section background', type: 'color' }, { key: 'theme.font_heading', label: 'Heading font', type: 'font' }, { key: 'theme.font_body', label: 'Body font', type: 'font' }, { key: 'theme.radius', label: 'Corner roundness (px)', type: 'range', min: 0, max: 24 }] },
  { id: 'header', title: 'Header', fields: [LINKS({ key: 'header.links', label: 'Menu links' }), { key: 'header.cta_label', label: 'Button text', type: 'text' }, { key: 'header.cta_href', label: 'Button link', type: 'text' }, { key: 'header.show_phone', label: 'Show phone number in header', type: 'bool' }, { key: 'header.sticky', label: 'Keep header fixed while scrolling', type: 'bool' }] },
  { id: 'footer', title: 'Footer', fields: [{ key: 'footer.show_cta', label: 'Show the call-to-action strip above the footer', type: 'bool' }, { key: 'footer.cta_title', label: 'Call-to-action headline', type: 'text' }, { key: 'footer.cta_text', label: 'Call-to-action text', type: 'text' }, { key: 'footer.show_map', label: 'Link the address to Google Maps', type: 'bool' }, { key: 'footer.show_hours', label: 'Show opening hours', type: 'bool' }, { key: 'footer.about', label: 'About text', type: 'textarea' }, { key: 'footer.columns', label: 'Link columns', type: 'list', item: [{ key: 'title', label: 'Column title', type: 'text' }, LINKS({ key: 'links', label: 'Links' })], blank: { title: 'New column', links: [] } }, { key: 'footer.copyright', label: 'Copyright line ({year} = current year)', type: 'text' }, { key: 'footer.show_social', label: 'Show social icons', type: 'bool' }] },
  { id: 'social', title: 'Social media icons', fields: [{ key: 'social', label: 'Profiles', type: 'list', item: [{ key: 'platform', label: 'Platform', type: 'select', options: SOCIALS }, { key: 'url', label: 'Profile link (https://…)', type: 'text' }], blank: { platform: 'Facebook', url: '' } }] },
  { id: 'contact', title: 'Contact details', fields: [{ key: 'contact.phone', label: 'Mobile', type: 'text' }, { key: 'contact.landline', label: 'Landline / PTCL', type: 'text' }, { key: 'contact.whatsapp', label: 'WhatsApp number (shows the floating chat button)', type: 'text' }, { key: 'contact.email', label: 'Email', type: 'text' }, { key: 'contact.address', label: 'Address', type: 'text' }, { key: 'contact.hours', label: 'Opening hours', type: 'text' }] },
  { id: 'calc', title: 'Calculators (cost, materials, milestones)', fields: [
    { key: 'calculators.tools.rates.grey.Standard', label: 'Grey structure rate — Standard (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.grey.Premium', label: 'Grey structure rate — Premium (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.grey.Luxury', label: 'Grey structure rate — Luxury (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.semi.Standard', label: 'Semi-finished rate — Standard (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.semi.Premium', label: 'Semi-finished rate — Premium (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.semi.Luxury', label: 'Semi-finished rate — Luxury (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.turnkey.Standard', label: 'Turnkey rate — Standard (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.turnkey.Premium', label: 'Turnkey rate — Premium (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.rates.turnkey.Luxury', label: 'Turnkey rate — Luxury (PKR per covered sq ft)', type: 'number', min: 0 },
    { key: 'calculators.tools.single_storey_factor', label: 'Single-storey cost multiplier (1.095 = 9.5% dearer per sq ft)', type: 'number', min: 0.5, max: 2, step: 0.005 },
    { key: 'calculators.tools.contingency_pct', label: 'Material estimator — contingency (%)', type: 'number', min: 0, max: 100 },
    { key: 'calculators.tools.materials', label: 'Material estimator — materials (quantity per covered sq ft, rate per unit)', type: 'list', item: [{ key: 'label', label: 'Material', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'per_sqft', label: 'Quantity per sq ft', type: 'number', min: 0, step: 0.001 }, { key: 'rate', label: 'Rate per unit (PKR)', type: 'number', min: 0 }], blank: { label: '', unit: '', per_sqft: 0, rate: 0 } },
    { key: 'calculators.tools.plans.grey', label: 'Payment milestones — Grey structure (must add up to 100%)', type: 'list', item: [{ key: 'label', label: 'Milestone', type: 'text' }, { key: 'pct', label: '%', type: 'number', min: 0, max: 100 }], blank: { label: '', pct: 0 } },
    { key: 'calculators.tools.plans.finishing', label: 'Payment milestones — Finishing (must add up to 100%)', type: 'list', item: [{ key: 'label', label: 'Milestone', type: 'text' }, { key: 'pct', label: '%', type: 'number', min: 0, max: 100 }], blank: { label: '', pct: 0 } },
    { key: 'calculators.tools.plans.semi', label: 'Payment milestones — Semi-furnished (must add up to 100%)', type: 'list', item: [{ key: 'label', label: 'Milestone', type: 'text' }, { key: 'pct', label: '%', type: 'number', min: 0, max: 100 }], blank: { label: '', pct: 0 } },
    { key: 'calculators.tools.plans.turnkey', label: 'Payment milestones — Turnkey (must add up to 100%)', type: 'list', item: [{ key: 'label', label: 'Milestone', type: 'text' }, { key: 'pct', label: '%', type: 'number', min: 0, max: 100 }], blank: { label: '', pct: 0 } },
    { key: 'calculators.tools.note', label: 'Disclaimer shown under every estimate', type: 'textarea' },
    { key: 'calculators.show_installment', label: 'Also show the installment-plan generator on the Calculators page', type: 'bool' }] },
  { id: 'listing', title: 'Listings', fields: [{ key: 'listing.show_agent', label: 'Show the listing agent’s name, phone and email on listings', type: 'bool' }, { key: 'listing.per_page', label: 'Listings per page', type: 'number', min: 4, max: 48 }, { key: 'listing.show_sold', label: 'Allow showing sold properties (“include sold” filter)', type: 'bool' }] },
  { id: 'seo', title: 'Search engines (SEO)', fields: [{ key: 'seo.title', label: 'Default page title (30–60 characters)', type: 'text' }, { key: 'seo.description', label: 'Default description (70–160 characters)', type: 'textarea' }, { key: 'seo.keywords', label: 'Keywords (comma separated)', type: 'textarea' }, { key: 'seo.image', label: 'Share image (shown on WhatsApp / Facebook links)', type: 'image' }, { key: 'seo.base_url', label: 'Website address (https://…)', type: 'text' }, { key: 'seo.noindex', label: 'Hide the whole site from search engines', type: 'bool' }] },
  { id: 'bot', title: 'Website assistant (chatbot)', fields: [{ key: 'bot.enabled', label: 'Show the assistant on the website', type: 'bool' }, { key: 'bot.name', label: 'Assistant name', type: 'text' }, { key: 'bot.greeting', label: 'Greeting', type: 'textarea' }, { key: 'bot.quick_replies', label: 'Quick-reply buttons (one per line, up to 8)', type: 'lines' }, { key: 'bot.lead_after', label: 'Offer the lead form after this many questions', type: 'number', min: 1, max: 10 }] },
];

function SiteSettings({ cfg, setCfg, ctx }) {
  const [open, setOpen] = useState('brand');
  return (
    <div className="stack" style={{ gap: 8 }}>
      {SITE_GROUPS.map((g) => (
        <div key={g.id} className="acc">
          <div className="acc-h" onClick={() => setOpen(open === g.id ? '' : g.id)} role="button" aria-expanded={open === g.id}><span>{g.title}</span><Icon name="chevD" size={14} style={{ transform: open === g.id ? 'rotate(180deg)' : 'none' }} /></div>
          {open === g.id && (
            <div className="acc-b" style={{ paddingTop: 10 }}>
              <div className="stack" style={{ gap: 12 }}>
                {g.fields.map((f) => <FieldRow key={f.key} f={f} value={getPath(cfg, f.key)} ctx={ctx} onChange={(v) => setCfg((c) => setPath(c, f.key, v))} />)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ blog
/** Reviews sent from the website's review form: approve before they appear, reject, or delete. */
function ReviewsTab({ canEdit, canDelete }) {
  const toast = useToast();
  const [st, setSt] = useState('pending');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);
  const load = useCallback(() => api.get('/api/site-admin/reviews', { status: st }).then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e.message)), [st]);
  useEffect(() => { setD(null); load(); }, [load]);
  const act = async (r, what) => { try { await api.post(`/api/site-admin/reviews/${r.id}/${what}`, {}); toast(what === 'approve' ? 'Approved: it is now on your website' : what === 'reject' ? 'Rejected' : 'Moved back to waiting', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } };
  const remove = async () => { try { await api.del(`/api/site-admin/reviews/${del.id}`); toast('Deleted', 'ok'); setDel(null); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>Reviews that visitors send from the “Customer reviews” block. Nothing shows on your website until you approve it. Check that the person is a real customer first.</p>
      <div className="row wrap" style={{ gap: 6 }}>{[['pending', 'Waiting'], ['approved', 'On the website'], ['rejected', 'Rejected']].map(([k, l]) => <button key={k} className={`btn sm ${st === k ? 'primary' : ''}`} onClick={() => setSt(k)}>{l}{d ? ` (${d.counts[k]})` : ''}</button>)}</div>
      {err && <div className="alert err">{err}</div>}
      {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title={st === 'pending' ? 'No reviews waiting' : 'Nothing here'} hint="Add the “Customer reviews” block to a page so visitors can send reviews." /> : d.rows.map((r) => (
        <Card key={r.id} title={`${r.name}${r.company ? ` · ${r.company}` : ''}`}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            {!!r.has_photo && <img src={`/api/site-admin/reviews/${r.id}/photo`} alt="" width="56" height="56" style={{ borderRadius: '50%', objectFit: 'cover' }} />}
            <div className="grow">
              <p style={{ marginTop: 0 }}>{r.rating ? <b style={{ color: '#d97706' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} </b> : null}“{r.quote}”</p>
              <small className="muted">{[r.role].filter(Boolean).join(' · ')} {r.email} (not shown on the website){r.decided_by ? ` · decided by ${r.decided_by}` : ''}</small>
            </div>
          </div>
          {canEdit && <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {r.status !== 'approved' && <button className="btn sm primary" onClick={() => act(r, 'approve')}>Approve</button>}
            {r.status !== 'rejected' && <button className="btn sm" onClick={() => act(r, 'reject')}>Reject</button>}
            {r.status !== 'pending' && <button className="btn sm" onClick={() => act(r, 'reset')}>Back to waiting</button>}
            {canDelete && <button className="btn sm danger" onClick={() => setDel(r)}>Delete</button>}
          </div>}
        </Card>
      ))}
      {del && <ConfirmDialog title="Delete this review?" message={`${del.name}'s review and photo will be removed for good.`} confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setDel(null)} />}
    </div>
  );
}

function BlogTab({ ctx }) {
  const toast = useToast();
  const [posts, setPosts] = useState(null);
  const { hidden: hiddenPosts, remove: removePost } = useUndoDelete('site-posts');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const load = useCallback(() => api.get('/api/site-admin/posts').then(setPosts), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    try { if (edit.id) await api.put(`/api/site-admin/posts/${edit.id}`, edit); else await api.post('/api/site-admin/posts', edit); toast('Article saved', 'ok'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  if (!posts) return <Loading />;
  return (
    <div className="stack">
      <div className="row between"><span className="muted">{posts.length} article(s)</span><button className="btn primary sm" onClick={() => setEdit({ title: '', excerpt: '', body: '', cover: '', tags: [], published: true, focus_keyword: '', seo_title: '', seo_desc: '' })}><Icon name="plus" size={13} />New article</button></div>
      {posts.filter((p) => !hiddenPosts.has(p.id)).map((p) => (
        <div key={p.id} className="card row" style={{ padding: 10 }}>
          <div className="grow"><b>{p.title}</b> {p.published ? <span className="pill green">Published</span> : <span className="pill grey">Draft</span>}<div className="muted" style={{ fontSize: 12 }}>/site/blog/{p.slug} · {p.words || 0} words{p.focus_keyword ? ` · keyword: ${p.focus_keyword}` : ''}</div></div>
          <button className="btn sm" onClick={async () => setEdit(await api.get(`/api/site-admin/posts/${p.id}`))}>Edit</button>
          <button className="btn sm ghost danger" onClick={() => setDel(p)}>Delete</button>
        </div>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Edit article' : 'New article'} size="xl" onClose={() => setEdit(null)} footer={<><span className="muted" style={{ marginRight: 'auto' }}>{edit.published ? 'Will be live on the website' : 'Saved as a draft'}</span><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save article</button></>}>
          <div className="blog-edit">
            <div className="stack blog-main">
              <Field label="Title" required><input className="input blog-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus placeholder="A clear, specific headline" /></Field>
              <RichEditor key={edit.id || 'new'} value={edit.body || ''} onChange={(html) => setEdit((p) => ({ ...p, body: html }))} minHeight={420} />
              <Field label="Short summary (shown on cards and as the default description)"><textarea className="textarea" rows={2} value={edit.excerpt || ''} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} /></Field>
            </div>
            <div className="stack blog-side">
              <div className="card" style={{ padding: 12 }}><div className="stack">
                <div className="row between"><span>Published on the website</span><Toggle value={!!edit.published} onChange={(v) => setEdit({ ...edit, published: v })} /></div>
                <Field label="Web address" hint="/site/blog/…  Leave blank to generate from the title"><input className="input" value={edit.slug || ''} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder={slugify(edit.title)} /></Field>
                <Field label="Tags (comma separated)"><input className="input" value={(edit.tags || []).join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
                <Field label="Cover image"><ImagePicker value={edit.cover} onChange={(v) => setEdit({ ...edit, cover: v })} /></Field>
              </div></div>
              <div className="card" style={{ padding: 12 }}><SeoAssistant post={edit} set={(patch) => setEdit((p) => ({ ...p, ...patch }))} base={ctx?.seoBase} /></div>
            </div>
          </div>
        </Modal>
      )}
      {del && <ConfirmDialog danger title="Delete article" message={`Delete “${del.title}”?`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const a = del; setDel(null); removePost(a.id, `“${a.title}” deleted`, () => api.del(`/api/site-admin/posts/${a.id}`), { onDone: load }); }} />}
    </div>
  );
}


const PALETTE = [
  ['Layout', ['columns', 'imagetext', 'text', 'spacer', 'gallery', 'embed', 'banner', 'cta']],
  ['Data from the ERP', ['listings', 'projects', 'agents', 'livestats', 'blog', 'calculators', 'contact', 'booking', 'portal']],
  ['Content', ['hero', 'stats', 'services', 'testimonials', 'reviews', 'partners', 'faq', 'leadership', 'projectinfo']],
];
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Undo / redo for the page's blocks. Typing bursts are merged into one step; up to 100 steps are kept. */
function useSectionHistory(page, setPage) {
  const past = useRef([]), future = useRef([]), last = useRef(null), timer = useRef(null), skip = useRef(false);
  const [, bump] = useState(0);
  const cur = page ? JSON.stringify(page.sections) : null;
  useEffect(() => {
    if (cur === null) return undefined;
    if (last.current === null) { last.current = cur; return undefined; }
    if (cur === last.current) return undefined;
    if (skip.current) { skip.current = false; last.current = cur; return undefined; }
    clearTimeout(timer.current);
    const prev = last.current;
    timer.current = setTimeout(() => { past.current.push(prev); if (past.current.length > 100) past.current.shift(); future.current = []; last.current = cur; bump((n) => n + 1); }, 450);
    return undefined;
  }, [cur]);
  const flush = () => { clearTimeout(timer.current); if (cur !== null && last.current !== null && cur !== last.current) { past.current.push(last.current); last.current = cur; } };
  const apply = (json) => { skip.current = true; last.current = json; setPage((p) => ({ ...p, sections: JSON.parse(json) })); bump((n) => n + 1); };
  const undo = () => { flush(); const prev = past.current.pop(); if (prev === undefined) return; future.current.push(last.current); apply(prev); };
  const redo = () => { flush(); const nxt = future.current.pop(); if (nxt === undefined) return; past.current.push(last.current); apply(nxt); };
  const reset = () => { clearTimeout(timer.current); past.current = []; future.current = []; last.current = null; bump((n) => n + 1); };
  return { undo, redo, reset, canUndo: past.current.length > 0 || (last.current !== null && cur !== last.current), canRedo: future.current.length > 0 };
}

// ------------------------------------------------------------------ main editor
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

/** Publishing: what visitors see is the last published release; saves are a draft until Publish. */
function PublishPanel({ status, dirty, onSaveFirst, onChanged, onDiscarded, onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState(null);
  const [ask, setAsk] = useState(null); // 'offline' | 'discard' | release row to restore
  useEffect(() => { api.get('/api/site-admin/releases').then(setRows).catch(() => setRows([])); }, [status]);
  const act = async (key, fn, msg) => {
    setBusy(key);
    try { await fn(); if (msg) toast(msg, 'ok'); await onChanged(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); setAsk(null); }
  };
  const publish = () => act('publish', async () => { if (dirty) await onSaveFirst(); await api.post('/api/site-admin/publish', { label }); setLabel(''); }, 'Published. Visitors now see these changes.');
  const makeLink = () => act('link', async () => { const r = await api.post('/api/site-admin/preview-link'); setLink({ url: `${window.location.origin}${r.path}`, expires_at: r.expires_at }); });
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); toast('Preview link copied', 'ok'); } catch { toast('Copy the link from the box', 'err'); } };
  const pending = dirty || status?.changes;
  return (
    <Modal title="Publish the website" size="lg" onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {status?.offline ? <span className="pill red">Offline</span> : <span className="pill green">Live</span>}
          {pending ? <span className="pill amber">Unpublished changes</span> : <span className="pill grey">Visitors see the latest version</span>}
          {status?.live && <span className="muted">Live since {when(status.live.published_at)}{status.live.by_name ? ` by ${status.live.by_name}` : ''}</span>}
        </div>
        <p className="muted" style={{ margin: 0 }}>Save keeps a draft that only your team sees. Publish puts the whole website (every page, the header, footer and colours) live at once. Every publish is kept below, so you can go back to any earlier version.</p>
        {can('website', 'edit') && (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1 }} maxLength={120} placeholder="What changed? (optional, e.g. New Eid offer banner)" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Note for this version" />
            <button className="btn primary" disabled={!!busy || (!pending && !status?.offline)} onClick={publish}>{busy === 'publish' ? 'Publishing…' : dirty ? 'Save and publish' : 'Publish'}</button>
          </div>
        )}
        <div className="card" style={{ padding: 12 }}>
          <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div><b>Share a preview</b><div className="muted" style={{ fontSize: 12 }}>Anyone with the link sees the saved draft for 7 days. Search engines are told not to index it.</div></div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" disabled={!!busy} onClick={makeLink}>{busy === 'link' ? 'Creating…' : 'Create preview link'}</button>
              {can('website', 'edit') && <button className="btn sm" disabled={!!busy} onClick={() => act('revoke', () => api.del('/api/site-admin/preview-links'), 'All preview links stopped working')}>Stop all links</button>}
            </div>
          </div>
          {link && <div className="row" style={{ gap: 6, marginTop: 8 }}><input className="input" style={{ flex: 1 }} readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Preview link" /><button className="btn sm" onClick={copy}>Copy</button><a className="btn sm" href={link.url} target="_blank" rel="noreferrer">Open ↗</a></div>}
          {dirty && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Save first: the preview shows saved changes only.</div>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {status?.offline
            ? can('website', 'edit') && <button className="btn sm" disabled={!!busy} onClick={() => act('online', () => api.post('/api/site-admin/online'), 'The website is back online')}>Put the website back online</button>
            : can('website', 'delete') && <button className="btn sm" disabled={!!busy} onClick={() => setAsk('offline')}>Take the website offline</button>}
          {can('website', 'delete') && status?.changes && <button className="btn sm" disabled={!!busy} onClick={() => setAsk('discard')}>Discard unpublished changes</button>}
        </div>
        <h4 style={{ margin: '6px 0 0' }}>Published versions</h4>
        {!rows ? <Loading /> : !rows.length ? <div className="muted">Nothing published yet.</div> : (
          <div className="stack" style={{ gap: 6 }}>
            {rows.map((r) => (
              <div key={r.id} className="row between" style={{ gap: 8, borderBottom: '1px solid var(--line, #e5e7eb)', paddingBottom: 6 }}>
                <div className="grow"><b>{r.label || 'Published'}</b> {r.live && <span className="pill green">Live</span>}<div className="muted" style={{ fontSize: 12 }}>{when(r.published_at)}{r.by_name ? ` · ${r.by_name}` : ''} · {r.pages} page(s)</div></div>
                {!r.live && can('website', 'edit') && <button className="btn sm" disabled={!!busy} onClick={() => setAsk(r)}>Make live again</button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {ask === 'offline' && <ConfirmDialog danger title="Take the website offline?" message="Visitors see a short 'not available' page and search engines stop indexing it. Your pages and drafts are kept, and you can put it back online at any time." confirmLabel="Take offline" onCancel={() => setAsk(null)} onConfirm={() => act('offline', () => api.post('/api/site-admin/unpublish'), 'The website is offline')} />}
      {ask === 'discard' && <ConfirmDialog danger title="Discard unpublished changes?" message="The editor goes back to the live website. Each changed page keeps its current layout in its own version history first, and pages added since the last publish are hidden, not deleted." confirmLabel="Discard changes" onCancel={() => setAsk(null)} onConfirm={() => act('discard', async () => { await api.post('/api/site-admin/draft/discard'); await onDiscarded(); }, 'Unpublished changes discarded')} />}
      {ask && typeof ask === 'object' && <ConfirmDialog title="Make this version live again?" message={`Visitors will see the website as it was on ${when(ask.published_at)}. It is added as a new version, so you can switch back. Your draft in the editor is not changed.`} confirmLabel="Make live" onCancel={() => setAsk(null)} onConfirm={() => act('restore', () => api.post(`/api/site-admin/releases/${ask.id}/restore`), 'That version is live again')} />}
    </Modal>
  );
}

export default function WebsiteEditor() {
  const toast = useToast();
  const { can } = useAuth();
  const { projects, list } = useLookups();
  const ctx = useMemo(() => ({ projects, ptypes: list('property_type') }), [projects, list]);
  const [pages, setPages] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [page, setPage] = useState(null);
  const [savedPage, setSavedPage] = useState('');
  const [cfg, setCfg] = useState(null);
  const [savedCfg, setSavedCfg] = useState('');
  const [tab, setTab] = useState('sections');
  const [device, setDevice] = useState('desktop');
  const [selected, setSelected] = useState(null);
  const [secTab, setSecTab] = useState('content');
  const [versions, setVersions] = useState(null);
  const [delId, setDelId] = useState(null);
  const [rowOver, setRowOver] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newPage, setNewPage] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [ai, setAi] = useState(null);
  // the editor opens full screen (like a page builder): panel on the left, the big live page on the right
  const [full, setFullState] = useState(() => { try { return localStorage.getItem('wed-full') !== '0'; } catch { return true; } });
  const setFull = (v) => { setFullState(v); try { localStorage.setItem('wed-full', v ? '1' : '0'); } catch { /* private mode */ } };
  const [panelOpen, setPanelOpen] = useState(true);
  const [prev, setPrev] = useState(null); // a template shown on the canvas before it is applied
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pub, setPub] = useState(null); // publish status: live release, offline, unpublished changes
  const [pubOpen, setPubOpen] = useState(false);
  const canEdit = can('website', 'edit');
  const loadPub = useCallback(() => api.get('/api/site-admin/publish').then(setPub).catch(() => {}), []);
  useEffect(() => { loadPub(); }, [loadPub]);

  const loadPages = useCallback(async (select) => {
    const l = await api.get('/api/site-admin/pages'); setPages(l);
    const id = select || pageId || l.find((p) => p.slug === 'home')?.id || l[0]?.id; setPageId(id);
  }, [pageId]);
  useEffect(() => { loadPages(); api.get('/api/site-admin/config').then((c) => { setCfg(c); setSavedCfg(JSON.stringify(c)); }); /* eslint-disable-next-line */ }, []);
  const pageRef = useRef(page); pageRef.current = page;
  const hist = useSectionHistory(page, setPage);
  useEffect(() => { if (pageId) api.get(`/api/site-admin/pages/${pageId}`).then((p) => { hist.reset(); setPage(p); setSavedPage(JSON.stringify(p)); setSelected(null); }); }, [pageId]); // eslint-disable-line

  const dirtyPage = page && JSON.stringify(page) !== savedPage, dirtyCfg = cfg && JSON.stringify(cfg) !== savedCfg;
  const dirty = dirtyPage || dirtyCfg;
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const save = async () => {
    setBusy(true);
    try {
      if (dirtyCfg) { await api.put('/api/site-admin/config', cfg); setSavedCfg(JSON.stringify(cfg)); }
      if (dirtyPage) { const p = await api.put(`/api/site-admin/pages/${page.id}`, { title: page.title, slug: page.slug, sections: page.sections, published: !!page.published, seo_title: page.seo_title || '', seo_desc: page.seo_desc || '', show_in_menu: !!page.show_in_menu }); setPage(p); setSavedPage(JSON.stringify(p)); loadPages(); }
      toast('Draft saved. Press Publish to put it live.', 'ok');
      loadPub();
    } catch (e) { toast(e.message, 'err'); throw e; } finally { setBusy(false); }
  };
  const saveDraft = () => save().catch(() => {});
  const reloadDraft = async () => {
    const c = await api.get('/api/site-admin/config'); setCfg(c); setSavedCfg(JSON.stringify(c));
    await loadPages();
    if (pageId) { const p = await api.get(`/api/site-admin/pages/${pageId}`).catch(() => null); if (p) { hist.reset(); setPage(p); setSavedPage(JSON.stringify(p)); setSelected(null); } }
  };
  const switchPage = (id) => { if (dirtyPage && !window.confirm('You have unsaved changes on this page. Switch anyway?')) return; setPageId(Number(id)); };

  const sections = page?.sections || [];
  const updSection = (id, props) => setPage((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, props } : s)) }));
  const move = (i, d) => setPage((p) => { const a = [...p.sections]; const j = i + d; if (j < 0 || j >= a.length) return p; [a[i], a[j]] = [a[j], a[i]]; return { ...p, sections: a }; });
  const addSection = (type) => { const id = uid(); setPage((p) => ({ ...p, sections: [...p.sections, { id, type, props: JSON.parse(JSON.stringify(SECTION_TYPES[type].defaults)) }] })); setSelected(id); setAdding(false); };
  const dup = (s) => setPage((p) => { const i = p.sections.findIndex((x) => x.id === s.id); const a = [...p.sections]; a.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(s)), id: uid() }); return { ...p, sections: a }; });
  const remove = (id) => setPage((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) }));

  const setStyleKey = (id, d, k, v) => setPage((p) => ({ ...p, sections: p.sections.map((sec) => {
    if (sec.id !== id) return sec;
    const st = { ...(sec.style || {}) }; st[d] = { ...(st[d] || {}) };
    if (v === undefined) delete st[d][k]; else st[d][k] = v;
    if (!Object.keys(st[d]).length) delete st[d];
    const n = { ...sec }; if (Object.keys(st).length) n.style = st; else delete n.style; return n;
  }) }));
  const updStyle = (id, style) => setPage((p) => ({ ...p, sections: p.sections.map((sec) => { if (sec.id !== id) return sec; const n = { ...sec }; if (style) n.style = style; else delete n.style; return n; }) }));
  const toggleHide = (sec, d) => { const cur = resolveStyle(sec.style, d, 'hide').value === true; setStyleKey(sec.id, d, 'hide', cur ? (d === 'desktop' ? undefined : false) : true); };
  const moveTo = (id, beforeId) => setPage((p) => { const a = [...p.sections]; const i = a.findIndex((x) => x.id === id); if (i < 0 || id === beforeId) return p; const [it] = a.splice(i, 1); const j = beforeId == null ? a.length : a.findIndex((x) => x.id === beforeId); a.splice(j < 0 ? a.length : j, 0, it); return { ...p, sections: a }; });
  const addAt = (type, beforeId) => {
    if (!SECTION_TYPES[type]) return; const id = uid();
    setPage((p) => { const a = [...p.sections]; const j = beforeId == null ? a.length : a.findIndex((x) => x.id === beforeId); a.splice(j < 0 ? a.length : j, 0, { id, type, props: clone(SECTION_TYPES[type].defaults) }); return { ...p, sections: a }; });
    setSelected(id); setTab('sections'); setSecTab('content');
  };
  const bump = (id, d) => setPage((p) => { const a = [...p.sections]; const i = a.findIndex((x) => x.id === id); const j = i + d; if (i < 0 || j < 0 || j >= a.length) return p; [a[i], a[j]] = [a[j], a[i]]; return { ...p, sections: a }; });
  const dupId = (id) => setPage((p) => { const i = p.sections.findIndex((x) => x.id === id); if (i < 0) return p; const a = [...p.sections]; const c = { ...clone(p.sections[i]), id: uid() }; a.splice(i + 1, 0, c); return { ...p, sections: a }; });
  const askDelete = (id) => setDelId(id);
  const doDelete = () => { const id = delId; setDelId(null); remove(id); setSelected((x) => (x === id ? null : x)); toast.undoable('Block deleted', { seconds: 8, commit: () => {}, onUndo: () => hist.undo() }); };
  // text typed straight onto the canvas: only a known text field of a known block may change, and only to a short string
  const setAt = (obj, path, value) => { const [k, ...rest] = path.split('.'); const key = /^\d+$/.test(k) ? Number(k) : k; const copy = Array.isArray(obj) ? [...obj] : { ...obj }; copy[key] = rest.length ? setAt(copy[key] ?? {}, rest.join('.'), value) : value; return copy; };
  const canvasActions = {
    edit: ({ id, path, value }) => {
      if (typeof value !== 'string' || value.length > 20000 || !/^[A-Za-z_]+(\.\d{1,2}\.[A-Za-z_]+)?$/.test(String(path))) return;
      setPage((p) => ({ ...p, sections: p.sections.map((x) => (x.id === id ? { ...x, props: setAt(x.props || {}, path, value) } : x)) }));
    },
    select: (m) => { setSelected(m.id); if (m.id) { setTab('sections'); setTimeout(() => document.getElementById(`row-${m.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60); } },
    move: (m) => moveTo(m.id, m.beforeId), add: (m) => addAt(m.type, m.beforeId), up: (m) => bump(m.id, -1), down: (m) => bump(m.id, 1), dup: (m) => dupId(m.id), del: (m) => askDelete(m.id),
    hide: (m) => { const sec = pageRef.current.sections.find((x) => x.id === m.id); if (sec) toggleHide(sec, device); },
  };
  const openVersions = async () => setVersions({ rows: await api.get(`/api/site-admin/pages/${page.id}/versions`), label: '' });
  const restoreVersion = async (v) => { const d = await api.get(`/api/site-admin/pages/${page.id}/versions/${v.id}`); setPage((p) => ({ ...p, sections: d.sections })); setVersions(null); toast('Version loaded into the editor — Save, then Publish to put it live (or Undo to go back)', 'ok'); };
  useEffect(() => {
    const h = (e) => {
      const el = document.activeElement; if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); hist.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); hist.redo(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  const dropOnRow = (e, beforeId) => {
    e.preventDefault(); setRowOver(null);
    const mv = e.dataTransfer.getData('application/x-sb-move'), ty = e.dataTransfer.getData('application/x-sb-type');
    if (mv) moveTo(mv, beforeId); else if (ty) addAt(ty, beforeId);
  };

  if (!pages || !cfg || !page) return <Loading />;
  const applyPrev = () => {
    const t = TEMPLATES.find((x) => x.id === prev.id);
    setPage((p) => ({ ...p, sections: prev.sections }));
    if (t?.theme && prev.theme) setCfg((c) => ({ ...c, theme: { ...(c.theme || {}), ...t.theme } }));
    setSelected(null); setPrev(null);
    toast(`${prev.label} applied to this page. Review it, Save, then Publish to put it live. Undo brings your old page back.`, 'ok');
  };
  const actionBtns = (<>
        <button className="btn" disabled={!hist.canUndo} onClick={hist.undo} title="Undo (Ctrl+Z)">↶ Undo</button><button className="btn" disabled={!hist.canRedo} onClick={hist.redo} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <button className="btn" onClick={openVersions}>🕘 History</button>
        <a className="btn" href="/site" target="_blank" rel="noreferrer">View live site ↗</a>
        <button className="btn" disabled={!dirty || busy || !canEdit} onClick={saveDraft}>{busy ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}</button>
        <button className={`btn ${dirty || pub?.changes || pub?.offline ? 'primary' : ''}`} onClick={() => setPubOpen(true)} title="Publish, preview link, earlier versions">
          {pub?.offline ? 'Offline · Publish' : dirty || pub?.changes ? 'Publish…' : 'Published ✓'}
        </button>
      </>);
  return (
    <div className={full ? 'wed-fs' : ''}>
      {full ? (
        <div className="wed-top">
          <button className="btn" onClick={() => setFull(false)} title="Back to the normal page">← Exit full screen</button>
          <button className="btn" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '◀ Hide panel' : '▶ Show panel'}</button>
          <b className="wed-title">Website editor</b><span className="grow" />
          {actionBtns}
        </div>
      ) : (
        <PageHead title="Website editor" sub="Edit the public website — header, footer, hero, listings, colours, fonts, images, blog and more. Save keeps a draft; Publish puts it live.">
          <button className="btn" onClick={() => setFull(true)}>⤢ Full screen</button>
          {actionBtns}
        </PageHead>
      )}
      <div className={`wed ${panelOpen ? '' : 'nopanel'}`}>
        <div className="wed-panel">
          <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
            <div className="grow" style={{ flex: "1 1 100%" }}><Select allowEmpty={false} value={pageId} onChange={switchPage} options={pages.map((p) => ({ value: p.id, label: `${p.title}${p.published ? '' : ' (hidden)'}  —  /site${p.slug === 'home' ? '' : '/p/' + p.slug}` }))} /></div>
            {can('website', 'create') && <button className="btn sm" onClick={() => setNewPage({ title: '' })}><Icon name="plus" size={13} />Page</button>}
            {canEdit && <button className="btn sm" onClick={() => setTpl({ id: null, theme: true })}><Icon name="layers" size={13} />Templates</button>}
            {canEdit && <button className="btn sm" onClick={() => setAi({ form: { company: cfg?.brand?.name || '', type: 'agency', location: '', what: '', audience: '', style: 'modern', tone: 'professional', language: 'English', notes: '' }, busy: false, draft: null, err: '', seo: true, theme: true })}><Icon name="bolt" size={13} />Create with AI</button>}
          </div>
          <div className="tabs" role="tablist">{[['sections', 'Sections'], ['blocks', 'Add blocks'], ['page', 'Page'], ['site', 'Site design'], ['reviews', 'Reviews'], ['blog', 'Blog']].map(([k, l]) => <button key={k} role="tab" className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
          <div style={{ paddingTop: 12 }}>
            {tab === 'blocks' && (
              <div className="stack" style={{ gap: 14 }}>
                <p className="muted" style={{ margin: 0 }}>Drag a block onto the canvas (or between blocks in the list), or click it to add it {selected ? 'below the selected block' : 'at the end'}.</p>
                {PALETTE.map(([group, keys]) => (
                  <div key={group}><h5 className="pal-h">{group}</h5>
                    <div className="pal-grid">{keys.filter((k) => SECTION_TYPES[k]).map((k) => { const t = SECTION_TYPES[k]; return (
                      <button type="button" key={k} className="pal-tile" draggable title={t.desc} onDragStart={(e) => { e.dataTransfer.setData('application/x-sb-type', k); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => { const i = sections.findIndex((x) => x.id === selected); addAt(k, i >= 0 ? sections[i + 1]?.id ?? null : null); }}>
                        <span>{t.icon}</span><b>{t.label}</b></button>); })}</div></div>
                ))}
              </div>
            )}
            {tab === 'sections' && (
              <div className="stack" style={{ gap: 8 }}>
                {sections.map((s, i) => {
                  const T = SECTION_TYPES[s.type] || { label: s.type, icon: '▫️', fields: [] };
                  const open = selected === s.id;
                  const hid = (d) => resolveStyle(s.style, d, 'hide').value === true;
                  const hasStyle = !!s.style && Object.keys(s.style).some((k) => k !== 'anchor' ? Object.keys(s.style[k] || {}).length : true);
                  return (
                    <div key={s.id} id={`row-${s.id}`} className={`acc ${rowOver === s.id ? 'row-over' : ''}`} style={open ? { borderColor: 'var(--primary)' } : undefined}
                      onDragOver={(e) => { if ([...e.dataTransfer.types].some((t) => t.startsWith('application/x-sb'))) { e.preventDefault(); setRowOver(s.id); } }} onDragLeave={() => setRowOver((r) => (r === s.id ? null : r))} onDrop={(e) => dropOnRow(e, s.id)}>
                      <div className="acc-h" onClick={() => setSelected(open ? null : s.id)}>
                        <span className="row" style={{ gap: 6, minWidth: 0 }}>
                          <span className="grip" draggable title="Drag to reorder" onClick={(e) => e.stopPropagation()} onDragStart={(e) => { e.dataTransfer.setData('application/x-sb-move', s.id); e.dataTransfer.effectAllowed = 'move'; }}>⠿</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{T.icon} {T.label}{s.props?.title || s.props?.headline ? <span className="muted" style={{ fontWeight: 400 }}> — {String(s.props.title || s.props.headline).slice(0, 22)}</span> : ''}{hasStyle ? <span className="pill blue" style={{ marginLeft: 6 }} title="Has custom layout settings">layout</span> : null}</span>
                        </span>
                        <span className="row" style={{ gap: 0, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          {[['desktop', '🖥'], ['tablet', '📱'], ['mobile', '📲']].map(([d, ic]) => <button key={d} className={`btn sm ghost dv ${hid(d) ? 'off' : ''}`} title={hid(d) ? `Hidden on ${d} — click to show` : `Shown on ${d} — click to hide`} aria-label={`Toggle ${d} visibility`} onClick={() => toggleHide(s, d)}>{ic}</button>)}
                          <button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn sm ghost" disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                          <button className="btn sm ghost" onClick={() => dup(s)} aria-label="Duplicate">⧉</button><button className="btn sm ghost danger" onClick={() => askDelete(s.id)} aria-label="Delete section">🗑</button>
                        </span>
                      </div>
                      {open && (
                        <div className="acb2">
                          <div className="tabs sm" role="tablist">{[['content', 'Content'], ['layout', 'Layout & responsive']].map(([k, l]) => <button key={k} role="tab" className={`tab ${secTab === k ? 'active' : ''}`} onClick={() => setSecTab(k)}>{l}</button>)}</div>
                          <div style={{ paddingTop: 10 }}>
                            {secTab === 'layout'
                              ? <StyleEditor style={s.style} device={device} setDevice={setDevice} ImagePicker={ImagePicker} onChange={(st) => updStyle(s.id, st)} />
                              : <FieldEditor fields={T.fields} values={s.props || {}} ctx={ctx} onChange={(k, v) => updSection(s.id, { ...s.props, [k]: v })} />}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className={`row-end ${rowOver === '__end' ? 'row-over' : ''}`} onDragOver={(e) => { if ([...e.dataTransfer.types].some((t) => t.startsWith('application/x-sb'))) { e.preventDefault(); setRowOver('__end'); } }} onDragLeave={() => setRowOver(null)} onDrop={(e) => dropOnRow(e, null)}>
                  {!sections.length && <div className="muted">This page has no blocks yet — drag one here.</div>}
                  <button className="btn primary" onClick={() => setTab('blocks')}><Icon name="plus" size={14} />Add block</button>
                </div>
              </div>
            )}
            {tab === 'page' && (
              <div className="stack">
                <Field label="Page title"><input className="input" value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })} /></Field>
                {page.slug !== 'home' && <Field label="Web address" hint={`/site/p/${page.slug}`}><input className="input" value={page.slug} onChange={(e) => setPage({ ...page, slug: e.target.value })} /></Field>}
                <div className="row between"><span>Published</span><Toggle value={!!page.published} onChange={(v) => setPage({ ...page, published: v })} /></div>
                {page.slug !== 'home' && <div className="row between"><span>Show in the header menu</span><Toggle value={!!page.show_in_menu} onChange={(v) => setPage({ ...page, show_in_menu: v })} /></div>}
                <Field label="Search-engine title"><input className="input" value={page.seo_title || ''} onChange={(e) => setPage({ ...page, seo_title: e.target.value })} /></Field>
                <Field label="Search-engine description"><textarea className="textarea" rows={3} value={page.seo_desc || ''} onChange={(e) => setPage({ ...page, seo_desc: e.target.value })} /></Field>
                <div className="row wrap">
                  {can('website', 'create') && <button className="btn sm" onClick={async () => { const r = await api.post(`/api/site-admin/pages/${page.id}/duplicate`); toast('Page duplicated (hidden until published)', 'ok'); await loadPages(r.id); setPageId(r.id); }}>Duplicate page</button>}
                  {['home', 'about', 'contact'].includes(page.slug) && can('website', 'delete') && <button className="btn sm" onClick={async () => { if (!window.confirm('Restore this page to the starter design? Your edits to its sections will be lost.')) return; await api.post(`/api/site-admin/pages/${page.id}/reset`); const p = await api.get(`/api/site-admin/pages/${page.id}`); setPage(p); setSavedPage(JSON.stringify(p)); toast('Restored', 'ok'); }}>Restore starter design</button>}
                  {page.slug !== 'home' && can('website', 'delete') && <button className="btn sm danger" onClick={() => setConfirmDel(true)}>Delete page</button>}
                </div>
              </div>
            )}
            {tab === 'site' && <SiteSettings cfg={cfg} setCfg={setCfg} ctx={ctx} />}
            {tab === 'reviews' && <ReviewsTab canEdit={canEdit} canDelete={can('website', 'delete')} />}
            {tab === 'blog' && <BlogTab ctx={ctx} />}
          </div>
        </div>
        <div className="wed-preview">
          <div className="row between wrap" style={{ marginBottom: 8, gap: 8 }}>
            <b>Visual canvas</b>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Click any text to type on the page · click a block for its settings · drag ⠿ to move</span>
              <div className="seg2s">{[['desktop', '🖥 Desktop'], ['tablet', '📱 Tablet'], ['mobile', '📲 Mobile']].map(([d, i]) => <button key={d} className={device === d ? 'on' : ''} onClick={() => setDevice(d)} aria-label={`${d} preview`}>{i}</button>)}</div>
            </div>
          </div>
          {prev && (
            <div className="wed-prevbar" role="status">
              <b>Preview: {prev.label}</b><span className="muted">Not applied yet. This is how your page would look.</span><span className="grow" />
              <button className="btn" onClick={() => { const id = prev.id, theme = prev.theme; setPrev(null); setTpl({ id, theme }); }}>← All templates</button>
              <button className="btn" onClick={() => setPrev(null)}>Close preview</button>
              <button className="btn primary" onClick={applyPrev}>Use this template</button>
            </div>
          )}
          <div className="wed-frame bc"><BuilderCanvas config={prev ? prev.config : cfg} sections={prev ? prev.sections : sections} selected={prev ? null : selected} device={device} readonly={!!prev} actions={prev ? {} : canvasActions} /></div>
        </div>
      </div>
      {pubOpen && <PublishPanel status={pub} dirty={dirty} onSaveFirst={save} onChanged={loadPub} onDiscarded={reloadDraft} onClose={() => setPubOpen(false)} />}
      {delId && <ConfirmDialog danger title="Delete this block?" message="The block is removed from the page. You can undo for a few seconds, or with Ctrl+Z." confirmLabel="Delete" onCancel={() => setDelId(null)} onConfirm={doDelete} />}
      {versions && (
        <Modal title="Version history" size="lg" onClose={() => setVersions(null)}>
          <div className="stack">
            <div className="row" style={{ gap: 8 }}><input className="input" style={{ flex: 1 }} placeholder="Name this version (e.g. Before Eid sale banner)" value={versions.label} onChange={(e) => setVersions({ ...versions, label: e.target.value })} /><button className="btn primary" onClick={async () => { await api.post(`/api/site-admin/pages/${page.id}/versions`, { label: versions.label }); setVersions({ rows: await api.get(`/api/site-admin/pages/${page.id}/versions`), label: '' }); toast('Version saved', 'ok'); }}>Save current version</button></div>
            <p className="muted" style={{ margin: 0 }}>Every save keeps a snapshot (newest 40). Loading one puts it in the editor — nothing goes live until you Save and Publish.</p>
            {!versions.rows.length ? <div className="muted">No versions yet — they appear after the first save.</div> : versions.rows.map((v) => (
              <div key={v.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div><b>{v.label || 'Saved'}</b><div className="muted" style={{ fontSize: 12 }}>{v.created_at?.replace('T', ' ').slice(0, 16)} · {v.by_name || 'system'} · {v.sections} blocks</div></div>
                <button className="btn sm" onClick={() => restoreVersion(v)}>Load this version</button>
              </div>))}
          </div>
        </Modal>
      )}
      {adding && (
        <Modal title="Add a section" size="lg" onClose={() => setAdding(false)}>
          <div className="grid g3">{Object.entries(SECTION_TYPES).map(([k, t]) => <button key={k} className="card" style={{ padding: 14, textAlign: 'left', cursor: 'pointer' }} onClick={() => addSection(k)}><div style={{ fontSize: 24 }}>{t.icon}</div><b>{t.label}</b><div className="muted" style={{ fontSize: 12 }}>{t.desc}</div></button>)}</div>
        </Modal>
      )}
      {ai && (() => {
        const set = (k) => (e) => setAi((a) => ({ ...a, form: { ...a.form, [k]: e.target.value } }));
        const f = ai.form;
        const run = async () => {
          setAi((a) => ({ ...a, busy: true, err: '', draft: null }));
          try { const d = await api.post('/api/site-admin/ai/generate', f); setAi((a) => ({ ...a, busy: false, draft: d })); }
          catch (e) { setAi((a) => ({ ...a, busy: false, err: e.message, needsAi: e.status === 409 })); }
        };
        const use = () => {
          const d = ai.draft;
          setPage((p) => ({ ...p, sections: d.sections.map((x) => ({ ...x, props: { ...JSON.parse(JSON.stringify(SECTION_TYPES[x.type]?.defaults || {})), ...x.props } })) }));
          setCfg((c) => ({ ...c, ...(ai.theme && Object.keys(d.theme).length ? { theme: { ...(c.theme || {}), ...d.theme } } : {}), ...(ai.seo && (d.seo.title || d.seo.description) ? { seo: { ...(c.seo || {}), ...(d.seo.title ? { title: d.seo.title } : {}), ...(d.seo.description ? { description: d.seo.description } : {}) } } : {}) }));
          setSelected(null); setAi(null);
          toast('The AI draft is on this page. Read it, add your own photos and facts, then Save and Publish to put it live. Undo brings your old page back.', 'ok');
        };
        const d = ai.draft;
        return (
          <Modal title="Create your website with AI" size="lg" onClose={() => setAi(null)} footer={d
            ? <><button className="btn" onClick={() => setAi({ ...ai, draft: null })}>Back</button><button className="btn" onClick={run} disabled={ai.busy}>{ai.busy ? 'Writing…' : 'Write another version'}</button><button className="btn primary" onClick={use}>Use this draft</button></>
            : <><button className="btn" onClick={() => setAi(null)}>Cancel</button><button className="btn primary" onClick={run} disabled={ai.busy}>{ai.busy ? 'Writing your page…' : 'Write my page'}</button></>}>
            {!d ? (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Describe your business and the AI writes a draft home page: the blocks, the wording, colours and fonts. It uses your own AI connection and never invents figures, clients, reviews or contact details. Nothing changes until you press Use this draft and then Save.</p>
                {ai.err && <div className="alert err" role="alert">{ai.err}{ai.needsAi && <> <a href="/integrations">Open Integrations</a></>}</div>}
                <div className="grid g2" style={{ gap: 10 }}>
                  <Field label="Company name" required><input className="input" value={f.company} onChange={set('company')} maxLength={80} /></Field>
                  <Field label="Type of business"><select className="input" value={f.type} onChange={set('type')}><option value="agency">Real estate agency or brokerage</option><option value="developer">Property developer</option><option value="construction">Construction or renovation</option><option value="dual">Sells property and builds</option><option value="other">Something else</option></select></Field>
                  <Field label="City or area you work in"><input className="input" value={f.location} onChange={set('location')} maxLength={100} placeholder="e.g. Austin, Texas" /></Field>
                  <Field label="Website language"><input className="input" value={f.language} onChange={set('language')} maxLength={40} placeholder="English" /></Field>
                </div>
                <Field label="What does your company do?" required hint="A few sentences: what you sell or build, what makes your service different."><textarea className="input" rows={4} value={f.what} onChange={set('what')} maxLength={800} /></Field>
                <Field label="Who are your customers?"><input className="input" value={f.audience} onChange={set('audience')} maxLength={300} placeholder="e.g. first-time buyers, overseas investors" /></Field>
                <div className="grid g2" style={{ gap: 10 }}>
                  <Field label="Look and feel"><select className="input" value={f.style} onChange={set('style')}><option value="modern">Modern and clean</option><option value="classic">Classic and trustworthy</option><option value="bold">Bold and energetic</option><option value="luxury">Elegant and premium</option><option value="friendly">Warm and friendly</option></select></Field>
                  <Field label="Tone of voice"><select className="input" value={f.tone} onChange={set('tone')}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="confident">Confident and direct</option><option value="formal">Formal</option></select></Field>
                </div>
                <Field label="Anything else the AI should know?"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={600} /></Field>
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Here is the draft. Nothing is on your website yet. Texts are suggestions to check and edit.</p>
                <div className="card" style={{ padding: 14 }}>
                  <b>{d.sections[0]?.props?.headline}</b>
                  <div className="muted">{d.sections[0]?.props?.subheadline}</div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>{d.sections.map((x) => <span key={x.id} className="tag" style={{ fontSize: 12 }}>{SECTION_TYPES[x.type]?.icon} {SECTION_TYPES[x.type]?.label}{x.props.title ? `: ${x.props.title}` : ''}</span>)}</div>
                {Object.keys(d.theme).length > 0 && <div className="row" style={{ gap: 6, alignItems: 'center' }}>{['primary', 'accent', 'dark', 'soft'].filter((k) => d.theme[k]).map((k) => <span key={k} title={`${k} ${d.theme[k]}`} style={{ width: 22, height: 22, borderRadius: 5, background: d.theme[k], border: '1px solid var(--border)' }} />)}<small className="muted">{[d.theme.font_heading, d.theme.font_body].filter(Boolean).join(' / ')}</small></div>}
                {(d.seo.title || d.seo.description) && <div className="muted"><b>Search result:</b> {d.seo.title} — {d.seo.description}</div>}
                <Toggle value={ai.theme} onChange={(v) => setAi({ ...ai, theme: v })} label="Also apply the colours and fonts" />
                <Toggle value={ai.seo} onChange={(v) => setAi({ ...ai, seo: v })} label="Also use the search title and description" />
                {ai.err && <div className="alert err" role="alert">{ai.err}</div>}
              </div>
            )}
          </Modal>
        );
      })()}
      {tpl && (() => {
        const t = TEMPLATES.find((x) => x.id === tpl.id);
        const apply = () => {
          setPage((p) => ({ ...p, sections: buildSections(t) }));
          if (t.theme && tpl.theme) setCfg((c) => ({ ...c, theme: { ...(c.theme || {}), ...t.theme } }));
          setSelected(null); setTpl(null);
          toast(`${t.name} applied to this page. Review it, Save, then Publish to put it live. Undo brings your old page back.`, 'ok');
        };
        const preview = () => { setPrev({ id: t.id, label: t.name, theme: tpl.theme, sections: buildSections(t), config: { ...cfg, theme: t.theme && tpl.theme ? { ...(cfg.theme || {}), ...t.theme } : cfg.theme } }); setTpl(null); };
        return (
          <Modal title="Start from a template" size="lg" onClose={() => setTpl(null)} footer={<><button className="btn" onClick={() => setTpl(null)}>Cancel</button><button className="btn" disabled={!t} onClick={preview}>Preview on the page</button><button className="btn primary" disabled={!t} onClick={apply}>Use this template</button></>}>
            <p className="muted" style={{ marginTop: 0 }}>Pick a starting point for the page you are editing, then press Preview to see it full size before you decide. Its blocks replace the ones on this page (nothing is saved until you press Save, and Undo and earlier versions still work). Every text is a prompt for you to rewrite. For full freedom choose Blank canvas and add blocks yourself.</p>
            <div className="grid g2" style={{ gap: 10 }}>
              {TEMPLATES.map((x) => (
                <button type="button" key={x.id} className="card" aria-pressed={tpl.id === x.id} style={{ padding: 14, textAlign: 'left', cursor: 'pointer', outline: tpl.id === x.id ? '2px solid var(--primary)' : 'none' }} onClick={() => setTpl({ ...tpl, id: x.id })}>
                  <b>{x.name}</b>
                  <div className="muted" style={{ margin: '4px 0 8px' }}>{x.tagline}</div>
                  <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>{x.blocks.map((bk, i) => <span key={i} className="tag" style={{ fontSize: 11 }}>{SECTION_TYPES[bk.type]?.icon} {SECTION_TYPES[bk.type]?.label}</span>)}</div>
                  <small className="muted">Best for: {x.best}</small>
                  {x.theme && <div className="row" style={{ gap: 4, marginTop: 8 }}>{['primary', 'accent', 'dark', 'soft'].map((k) => <span key={k} title={k} style={{ width: 18, height: 18, borderRadius: 4, background: x.theme[k], border: '1px solid var(--border)' }} />)}<small className="muted" style={{ marginLeft: 6 }}>{x.theme.font_heading}</small></div>}
                </button>
              ))}
            </div>
            {t?.theme && <div style={{ marginTop: 12 }}><Toggle value={tpl.theme} onChange={(v) => setTpl({ ...tpl, theme: v })} label="Also apply its colours and fonts to the whole website" /></div>}
          </Modal>
        );
      })()}
      {newPage && (
        <Modal title="New page" size="sm" onClose={() => setNewPage(null)} footer={<><button className="btn" onClick={() => setNewPage(null)}>Cancel</button><button className="btn primary" disabled={!newPage.title.trim()} onClick={async () => { try { const p = await api.post('/api/site-admin/pages', { title: newPage.title, sections: [{ id: uid(), type: 'banner', props: { text: newPage.title, href: '', tone: 'primary' } }, { id: uid(), type: 'text', props: { title: '', html: 'Write your content here…', align: 'left' } }] }); setNewPage(null); await loadPages(p.id); setPageId(p.id); toast('Page created', 'ok'); } catch (e) { toast(e.message, 'err'); } }}>Create page</button></>}>
          <Field label="Page title" required hint="The web address is generated from the title"><input className="input" autoFocus value={newPage.title} onChange={(e) => setNewPage({ title: e.target.value })} /></Field>
        </Modal>
      )}
      {confirmDel && <ConfirmDialog danger title="Delete page" message={`Delete “${page.title}” permanently?`} confirmLabel="Delete" onCancel={() => setConfirmDel(false)} onConfirm={async () => { await api.del(`/api/site-admin/pages/${page.id}`); setConfirmDel(false); setPageId(null); const l = await api.get('/api/site-admin/pages'); setPages(l); setPageId(l.find((p) => p.slug === 'home').id); }} />}
    </div>
  );
}
