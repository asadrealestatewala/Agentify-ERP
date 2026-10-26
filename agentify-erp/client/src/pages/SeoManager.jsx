import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Card, Empty, Field, Loading, Modal, PageHead, Stat, Toggle } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';

const Counter = ({ value = '', min, max }) => {
  const n = value.trim().length;
  const tone = !n ? 'grey' : n < min || n > max ? 'amber' : 'green';
  return <span className={`pill ${tone}`} style={{ marginLeft: 8 }}>{n} / {min}–{max}</span>;
};

/** What the search result will look like (Google style). */
function SerpPreview({ url, title, desc, base }) {
  return (
    <div style={{ border: '1px solid var(--border-2)', borderRadius: 10, padding: 12, background: 'var(--surface-2)' }}>
      <div className="muted" style={{ fontSize: 12 }}>{(base || window.location.origin).replace(/^https?:\/\//, '')}{url}</div>
      <div style={{ color: '#1a0dab', fontSize: 18, lineHeight: 1.3, margin: '2px 0' }}>{title.slice(0, 62) || 'Page title'}{title.length > 62 ? '…' : ''}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{desc.slice(0, 160) || 'No description yet — search engines will pick text from the page.'}{desc.length > 160 ? '…' : ''}</div>
    </div>
  );
}

function MetaEditor({ item, base, onClose, onSaved, canEdit }) {
  const toast = useToast();
  const [t, setT] = useState(item.seo_title || '');
  const [d, setD] = useState(item.seo_desc || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.put(`/api/seo/${item.kind === 'post' ? 'posts' : 'pages'}/${item.id}`, { seo_title: t, seo_desc: d }); toast('SEO details saved', 'ok'); onSaved(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={`SEO · ${item.title}`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button>{canEdit && <button className="btn primary" disabled={busy} onClick={save}>Save</button>}</>}>
      <div className="stack">
        <Field label={<>SEO title<Counter value={t} min={30} max={60} /></>} hint="Shown as the blue link in Google. Put the main keyword first, then the brand."><input className="input" value={t} onChange={(e) => setT(e.target.value)} disabled={!canEdit} placeholder={item.title} /></Field>
        <Field label={<>Meta description<Counter value={d} min={70} max={160} /></>} hint="One or two sentences that make people click: what is here, where, and why us."><textarea className="textarea" rows={3} value={d} onChange={(e) => setD(e.target.value)} disabled={!canEdit} /></Field>
        <SerpPreview url={item.url} title={t || item.title} desc={d} base={base} />
        {item.issues.length > 0 && <div className="stack" style={{ gap: 4 }}><b style={{ fontSize: 13 }}>Currently flagged</b>{item.issues.map((i) => <div key={i} className="muted">• {i}</div>)}</div>}
      </div>
    </Modal>
  );
}

export default function SeoManager() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch('/api/seo/overview');
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('seo', 'edit');
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const f = form || data.site;
  const set = (k, v) => setForm({ ...f, [k]: v });
  const rows = [...data.pages, ...data.posts];
  const flagged = rows.filter((r) => r.published && r.issues.length).length;
  const saveSite = async () => {
    setBusy(true);
    try { await api.put('/api/seo/site', f); toast('Site-wide SEO saved', 'ok'); setForm(null); reload(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <PageHead title="SEO manager" sub="Titles, descriptions, sitemap and structured data for the public website.">
        {can('seo', 'export') && <button className="btn" onClick={() => download('/api/seo/export', { format: 'csv' }, 'seo-audit.csv').catch((e) => toast(e.message, 'err'))}><Icon name="download" size={14} />Export audit</button>}
        <a className="btn" href="/site" target="_blank" rel="noreferrer">View website</a>
      </PageHead>
      <div className="grid cols-4">
        <Stat label="SEO health" value={`${data.score}%`} tone={data.score >= 80 ? 'green' : data.score >= 55 ? 'amber' : 'red'} icon="chart" />
        <Stat label="Pages needing work" value={flagged} tone={flagged ? 'amber' : 'green'} icon="file" />
        <Stat label="Live listings" value={data.content.listings_live} sub={`${data.content.listings_thin} with a short description`} icon="building" />
        <Stat label="Live projects" value={data.content.projects_live} sub={`${data.content.projects_thin} with a short description`} icon="hardhat" />
      </div>

      {data.siteIssues.length > 0 && <Card title="Site-wide to-do">{data.siteIssues.map((i) => <div key={i} className="row" style={{ gap: 8, padding: '4px 0' }}><span className="pill amber">To do</span>{i}</div>)}</Card>}

      <Card title="Site-wide defaults" actions={canEdit && form && <><button className="btn sm" onClick={() => setForm(null)}>Discard</button><button className="btn sm primary" disabled={busy} onClick={saveSite}>Save</button></>}>
        <div className="grid cols-2" style={{ gap: 14 }}>
          <Field label={<>Default site title<Counter value={f.title} min={30} max={60} /></>}><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Website address" hint="Used in the sitemap and share links, e.g. https://www.expertdevelopers.pk"><input className="input" value={f.base_url} onChange={(e) => set('base_url', e.target.value)} disabled={!canEdit} placeholder="https://" /></Field>
          <Field label={<>Default description<Counter value={f.description} min={70} max={160} /></>}><textarea className="textarea" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Keywords" hint="Comma separated. Search engines give these little weight, but they help the website assistant and site search."><textarea className="textarea" rows={3} value={f.keywords} onChange={(e) => set('keywords', e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Business type (structured data)"><select className="input" value={f.org_type} onChange={(e) => set('org_type', e.target.value)} disabled={!canEdit}>{['RealEstateAgent', 'Organization', 'LocalBusiness', 'GeneralContractor'].map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Search engines"><div className="row between"><span>{f.noindex ? 'Hidden from Google (noindex)' : 'Visible to Google'}</span><Toggle value={!f.noindex} onChange={(v) => canEdit && set('noindex', !v)} /></div></Field>
        </div>
        <div style={{ marginTop: 14 }}><SerpPreview url="/site" title={f.title} desc={f.description} base={f.base_url} /></div>
        <p className="muted" style={{ marginTop: 10 }}>Share image: {data.site.image ? 'set' : 'not set'} (the Website Manager sets it under Website Editor → SEO). Structured data (company name, logo, phone, address, social profiles) is added to every page automatically.</p>
      </Card>

      <Card title="Pages & blog posts" flush>
        {!rows.length ? <Empty icon="file" title="No pages yet" /> : (
          <table className="t"><thead><tr><th>Page</th><th>SEO title</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.kind}${r.id}`}>
                <td><div className="cell-main">{r.title}</div><div className="cell-sub">{r.kind === 'post' ? 'Blog post' : 'Page'} · <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>{!r.published && ' · draft'}</div></td>
                <td className="muted" style={{ maxWidth: 220 }}>{r.seo_title || '—'}</td>
                <td className="muted" style={{ maxWidth: 260 }}>{r.seo_desc ? `${r.seo_desc.slice(0, 70)}${r.seo_desc.length > 70 ? '…' : ''}` : '—'}</td>
                <td>{r.issues.length ? <span className="pill amber" title={r.issues.join('\n')}>{r.issues.length} to fix</span> : <span className="pill green">Good</span>}</td>
                <td><button className="btn sm" onClick={() => setEdit(r)}>{canEdit ? 'Edit SEO' : 'View'}</button></td>
              </tr>))}</tbody></table>
        )}
      </Card>

      <Card title="Files for search engines">
        <div className="row wrap" style={{ gap: 10 }}>
          <a className="btn" href={data.sitemap} target="_blank" rel="noreferrer">Open sitemap.xml</a><a className="btn" href={data.robots} target="_blank" rel="noreferrer">Open robots.txt</a>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>The sitemap lists every live page, property, project and blog post and updates itself. Submit <b>{(data.site.base_url || window.location.origin)}/sitemap.xml</b> in Google Search Console once the site is on its real domain.</p>
      </Card>

      {edit && <MetaEditor item={edit} base={data.site.base_url} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
