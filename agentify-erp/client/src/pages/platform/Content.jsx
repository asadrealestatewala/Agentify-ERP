// Console pages for growth and communication: website analytics, website content & legal documents, demo requests,
// announcements & release notes, and the integration registry.
import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString());
const pct = (v) => (v == null ? '—' : `${v}%`);
const when = (ts) => (ts ? new Date(String(ts).includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`).toLocaleString() : '—');
function useLoad(url) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); return api.get(url).then(setD).catch((e) => setErr(e.message)); }, [url]);
  useEffect(() => { load(); }, [load]);
  return { d, err, load, setD };
}

// ---------------------------------------------------------------- analytics
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['prev_month', 'Previous month'], ['quarter', 'This quarter'], ['year', 'This year']];
export function AnalyticsPage() {
  const [range, setRange] = useState('30d');
  const { d, err } = useLoad(`${A}/analytics?range=${range}`);
  const table = (rows, label) => (!rows?.length ? <Empty title="No data in this period" /> : (
    <div className="table-wrap"><table className="t"><thead><tr><th>{label}</th><th className="right">Sessions</th><th className="right">Sign-ups</th><th className="right">Sign-up rate</th><th className="right">Demo requests</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className="right">{n0(r.sessions)}</td><td className="right">{n0(r.signups)}</td><td className="right">{pct(r.signup_rate)}</td><td className="right">{n0(r.demos)}</td></tr>)}
    </tbody></table></div>));
  return (
    <>
      <PageTitle title="Website analytics" sub="First-party figures from the public website. No invented numbers: what is not measured is shown as —.">
        <select className="input" style={{ width: 180 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <div className="alert info">{d.note}{d.ga4.configured ? ' Google Analytics 4 also receives events from consenting visitors.' : ''}</div>
          <div className="pa-kpis">
            {[['Visitors', d.visitors], ['Sessions', d.sessions], ['Page views', d.page_views], ['Engaged sessions', d.engaged_sessions, `${pct(d.engagement_rate)} of sessions viewed 2+ pages`],
              ['Sign-ups', d.funnel.signup_completed, `${pct(d.funnel.signup_conversion)} of consenting sessions`], ['Demo requests', d.funnel.demo_requested, `${pct(d.funnel.demo_conversion)} of consenting sessions`],
              ['Checkouts started', d.funnel.checkout_started], ['Subscriptions activated', d.funnel.subscription_activated]].map(([l, v, c]) => (
              <div className="pa-kpi" key={l}><div className="l">{l}</div><div className="v">{n0(v)}</div><div className="c">{c || ''}</div></div>
            ))}
          </div>
          {!!d.series.length && <Card title="Sessions and conversions"><ResponsiveContainer width="100%" height={240}><BarChart data={d.series}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="x" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} width={40} /><Tooltip /><Legend />
            <Bar dataKey="sessions" name="Sessions" fill="#14b8a6" /><Bar dataKey="signups" name="Sign-ups" fill="#3b82f6" /><Bar dataKey="demos" name="Demo requests" fill="#f59e0b" /></BarChart></ResponsiveContainer></Card>}
          <Card title="Funnel">
            <div className="table-wrap"><table className="t"><tbody>
              {[['Product page views', d.funnel.product_page_views], ['Pricing page views', d.funnel.pricing_views], ['Sessions that started sign-up', d.funnel.signup_started], ['Sign-ups completed', d.funnel.signup_completed], ['Checkouts started', d.funnel.checkout_started], ['Subscriptions activated', d.funnel.subscription_activated]].map(([l, v]) => <tr key={l}><td>{l}</td><td className="right mono">{n0(v)}</td></tr>)}
            </tbody></table></div>
          </Card>
          <div className="pa-grid2">
            <Card title="Acquisition channels" flush>{table(d.channels, 'Channel')}</Card>
            <Card title="Landing pages" flush>{table(d.landing_pages, 'Landing page')}</Card>
          </div>
          <div className="pa-grid2">
            <Card title="Top pages" flush>{!d.pages.length ? <Empty title="No page views" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Page</th><th className="right">Views</th><th className="right">Visitors</th></tr></thead><tbody>{d.pages.map((p) => <tr key={p.path}><td className="mono">{p.path}</td><td className="right">{n0(p.views)}</td><td className="right">{n0(p.visitors)}</td></tr>)}</tbody></table></div>}</Card>
            <Card title="Campaigns (utm tags)" flush>{!d.campaigns.length ? <Empty title="No tagged campaigns" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Source / medium</th><th>Campaign</th><th className="right">Sessions</th></tr></thead><tbody>{d.campaigns.map((c, i) => <tr key={i}><td>{c.source} / {c.medium || '—'}</td><td>{c.campaign || '—'}</td><td className="right">{n0(c.sessions)}</td></tr>)}</tbody></table></div>}</Card>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- website content & legal
const pairsToText = (p) => (p || []).map(([a, b]) => `${a} | ${b}`).join('\n');
const textToPairs = (t) => String(t || '').split('\n').map((l) => l.split('|')).filter((x) => x[0]?.trim()).map(([a, ...b]) => [a.trim(), b.join('|').trim()]);
export function WebsitePage() {
  const toast = useToast();
  const { d, err, load } = useLoad(`${A}/marketing`);
  const [f, setF] = useState(null);
  const [doc, setDoc] = useState(null);
  const [pub, setPub] = useState(null);
  useEffect(() => {
    if (!d) return;
    const c = d.content;
    setF({ brand: c.brand, hero_title: c.hero_title, hero_subtitle: c.hero_subtitle, announcement_bar: c.announcement_bar, contact_email: c.contact_email, contact_phone: c.contact_phone, address: c.address, social: { ...c.social },
      re_title: c.real_estate.title, re_subtitle: c.real_estate.subtitle, re_features: pairsToText(c.real_estate.features), re_use: (c.real_estate.use_cases || []).join('\n'),
      con_title: c.construction.title, con_subtitle: c.construction.subtitle, con_features: pairsToText(c.construction.features), con_use: (c.construction.use_cases || []).join('\n'),
      faqs: pairsToText(c.faqs), testimonials: c.testimonials, seo: JSON.parse(JSON.stringify(c.seo)) });
  }, [d]);
  if (!d || !f) return <>{<PageTitle title="Website & legal" />}<ErrorBox error={err} />{!err && <Loading />}</>;
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const save = async () => {
    try {
      await api.put(`${A}/marketing`, { brand: f.brand, hero_title: f.hero_title, hero_subtitle: f.hero_subtitle, announcement_bar: f.announcement_bar, contact_email: f.contact_email, contact_phone: f.contact_phone, address: f.address, social: f.social,
        real_estate: { title: f.re_title, subtitle: f.re_subtitle, features: textToPairs(f.re_features), use_cases: f.re_use.split('\n').filter((x) => x.trim()) },
        construction: { title: f.con_title, subtitle: f.con_subtitle, features: textToPairs(f.con_features), use_cases: f.con_use.split('\n').filter((x) => x.trim()) },
        faqs: textToPairs(f.faqs), testimonials: f.testimonials, seo: f.seo });
      toast('Website content saved'); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const openDoc = async (slug) => { try { setDoc(await api.get(`${A}/legal/${slug}`)); } catch (e) { toast(e.message, 'err'); } };
  const saveDoc = async () => { try { setDoc(await api.put(`${A}/legal/${doc.slug}`, { title: doc.title, body: doc.body })); toast('Draft saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const publish = async () => { try { await api.put(`${A}/legal/${doc.slug}`, { title: doc.title, body: doc.body }); setDoc(await api.post(`${A}/legal/${doc.slug}/publish`, { reviewed_by: pub })); setPub(null); toast('Published'); load(); } catch (e) { toast(e.message, 'err'); } };
  const area = (k, rows = 4, hint) => <Field label={hint?.label} hint={hint?.hint}><textarea className="input" rows={rows} value={f[k]} onChange={(e) => set(k)(e.target.value)} /></Field>;
  return (
    <>
      <PageTitle title="Website & legal" sub="Texts of the public website on the main domain. Describe only what the product really does; testimonials need the customer's permission.">
        <a className="btn sm" href="/" target="_blank" rel="noreferrer">Open website ↗</a><button className="btn primary sm" onClick={save}>Save website content</button>
      </PageTitle>
      <Card title="Home page">
        <div className="pa-grid2" style={{ marginBottom: 0 }}><Field label="Brand name"><TextInput value={f.brand} onChange={set('brand')} /></Field><Field label="Announcement bar (optional)"><TextInput value={f.announcement_bar} onChange={set('announcement_bar')} /></Field></div>
        <Field label="Headline"><TextInput value={f.hero_title} onChange={set('hero_title')} /></Field>
        {area('hero_subtitle', 3, { label: 'Sub-headline' })}
      </Card>
      <div className="pa-grid2">
        {[['re', 'Real Estate page'], ['con', 'Construction page']].map(([p, t]) => (
          <Card key={p} title={t}>
            <Field label="Title"><TextInput value={f[`${p}_title`]} onChange={set(`${p}_title`)} /></Field>
            {area(`${p}_subtitle`, 2, { label: 'Sub-title' })}
            {area(`${p}_features`, 7, { label: 'Features', hint: 'One per line: Title | description' })}
            {area(`${p}_use`, 3, { label: 'Who it is for', hint: 'One per line' })}
          </Card>
        ))}
      </div>
      <Card title="FAQs">{area('faqs', 8, { hint: 'One per line: Question | answer' })}</Card>
      <Card title="Testimonials" actions={<button className="btn sm" onClick={() => set('testimonials')([...f.testimonials, { quote: '', name: '', role: '', company: '', permission: false }])}>Add testimonial</button>}>
        <p className="muted">Only real customers who agreed to be quoted. Each needs a name, company and confirmation of permission, or it cannot be saved.</p>
        {!f.testimonials.length && <Empty title="No testimonials (none are shown on the website)" />}
        {f.testimonials.map((t, i) => {
          const up = (k, v) => set('testimonials')(f.testimonials.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <div key={i} className="card" style={{ padding: 12, marginBottom: 8 }}>
              <Field label="Quote"><textarea className="input" rows={2} value={t.quote} onChange={(e) => up('quote', e.target.value)} /></Field>
              <div className="pa-grid3" style={{ marginBottom: 0 }}><Field label="Name"><TextInput value={t.name} onChange={(v) => up('name', v)} /></Field><Field label="Role"><TextInput value={t.role} onChange={(v) => up('role', v)} /></Field><Field label="Company"><TextInput value={t.company} onChange={(v) => up('company', v)} /></Field></div>
              <div className="row between"><Toggle value={t.permission} onChange={(v) => up('permission', v)} label="The customer gave written permission to publish this" /><button className="btn sm danger" onClick={() => set('testimonials')(f.testimonials.filter((_, j) => j !== i))}>Remove</button></div>
            </div>
          );
        })}
      </Card>
      <div className="pa-grid2">
        <Card title="Contact details">
          <Field label="Email"><TextInput value={f.contact_email} onChange={set('contact_email')} /></Field>
          <Field label="Phone"><TextInput value={f.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field label="Address"><TextInput value={f.address} onChange={set('address')} /></Field>
          {Object.keys(f.social).map((k) => <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} link`}><TextInput value={f.social[k]} placeholder="https://" onChange={(v) => setF({ ...f, social: { ...f.social, [k]: v } })} /></Field>)}
        </Card>
        <Card title="Search engine texts">
          {Object.keys(f.seo).map((k) => (
            <div key={k} style={{ marginBottom: 10 }}><b style={{ textTransform: 'capitalize' }}>{k.replace('_', ' ')}</b>
              <TextInput value={f.seo[k].title} onChange={(v) => setF({ ...f, seo: { ...f.seo, [k]: { ...f.seo[k], title: v } } })} aria-label={`${k} title`} />
              <textarea className="input" rows={2} style={{ marginTop: 4 }} value={f.seo[k].description} onChange={(e) => setF({ ...f, seo: { ...f.seo, [k]: { ...f.seo[k], description: e.target.value } } })} aria-label={`${k} description`} />
              <div className="muted" style={{ fontSize: 12 }}>{f.seo[k].title.length}/70 · {f.seo[k].description.length}/170</div>
            </div>
          ))}
        </Card>
      </div>
      <Card title="Legal documents" flush>
        <p className="muted" style={{ padding: '0 16px' }}>The templates need your details and a review by a qualified lawyer. A document can be published only with a reviewer's name and without [placeholders]. Every published version is kept.</p>
        <div className="table-wrap"><table className="t"><thead><tr><th>Document</th><th>Status</th><th>Version</th><th>Reviewed by</th><th>Last change</th><th /></tr></thead><tbody>
          {d.legal.map((l) => <tr key={l.slug}><td><b>{l.title}</b><div className="muted mono">/legal/{l.slug}</div></td><td><StatusBadge status={l.status === 'published' ? 'active' : 'pending'} label={l.status} /></td><td>{l.status === 'published' ? l.version : '—'}</td><td>{l.reviewed_by || '—'}</td><td className="muted">{when(l.updated_at)} {l.updated_by}</td><td className="right"><button className="btn sm" onClick={() => openDoc(l.slug)}>Edit</button></td></tr>)}
        </tbody></table></div>
      </Card>
      {doc && (
        <Modal title={`Edit · ${doc.title}`} size="lg" onClose={() => setDoc(null)} footer={<><button className="btn" onClick={() => setDoc(null)}>Close</button><button className="btn" onClick={saveDoc}>Save draft</button><button className="btn primary" onClick={() => setPub('')}>Publish…</button></>}>
          <Field label="Title"><TextInput value={doc.title} onChange={(v) => setDoc({ ...doc, title: v })} /></Field>
          <Field label="Text" hint="## for headings, - for list items. No HTML."><textarea className="input mono" rows={22} value={doc.body} onChange={(e) => setDoc({ ...doc, body: e.target.value })} /></Field>
        </Modal>
      )}
      {pub !== null && doc && (
        <Modal title="Publish document" onClose={() => setPub(null)} footer={<><button className="btn" onClick={() => setPub(null)}>Cancel</button><button className="btn primary" disabled={pub.trim().length < 3} onClick={publish}>Publish</button></>}>
          <p>This makes the current text the live version on the website and the version new customers accept.</p>
          <Field label="Reviewed by" required hint="The lawyer or responsible person who approved this text."><TextInput value={pub} onChange={setPub} /></Field>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- demo requests
export function DemoRequestsPage() {
  const toast = useToast();
  const can = useCan();
  const [status, setStatus] = useState('');
  const { d, err, load } = useLoad(`${A}/demo-requests${status ? `?status=${status}` : ''}`);
  const upd = async (r, body) => { try { await api.patch(`${A}/demo-requests/${r.id}`, body); toast('Updated'); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Demo requests" sub="Requests sent from the website's Book a demo form.">
        <select className="input" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option>{['new', 'contacted', 'qualified', 'closed'].map((s) => <option key={s}>{s}</option>)}</select>
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <Card flush>{!d.length ? <Empty title="No demo requests yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Received</th><th>Who</th><th>Interest</th><th>Message</th><th>Source</th><th>Status</th></tr></thead><tbody>
          {d.map((r) => <tr key={r.id}><td className="nowrap">{when(r.created_at)}</td><td><b>{r.name}</b><div><a href={`mailto:${r.email}`}>{r.email}</a></div><div className="muted">{[r.company, r.phone, r.team_size && `team ${r.team_size}`].filter(Boolean).join(' · ')}</div></td>
            <td>{{ real_estate: 'Real estate', construction: 'Construction', both: 'Both' }[r.product] || '—'}</td><td style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{r.message || '—'}</td><td className="muted">{r.source || '—'}{r.landing_page ? <div>{r.landing_page}</div> : null}</td>
            <td>{can('workspaces.edit') ? <select className="input" value={r.status} onChange={(e) => upd(r, { status: e.target.value })} aria-label="Status">{['new', 'contacted', 'qualified', 'closed'].map((s) => <option key={s}>{s}</option>)}</select> : r.status}{r.handled_by && <div className="muted">{r.handled_by}</div>}</td></tr>)}
        </tbody></table></div>}</Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- announcements
const KINDS = [['info', 'Information'], ['release', 'Release notes'], ['feature', 'New feature'], ['maintenance', 'Maintenance'], ['billing', 'Billing']];
const STATE_TONE = { draft: 'pending', scheduled: 'pending', live: 'active', retired: 'inactive' };
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
export function AnnouncementsPage() {
  const toast = useToast();
  const can = useCan();
  const { d, err, load } = useLoad(`${A}/announcements`);
  const [edit, setEdit] = useState(null);
  const [plans, setPlans] = useState([]);
  const [ask, setAsk] = useState(null);
  useEffect(() => { api.get(`${A}/plans`).then((x) => setPlans(x.plans)).catch(() => {}); }, []);
  const save = async () => {
    const body = { title: edit.title, body: edit.body, kind: edit.kind, version_tag: edit.version_tag, show_on_website: edit.show_on_website, publish_at: edit.publish_at ? new Date(edit.publish_at).toISOString() : null, retire_at: edit.retire_at ? new Date(edit.retire_at).toISOString() : null,
      audience: { products: edit.products, plans: edit.plans, tenants: String(edit.tenants || '').split(',').map((x) => Number(x.trim())).filter(Boolean), roles: String(edit.roles || '').split(',').map((x) => x.trim()).filter(Boolean) } };
    try { if (edit.id) await api.put(`${A}/announcements/${edit.id}`, body); else await api.post(`${A}/announcements`, body); toast('Saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const act = async (a, action) => { try { await api.post(`${A}/announcements/${a.id}/${action}`); toast({ publish: 'Published', retire: 'Retired', draft: 'Back to draft' }[action]); setAsk(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const toggle = (k, v) => setEdit({ ...edit, [k]: edit[k].includes(v) ? edit[k].filter((x) => x !== v) : [...edit[k], v] });
  const v = d?.version;
  return (
    <>
      <PageTitle title="Announcements & releases" sub="Notes shown inside workspaces (and optionally on the website). Publishing a note does not deploy software; the running version is shown below.">
        {can('content.manage') && <button className="btn primary sm" onClick={() => setEdit({ title: '', body: '', kind: 'info', version_tag: '', show_on_website: false, publish_at: '', retire_at: '', products: [], plans: [], tenants: '', roles: '' })}>New announcement</button>}
      </PageTitle>
      <ErrorBox error={err} />
      {v && <Card title="Running version"><div className="pa-grid3" style={{ marginBottom: 0 }}>
        <div><div className="muted">Version</div><b>{v.version || 'unknown'}</b></div><div><div className="muted">Commit</div><b className="mono">{v.commit_short || 'unknown'}</b>{v.ref ? <span className="muted"> · {v.ref}</span> : ''}</div>
        <div><div className="muted">Deployed</div><b>{v.deployed_at ? when(v.deployed_at) : 'not recorded'}</b><div className="muted">Source: {v.source} · server started {when(v.server_started_at)}</div></div></div></Card>}
      {!d ? (!err && <Loading />) : (
        <Card flush>{!d.items.length ? <Empty title="No announcements yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Announcement</th><th>Audience</th><th>When</th><th>State</th><th>Seen / read</th><th /></tr></thead><tbody>
          {d.items.map((a) => <tr key={a.id}><td><b>{a.title}</b>{a.version_tag && <span className="muted"> · v{a.version_tag}</span>}<div className="muted">{KINDS.find(([k]) => k === a.kind)?.[1]}{a.show_on_website ? ' · on website' : ''}</div></td>
            <td className="muted">{[a.audience.products?.length && a.audience.products.join(', '), a.audience.plans?.length && `plans: ${a.audience.plans.join(', ')}`, a.audience.tenants?.length && `${a.audience.tenants.length} workspace(s)`, a.audience.roles?.length && `roles: ${a.audience.roles.join(', ')}`].filter(Boolean).join(' · ') || 'Everyone'}</td>
            <td className="nowrap">{a.publish_at ? when(a.publish_at) : '—'}{a.retire_at && <div className="muted">until {when(a.retire_at)}</div>}</td>
            <td><StatusBadge status={STATE_TONE[a.state]} label={a.state} /></td><td>{a.seen} / {a.read_count}</td>
            <td className="right nowrap">{can('content.manage') && <>
              <button className="btn sm" onClick={() => setEdit({ ...a, publish_at: toLocalInput(a.publish_at), retire_at: toLocalInput(a.retire_at), products: a.audience.products || [], plans: a.audience.plans || [], tenants: (a.audience.tenants || []).join(', '), roles: (a.audience.roles || []).join(', ') })}>Edit</button>{' '}
              {a.state === 'draft' && <button className="btn sm primary" onClick={() => setAsk({ a, action: 'publish' })}>Publish</button>}
              {['live', 'scheduled'].includes(a.state) && <button className="btn sm" onClick={() => setAsk({ a, action: 'retire' })}>Retire</button>}
              {a.state === 'retired' && <button className="btn sm" onClick={() => act(a, 'draft')}>Reopen as draft</button>}</>}</td></tr>)}
        </tbody></table></div>}</Card>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit announcement' : 'New announcement'} size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="pa-grid2" style={{ marginBottom: 0 }}><Field label="Title" required><TextInput value={edit.title} onChange={(x) => setEdit({ ...edit, title: x })} /></Field>
            <Field label="Kind"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
          <Field label="Text" required><textarea className="input" rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <div className="pa-grid3" style={{ marginBottom: 0 }}>
            <Field label="Version (release notes)"><TextInput value={edit.version_tag || ''} onChange={(x) => setEdit({ ...edit, version_tag: x })} placeholder="e.g. 2.1" /></Field>
            <Field label="Publish at" hint="Empty = when you press Publish"><input type="datetime-local" className="input" value={edit.publish_at} onChange={(e) => setEdit({ ...edit, publish_at: e.target.value })} /></Field>
            <Field label="Hide after" hint="Optional"><input type="datetime-local" className="input" value={edit.retire_at} onChange={(e) => setEdit({ ...edit, retire_at: e.target.value })} /></Field>
          </div>
          <h4 style={{ margin: '8px 0' }}>Audience (nothing ticked = everyone)</h4>
          <Field label="Products"><div className="row" style={{ gap: 12 }}>{[['real_estate', 'Real estate'], ['construction', 'Construction']].map(([k, l]) => <label key={k} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.products.includes(k)} onChange={() => toggle('products', k)} />{l}</label>)}</div></Field>
          <Field label="Plans"><div className="row wrap" style={{ gap: 12 }}><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.plans.includes('trial')} onChange={() => toggle('plans', 'trial')} />On trial</label>{plans.map((p) => <label key={p.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.plans.includes(p.id)} onChange={() => toggle('plans', p.id)} />{p.name} <span className="muted mono">{p.id}</span></label>)}</div></Field>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="Only these workspaces" hint="Workspace ids, comma separated"><TextInput value={edit.tenants} onChange={(x) => setEdit({ ...edit, tenants: x })} /></Field>
            <Field label="Only these workspace roles" hint="e.g. Super Admin, Admin, Finance Manager"><TextInput value={edit.roles} onChange={(x) => setEdit({ ...edit, roles: x })} /></Field>
          </div>
          <Toggle value={edit.show_on_website} onChange={(x) => setEdit({ ...edit, show_on_website: x })} label="Also show on the public website (only for notes without workspace or role targeting)" />
        </Modal>
      )}
      {ask && <ConfirmDialog title={ask.action === 'publish' ? 'Publish announcement?' : 'Retire announcement?'} confirmLabel={ask.action === 'publish' ? 'Publish' : 'Retire'} message={ask.action === 'publish' ? 'It appears to its audience now (or at its publish time).' : 'It disappears from workspaces and the website. Read counts are kept.'} onCancel={() => setAsk(null)} onConfirm={() => act(ask.a, ask.action)} />}
    </>
  );
}

// ---------------------------------------------------------------- video meeting limits (platform-wide ceilings every workspace stays under)
function MeetingLimits() {
  const toast = useToast();
  const can = useCan();
  const { d, load } = useLoad(`${A}/meetings-settings`);
  const [f, setF] = useState(null);
  useEffect(() => { if (d) setF({ ...d }); }, [d]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { try { await api.put(`${A}/meetings-settings`, f); toast('Saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const num = (k, label, hint) => <Field label={label} hint={hint}><input className="input" type="number" value={f[k]} disabled={!can('system.manage')} onChange={set(k)} /></Field>;
  return (
    <Card title="Video meetings: limits">
      <p className="muted" style={{ marginTop: 0 }}>Set from here for the whole platform. A workspace can choose shorter meetings but never go above these. A meeting ends automatically when its time is up.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        {num('max_minutes', 'Longest meeting (minutes)', 'Hard stop for every meeting')}
        {num('max_participants', 'People per meeting', 'Video is peer to peer, so keep this small (2 to 25)')}
        {num('early_join_minutes', 'Room opens early (minutes)')}
        {num('max_advance_days', 'Schedule up to (days ahead)')}
      </div>
      <div className="row" style={{ gap: 18, margin: '8px 0' }}>
        <label><input type="checkbox" checked={!!f.enabled} disabled={!can('system.manage')} onChange={set('enabled')} /> Meetings are available</label>
        <label><input type="checkbox" checked={!!f.recording} disabled={!can('system.manage')} onChange={set('recording')} /> Recording is allowed</label>
      </div>
      {can('system.manage') && <button className="btn primary" onClick={save}>Save limits</button>}
      <p className="muted">Reliable video across home and office networks needs a TURN relay server. Set the ERP_ICE_SERVERS environment variable to its address; without one, some people behind strict firewalls will not connect.</p>
    </Card>);
}

const STATE = { connected: ['active', 'Connected'], configured: ['pending', 'Configured, not tested'], error: ['overdue', 'Error'], not_configured: ['inactive', 'Not configured'], not_available: ['inactive', 'Not available yet'] };
export function IntegrationsPage() {
  const toast = useToast();
  const can = useCan();
  const { d, err, load } = useLoad(`${A}/integrations`);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const save = async () => { try { await api.put(`${A}/integrations/${edit.id}`, edit.values); toast('Saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const testIt = async (i) => { setBusy(i.id); try { const r = await api.post(`${A}/integrations/${i.id}/test`, {}); toast(r.ok ? `Test passed: ${r.detail}` : `Test failed: ${r.detail}`, r.ok ? 'ok' : 'err'); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const off = async (i) => { if (!window.confirm(`Remove the ${i.name} credentials?`)) return; try { await api.del(`${A}/integrations/${i.id}`); toast('Disconnected'); load(); } catch (e) { toast(e.message, 'err'); } };
  const FORMS = {
    email: [['api_key', 'Resend API key', 'password', 'Starts with re_. Leave blank to keep the saved key.'], ['from', 'From address', 'text', 'Agentify ERP <no-reply@yourdomain.com> (domain verified in Resend)'], ['reply_to', 'Reply-To for automated e-mails', 'text', 'Optional. Defaults to hello@agentifyerp.co when sending from agentifyerp.co'], ['webhook_secret', 'Webhook signing secret', 'password', 'Starts with whsec_. From the webhook you create in Resend for the Mailbox. Leave blank to keep the saved one.']],
    ga4: [['measurement_id', 'GA4 measurement ID', 'text', 'G-XXXXXXXXXX']],
    ...Object.fromEntries(['google', 'apple', 'meta', 'linkedin', 'tiktok'].map((p) => [`oauth_${p}`, p === 'apple' ? [['client_id', 'Services ID', 'text', 'The Services ID from your Apple developer account'], ['team_id', 'Team ID', 'text', ''], ['key_id', 'Key ID', 'text', ''], ['private_key', 'Private key (.p8)', 'password', 'Paste the whole file. Leave blank to keep the saved key.']] : [['client_id', p === 'meta' ? 'App ID' : p === 'tiktok' ? 'Client key' : 'Client ID', 'text', ''], ['client_secret', p === 'meta' ? 'App secret' : 'Client secret', 'password', 'Leave blank to keep the saved secret.']]])),
    alerts: [['url', 'Incoming webhook URL', 'password', 'https:// only. Slack, Microsoft Teams or any service accepting {"text": "..."}']],
  };
  return (
    <>
      <PageTitle title="Integrations" sub="An integration shows as Connected only after a real test request succeeded. Secrets are stored encrypted and never shown again." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : d.map((i) => {
        const [tone, label] = STATE[i.state] || ['inactive', i.state];
        return (
          <Card key={i.id} title={i.name} actions={<StatusBadge status={tone} label={label} />}>
            <p className="muted" style={{ marginTop: 0 }}>{i.category} · {i.purpose}</p>
            {i.note && <p className="muted">{i.note}</p>}
            {i.test && <p>Last check {when(i.test.created_at)}: <b>{i.test.outcome === 'success' ? 'passed' : 'failed'}</b>{i.test.detail ? ` · ${i.test.detail}` : ''}</p>}
            {i.id === 'email' && i.settings.env_key && <p className="muted">Using the key from the server environment (RESEND_API_KEY).</p>}
            {i.id.startsWith('oauth_') && <p className="muted">Redirect address to register: <span className="mono">{`${window.location.origin}/api/platform/oauth/${i.id.slice(6)}/callback`}</span>{i.settings.developer_console ? <> · <a href={i.settings.developer_console} target="_blank" rel="noreferrer">Open the developer console</a></> : null}</p>}
            {i.id === 'ga4' && i.settings.measurement_id && <p>Measurement ID <span className="mono">{i.settings.measurement_id}</span></p>}
            {i.id === 'email' && <p className="muted">Mailbox webhook signing secret: {i.settings.webhook_secret?.set ? `saved (ends ${i.settings.webhook_secret.hint})` : 'not saved yet. Needed for live delivery status and the Mailbox.'}</p>}
            {(i.settings.api_key?.set || i.settings.url?.set) && <p className="muted">Saved credential ends {i.settings.api_key?.hint || i.settings.url?.hint}</p>}
            {can('integrations.manage') && <div className="row wrap" style={{ gap: 8 }}>
              {FORMS[i.id] && <button className="btn sm" onClick={() => setEdit({ id: i.id, name: i.name, values: Object.fromEntries(FORMS[i.id].map(([k]) => [k, k === 'from' ? i.settings.from || '' : k === 'reply_to' ? i.settings.reply_to || '' : k === 'measurement_id' ? i.settings.measurement_id || '' : ''])) })}>Configure</button>}
              {(['email', 'stripe', 'alerts'].includes(i.id) || i.id.startsWith('oauth_')) && i.configured && <button className="btn sm primary" disabled={busy === i.id} onClick={() => testIt(i)}>{busy === i.id ? 'Testing…' : 'Send test'}</button>}
              {i.manage && <a className="btn sm" href={i.manage}>Open settings</a>}
              {FORMS[i.id] && i.configured && !i.settings.env_key && <button className="btn sm danger" onClick={() => off(i)}>Disconnect</button>}
            </div>}
            {!!i.events?.length && <details style={{ marginTop: 8 }}><summary className="muted">History</summary><div className="table-wrap"><table className="t"><tbody>{i.events.map((e, k) => <tr key={k}><td className="nowrap muted">{when(e.created_at)}</td><td>{e.action}</td><td><StatusBadge status={e.outcome === 'success' ? 'active' : 'overdue'} label={e.outcome} /></td><td className="muted">{e.detail}</td><td className="muted">{e.actor}</td></tr>)}</tbody></table></div></details>}
          </Card>
        );
      })}
      <MeetingLimits />
      {edit && (
        <Modal title={`Configure · ${edit.name}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          {FORMS[edit.id].map(([k, l, type, hint]) => <Field key={k} label={l} hint={hint}><TextInput type={type} autoComplete="off" value={edit.values[k]} onChange={(v) => setEdit({ ...edit, values: { ...edit.values, [k]: v } })} /></Field>)}
          <p className="muted">After saving, use Send test: the status changes to Connected only if the provider accepts a real request.</p>
        </Modal>
      )}
    </>
  );
}
