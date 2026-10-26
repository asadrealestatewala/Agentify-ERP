// Helpers shared by the website studio: field rows, the media picker, blog and review tabs, and the publish panel.
import { useCallback, useEffect, useState } from 'react';
import RichEditor from '../../components/RichEditor.jsx';
import SeoAssistant, { slugify } from '../../components/SeoAssistant.jsx';
import Icon from '../../components/Icon.jsx';
import { FileUploader } from '../../components/Uploaders.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, Select, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useAuth, useToast, useUndoDelete } from '../../context.jsx';
import { FONTS, imgUrl } from '../../site/siteCore.jsx';

export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export const setPath = (o, p, v) => { const ks = p.split('.'); const root = Array.isArray(o) ? [...o] : { ...o }; let cur = root; ks.forEach((k, i) => { if (i === ks.length - 1) cur[k] = v; else { cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] || {}) }; cur = cur[k]; } }); return root; };
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ media picker
export function ImagePicker({ value, onChange }) {
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

export function FieldRow({ f, value, onChange, ctx }) {
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
export const LINKS = (label) => ({ key: label.key, label: label.label, type: 'list', item: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'href', label: 'Link (e.g. /site/properties)', type: 'text' }], blank: { label: '', href: '' } });
export const SITE_GROUPS = [
  { id: 'brand', title: 'Brand & logo', fields: [{ key: 'brand.name', label: 'Website name', type: 'text' }, { key: 'brand.tagline', label: 'Tagline', type: 'text' }, { key: 'brand.logo', label: 'Logo (replaces the name in header & footer)', type: 'image' }] },
  { id: 'theme', title: 'Colours & fonts', fields: [{ key: 'theme.primary', label: 'Primary colour', type: 'color' }, { key: 'theme.accent', label: 'Accent colour', type: 'color' }, { key: 'theme.dark', label: 'Dark colour (footer, banners)', type: 'color' }, { key: 'theme.bg', label: 'Page background', type: 'color' }, { key: 'theme.soft', label: 'Soft section background', type: 'color' }, { key: 'theme.font_heading', label: 'Heading font', type: 'font' }, { key: 'theme.font_body', label: 'Body font', type: 'font' }, { key: 'theme.radius', label: 'Corner roundness (px)', type: 'range', min: 0, max: 24 }] },
  { id: 'header', title: 'Header', fields: [LINKS({ key: 'header.links', label: 'Menu links' }), { key: 'header.cta_label', label: 'Button text', type: 'text' }, { key: 'header.cta_href', label: 'Button link', type: 'text' }, { key: 'header.show_phone', label: 'Show phone number in header', type: 'bool' }, { key: 'header.signin', label: 'Show a Sign in menu in the header and footer', type: 'bool' }, { key: 'header.sticky', label: 'Keep header fixed while scrolling', type: 'bool' }] },
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

// ------------------------------------------------------------------ blog
/** Reviews sent from the website's review form: approve before they appear, reject, or delete. */
export function ReviewsTab({ canEdit, canDelete }) {
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

export function BlogTab({ ctx }) {
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


// ------------------------------------------------------------------ main editor
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

/** Publishing: what visitors see is the last published release; saves are a draft until Publish. */
export function PublishPanel({ status, dirty, onSaveFirst, onChanged, onDiscarded, onClose }) {
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
