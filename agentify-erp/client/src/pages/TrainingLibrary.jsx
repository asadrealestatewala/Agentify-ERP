import { useState } from 'react';
import { FormModal } from '../components/ResourcePage.jsx';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { date } from '../format.js';

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** The Assign dialog: tick the roles whose portals should show this video. */
function AssignModal({ video, roles, onClose, onDone }) {
  const toast = useToast();
  const [ids, setIds] = useState(() => video.roles.map((r) => r.id));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const staff = roles.filter((r) => !r.portal), external = roles.filter((r) => r.portal);
  const toggle = (id) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const all = (list, on) => setIds((x) => (on ? [...new Set([...x, ...list.map((r) => r.id)])] : x.filter((id) => !list.some((r) => r.id === id))));
  const save = async () => { setBusy(true); setErr(''); try { await api.put(`/api/training/library/${video.id}/assign`, { role_ids: ids }); toast(`Assigned to ${ids.length} role${ids.length === 1 ? '' : 's'}`, 'ok'); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const group = (title, list) => (
    <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <legend style={{ padding: '0 6px', fontWeight: 650 }}>{title}</legend>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><button type="button" className="btn sm ghost" onClick={() => all(list, true)}>Select all</button><button type="button" className="btn sm ghost" onClick={() => all(list, false)}>Clear</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>{list.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name}</label>)}</div>
    </fieldset>
  );
  return (
    <Modal title={`Assign "${video.title}"`} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save (${ids.length} role${ids.length === 1 ? '' : 's'})`}</button></>}>
      <div className="stack">{err && <div className="alert err" role="alert">{err}</div>}
        <div className="alert info">People see this video in <b>Training videos</b> only if their role is ticked. Super Admins and the Admin role always see every video.</div>
        {group('Staff roles', staff)}{!!external.length && group('External portals', external)}
      </div>
    </Modal>
  );
}

function AddVideo({ categories, roles, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', category: categories[0] }); const [file, setFile] = useState(null); const [ids, setIds] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    if (!file) return setErr('Choose a video file (MP4, WebM or MOV, up to 300 MB)'); if (!f.title.trim()) return setErr('Give the video a title');
    setBusy(true); setErr('');
    try { const fd = new FormData(); fd.append('title', f.title); fd.append('description', f.description); fd.append('category', f.category); fd.append('role_ids', JSON.stringify(ids)); fd.append('file', file); await api.upload('/api/training/library', fd); toast('Added to the training library', 'ok'); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a training video" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Uploading…' : 'Add video'}</button></>}>
      <div className="stack">{err && <div className="alert err" role="alert">{err}</div>}
        <Field label="Video file" required hint="MP4, WebM or MOV"><input type="file" accept="video/mp4,video/webm,video/quicktime" aria-label="Video file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. How to record an installment receipt" /></Field>
        <Field label="Topic"><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="What it shows"><textarea className="textarea" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Assign to roles (you can change this later)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>{roles.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={ids.includes(r.id)} onChange={() => setIds(ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id])} /> {r.name}{r.portal ? ' (portal)' : ''}</label>)}</div>
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Training videos. Each person sees only the videos assigned to their role; super admins and admins see all of them and can assign, add, edit and delete.
 */
export default function TrainingLibrary() {
  const toast = useToast();
  const d = useFetch('/api/training/library');
  const [cat, setCat] = useState('All'); const [add, setAdd] = useState(false); const [edit, setEdit] = useState(null); const [del, setDel] = useState(null); const [assign, setAssign] = useState(null);
  if (d.error) return <div className="alert err">{d.error}</div>;
  if (!d.data) return <Loading />;
  const { rows, categories, can, roles = [] } = d.data, mgr = !!can?.manage, shown = cat === 'All' ? rows : rows.filter((v) => v.category === cat), used = ['All', ...[...new Set(rows.map((v) => v.category))]];
  const fail = (e) => toast(e.message, 'err');
  const length = (s) => (s ? (s < 90 ? `${s} sec` : `${Math.round(s / 60)} min`) : '');
  return (
    <div className="stack">
      <PageHead title="Training videos" sub={mgr ? 'Every training video. Use Assign to choose which roles see each one, so every team gets its own set.' : 'Short videos made for your role. Watch them here, or download them to keep.'}>
        {mgr && <button className="btn primary" onClick={() => setAdd(true)}><Icon name="plus" size={14} />Add a video</button>}
      </PageHead>
      {used.length > 2 && <div className="row" role="group" aria-label="Filter by topic" style={{ gap: 6, flexWrap: 'wrap' }}>{used.map((c) => <button key={c} type="button" className={`pill ${cat === c ? 'blue' : 'grey'}`} style={{ cursor: 'pointer', border: 0 }} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>}
      {!shown.length ? <Empty icon="video" title="No training videos for your role yet" hint="When the administrator assigns a video to your role, it appears here." /> : (
        <div className="grid g3" style={{ alignItems: 'start' }}>{shown.map((v) => (
          <Card key={v.id} flush>
            <video controls preload="metadata" playsInline style={{ width: '100%', display: 'block', background: '#000', aspectRatio: '16 / 9' }} aria-label={v.title} src={`/api/training/library/${v.id}/file`} />
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 650 }}>{v.title}</div>
              <div className="cell-sub">{v.category}{v.seconds ? ` · ${length(v.seconds)}` : ''} · {mb(v.size)} · {date(String(v.created_at).slice(0, 10))}</div>
              {v.description && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13.5 }}>{v.description}</p>}
              {mgr && <div style={{ marginTop: 8, fontSize: 12.5 }}><span className="muted">Assigned to: </span>{v.roles.length ? v.roles.map((r) => <span key={r.id} className="pill grey" style={{ marginRight: 4 }}>{r.name}</span>) : <span className="pill amber">Nobody yet (admins only)</span>}</div>}
              <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {mgr && <button className="btn sm primary" onClick={() => setAssign(v)}><Icon name="users" size={13} />Assign</button>}
                <button className={`btn sm ${mgr ? '' : 'primary'}`} onClick={() => download(`/api/training/library/${v.id}/file`, { download: 1 }, `${v.title.replace(/[^\w]+/g, '-')}.${v.mime === 'video/webm' ? 'webm' : 'mp4'}`).catch(fail)}><Icon name="download" size={13} />Download</button>
                {mgr && <button className="btn sm" onClick={() => setEdit(v)}>Edit</button>}
                {mgr && <button className="btn sm ghost danger" onClick={() => setDel(v)}>Delete</button>}
              </div>
            </div>
          </Card>))}</div>)}
      {add && <AddVideo categories={categories} roles={roles} onClose={() => setAdd(false)} onDone={() => { setAdd(false); d.reload(); }} />}
      {assign && <AssignModal video={assign} roles={roles} onClose={() => setAssign(null)} onDone={() => { setAssign(null); d.reload(); }} />}
      {edit && <FormModal title="Edit video details" size="md" initial={edit} onClose={() => setEdit(null)}
        fields={[{ name: 'title', label: 'Title', required: true }, { name: 'category', label: 'Topic', type: 'select', allowEmpty: false, options: categories.map((c) => ({ value: c, label: c })) }, { name: 'description', label: 'What it shows', type: 'textarea', full: true }]}
        onSave={async (b) => { await api.put(`/api/training/library/${edit.id}`, { title: b.title, category: b.category, description: b.description || '' }); toast('Saved', 'ok'); setEdit(null); d.reload(); }} />}
      {del && <ConfirmDialog title={`Delete "${del.title}"?`} message="It is removed from the training library for everyone." danger confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { try { await api.del(`/api/training/library/${del.id}`); toast('Deleted', 'ok'); d.reload(); } catch (e) { fail(e); } setDel(null); }} />}
    </div>
  );
}
