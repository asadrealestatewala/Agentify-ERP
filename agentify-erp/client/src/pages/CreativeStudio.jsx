// Creative Studio: save your brand, then have AI write a brand story with captions and create post images in your brand's look.
// Everything goes through Agentify's AI service; each use spends workspace credits and the page shows what is left.
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, PageHead, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 };

/** Flag a result as wrong, unsafe or poor. Agentify reviews these. */
function ReportButton({ feature, prompt, output }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const send = async () => {
    const note = window.prompt('What is wrong with this result? (optional)', '');
    if (note === null) return;
    try { await api.post('/api/creative/report', { feature, prompt, output, note }); setDone(true); toast('Thank you. We will review it.'); } catch (e) { toast(e.message, 'err'); }
  };
  return <button className="btn sm" onClick={send} disabled={done} data-tour="creative-report">{done ? 'Reported' : 'Report'}</button>;
}

function Brand({ st, onSaved }) {
  const toast = useToast(); const { can } = useAuth();
  const [b, setB] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/creative/brand').then(setB).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!b) return <Loading rows={2} />;
  const set = (k) => (e) => setB({ ...b, [k]: e.target.value });
  const save = async () => { setBusy(true); setErr(''); try { setB(await api.put('/api/creative/brand', b)); toast('Brand profile saved'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const edit = can('content', 'edit');
  return (
    <Card title="Brand profile">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>{b.saved ? 'Every story and post is written to match this.' : 'Save this once so every story and post matches your brand. It starts from your Branding settings.'}</p>
      <div style={grid}>
        <Field label="Brand name" required><input className="input" value={b.brand_name || ''} onChange={set('brand_name')} maxLength={80} disabled={!edit} /></Field>
        <Field label="Business type" hint="For example real estate agency"><input className="input" value={b.business_type || ''} onChange={set('business_type')} maxLength={80} disabled={!edit} /></Field>
        <Field label="Tone of voice" hint="For example warm and professional"><input className="input" value={b.tone || ''} onChange={set('tone')} maxLength={120} disabled={!edit} /></Field>
        <Field label="Main color"><span className="row" style={{ gap: 8 }}><input type="color" value={b.primary_color || '#0e7c6b'} onChange={set('primary_color')} disabled={!edit} aria-label="Main color" /><input className="input" value={b.primary_color || ''} onChange={set('primary_color')} maxLength={7} style={{ width: 110 }} disabled={!edit} /></span></Field>
        <Field label="Second color (optional)"><span className="row" style={{ gap: 8 }}><input type="color" value={b.secondary_color || '#ffffff'} onChange={set('secondary_color')} disabled={!edit} aria-label="Second color" /><input className="input" value={b.secondary_color || ''} onChange={set('secondary_color')} maxLength={7} style={{ width: 110 }} disabled={!edit} /></span></Field>
        <Field label="Default language"><select className="input" value={b.language} onChange={set('language')} disabled={!edit}>{st.languages.map((l) => <option key={l}>{l}</option>)}</select></Field>
      </div>
      <Field label="About your business" hint="Real facts only. The AI never invents numbers, awards or customers."><textarea className="input" rows={3} value={b.about || ''} onChange={set('about')} maxLength={600} disabled={!edit} /></Field>
      <p className="muted" style={{ fontSize: 13 }}>Logo: {b.logo ? <><img src={`/uploads/${b.logo}`} alt="Your logo" style={{ height: 28, verticalAlign: 'middle', marginInline: 6 }} /> from your Branding settings.</> : 'none set. Add one under Settings > Branding.'}</p>
      {edit && <button className="btn primary" disabled={busy} onClick={save}>Save brand profile</button>}
    </Card>
  );
}

function Story({ st, refresh, brandSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ language: st.languages[0], focus: '' }); const [out, setOut] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const cost = st.costs.brand_story;
  const go = async () => { setBusy(true); setErr(''); try { setOut(await api.post('/api/creative/story', f)); refresh(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const copy = (t) => { navigator.clipboard?.writeText(t).then(() => toast('Copied')).catch(() => {}); };
  return (
    <Card title="Brand story and captions">
      <ErrorBox error={err} />
      {!brandSaved && <p className="muted">Save your brand profile first.</p>}
      <div style={grid}>
        <Field label="Language"><select className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>{st.languages.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="What should the story focus on? (optional)"><input className="input" value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })} maxLength={500} placeholder="Why families trust us" /></Field>
      </div>
      <button className="btn primary" disabled={busy || !st.available || !brandSaved || !st.features.brand_story} onClick={go}>{busy ? 'Writing…' : `Write my story (${cost} credit${cost === 1 ? '' : 's'})`}</button>
      {out && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 6px' }}>{out.title}</h3>
          <p dir={out.language === 'Urdu' ? 'rtl' : 'ltr'} style={{ whiteSpace: 'pre-wrap' }}>{out.story}</p>
          <div className="bold">Captions</div>
          <ul dir={out.language === 'Urdu' ? 'rtl' : 'ltr'}>{out.captions.map((c, i) => <li key={i}>{c} <button className="btn sm" onClick={() => copy(c)}>Copy</button></li>)}</ul>
          <div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => copy(out.story)}>Copy story</button><button className="btn" onClick={go} disabled={busy}>Write another</button><ReportButton feature="brand_story" prompt={f.focus} output={out.story} /></div>
        </div>)}
    </Card>
  );
}

const dataUrl = (o) => `data:${o.mime};base64,${o.data}`;
function Posts({ st, refresh, brandSaved, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ description: '', size: 'square', count: 2 }); const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState({});
  const cost = st.costs.creative_post;
  const go = async () => { setBusy(true); setErr(''); setSaved({}); try { setRes(await api.post('/api/creative/posts', { ...f, language: st.languages[0] })); refresh(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const save = async (i) => { try { await api.post('/api/creative/items', { data: res.options[i].data, title: f.description.slice(0, 60), prompt: f.description, size: f.size }); setSaved((s) => ({ ...s, [i]: true })); toast('Saved to your creations'); onSaved(); } catch (e) { toast(e.message, 'err'); } };
  const download = (i) => { const a = document.createElement('a'); a.href = dataUrl(res.options[i]); a.download = `post-${i + 1}.png`; a.click(); };
  return (
    <Card title="Post images">
      <ErrorBox error={err} />
      <Field label="Describe the post" required hint="What should the image show?"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={600} placeholder="Launch of our new apartments, bright morning light, family walking in" /></Field>
      <div style={grid}>
        <Field label="Size"><select className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{Object.entries(st.sizes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="How many options"><select className="input" value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Each image costs {cost} credits. {f.count} option{f.count === 1 ? '' : 's'} = up to {f.count * cost} credits.</p>
      <button className="btn primary" disabled={busy || !st.available || !brandSaved || !st.features.creative_post} onClick={go}>{busy ? 'Creating…' : res ? 'Create new options' : 'Create images'}</button>
      {!brandSaved && <span className="muted" style={{ marginInlineStart: 8 }}>Save your brand profile first.</span>}
      {res?.partial && <p className="muted" style={{ marginBottom: 0 }}>{res.partial}</p>}
      {res && (
        <div style={{ ...grid, marginTop: 16 }}>
          {res.options.map((o, i) => (
            <div key={i} className="card" style={{ padding: 8 }}>
              <img src={dataUrl(o)} alt={`Option ${i + 1}`} style={{ width: '100%', borderRadius: 6 }} />
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn sm primary" disabled={saved[i]} onClick={() => save(i)}>{saved[i] ? 'Saved' : 'Save'}</button>
                <button className="btn sm" onClick={() => download(i)}>Download</button>
                <ReportButton feature="creative_post" prompt={f.description} output={`image option ${i + 1}`} />
              </div>
            </div>))}
        </div>)}
    </Card>
  );
}

function Mine({ version }) {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.get('/api/creative/items').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load, version]);
  if (!rows) return <Loading rows={2} />;
  if (!rows.length) return <Empty title="Nothing saved yet" hint="Brand stories are kept here automatically. Save a post image to keep it." />;
  const del = async (r) => { if (!window.confirm(`Delete "${r.title}"?`)) return; try { await api.del(`/api/creative/items/${r.id}`); toast('Deleted'); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div style={grid}>
      {rows.map((r) => (
        <Card key={r.id} title={r.title || (r.kind === 'story' ? 'Brand story' : 'Post image')}>
          {r.has_file ? <img src={`/api/creative/items/${r.id}/file`} alt={r.title || 'Post image'} style={{ width: '100%', borderRadius: 6 }} /> : <p style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', margin: 0 }} dir={r.language === 'Urdu' ? 'rtl' : 'ltr'}>{r.body}</p>}
          <div className="muted" style={{ fontSize: 12, margin: '8px 0' }}>{dateTime(r.created_at)}</div>
          <div className="row" style={{ gap: 6 }}>
            {r.has_file && <a className="btn sm" href={`/api/creative/items/${r.id}/file?download=1`}>Download</a>}
            {can('content', 'delete') && <button className="btn sm danger" onClick={() => del(r)}>Delete</button>}
          </div>
        </Card>))}
    </div>
  );
}

export default function CreativeStudio() {
  const [st, setSt] = useState(null); const [err, setErr] = useState(''); const [tab, setTab] = useState('brand'); const [version, setVersion] = useState(0); const [brandSaved, setBrandSaved] = useState(false);
  const refresh = useCallback(() => api.get('/api/creative/status').then((x) => { setSt(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  const checkBrand = useCallback(() => api.get('/api/creative/brand').then((b) => setBrandSaved(!!b.saved)).catch(() => {}), []);
  useEffect(() => { refresh(); checkBrand(); }, [refresh, checkBrand]);
  if (err && !st) return <ErrorBox error={err} />;
  if (!st) return <Loading />;
  const left = st.credits.left;
  return (
    <>
      <PageHead title="Creative Studio" sub="Write your brand story and create post images that match your brand. Each use spends credits." />
      <div className="row" style={{ gap: 12, marginBottom: 12, flexWrap: 'wrap' }} data-tour="creative-credits">
        <span className={`pill ${st.available ? 'green' : 'red'}`}>{st.available ? 'Ready' : 'Not available'}</span>
        <span>Credits left this month: <b>{left == null ? 'No limit' : left}</b>{st.credits.allowance != null ? ` of ${st.credits.allowance}` : ''}</span>
        <span className="muted">Story {st.costs.brand_story} credit · Image {st.costs.creative_post} credits</span>
      </div>
      {st.reason && <Card><p style={{ margin: 0 }}>{st.reason}</p></Card>}
      <Tabs tabs={[{ key: 'brand', label: 'Brand profile' }, { key: 'story', label: 'Brand story' }, { key: 'posts', label: 'Post images' }, { key: 'mine', label: 'My creations' }]} value={tab} onChange={setTab} />
      {tab === 'brand' && <Brand st={st} onSaved={() => { checkBrand(); refresh(); }} />}
      {tab === 'story' && <Story st={st} refresh={() => { refresh(); setVersion((v) => v + 1); }} brandSaved={brandSaved} />}
      {tab === 'posts' && <Posts st={st} refresh={refresh} brandSaved={brandSaved} onSaved={() => setVersion((v) => v + 1)} />}
      {tab === 'mine' && <Mine version={version} />}
    </>
  );
}
