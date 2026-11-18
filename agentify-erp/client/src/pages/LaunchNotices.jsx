import { useRef, useState } from 'react';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date } from '../format.js';

/** Launch notices: possession, allotment, new construction services... shown as a pop-up on the website and in the customer portal. */
export default function LaunchNotices() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/society/launch-notices');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [file, setFile] = useState(null);
  const ref = useRef(null);
  const open = (n) => { setFile(null); setEdit(n || { title: '', body: '', kind: 'Notice', link_label: 'Review details', link_href: '', starts_on: '', ends_on: '', show_popup: 1, active: 1 }); };
  const save = async () => {
    if (!edit.title?.trim()) return toast('Give the notice a title', 'err');
    try {
      const fd = new FormData();
      for (const k of ['title', 'body', 'kind', 'link_label', 'link_href', 'starts_on', 'ends_on']) fd.append(k, edit[k] ?? '');
      fd.append('show_popup', edit.show_popup ? '1' : '0'); fd.append('active', edit.active ? '1' : '0');
      if (file) fd.append('image', file);
      await api.upload(edit.id ? `/api/society/launch-notices/${edit.id}` : '/api/society/launch-notices', fd);
      toast('Saved', 'ok'); setEdit(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Launch notices" sub="Announce a possession, a plot allotment, new construction services or a new launch. Active notices pop up once for each website visitor and appear in every customer’s portal.">
        {can('customers', 'create') && <button className="btn primary" onClick={() => open()}>New notice</button>}
      </PageHead>
      {!data ? <Loading /> : !data.rows.length ? <Card><Empty>No notices yet.</Empty></Card> : (
        <div className="grid g3">{data.rows.map((n) => (
          <Card key={n.id} flush>
            {n.image && <img src={fileUrl(n.image)} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />}
            <div style={{ padding: 12 }}>
              <div className="row between"><b>{n.title}</b><StatusBadge status={n.active ? 'active' : 'inactive'} /></div>
              <div className="cell-sub">{n.kind}{n.show_popup ? ' · pop-up' : ''}{n.starts_on ? ` · from ${date(n.starts_on)}` : ''}{n.ends_on ? ` · until ${date(n.ends_on)}` : ''}</div>
              <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>{n.body}</div>
              <div className="row">{can('customers', 'edit') && <button className="btn sm" onClick={() => open(n)}>Edit</button>}{can('customers', 'delete') && <button className="btn sm danger" onClick={() => setDel(n)}>Delete</button>}</div>
            </div>
          </Card>))}</div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit notice' : 'New notice'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="stack">
            <Field label="Title" required><input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Possession of Block C has started" /></Field>
            <Field label="Details"><textarea className="textarea" rows={4} value={edit.body || ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <div className="form-grid">
              <Field label="Type"><Select allowEmpty={false} value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={data.kinds.map((k) => ({ value: k, label: k }))} /></Field>
              <Field label="Link text"><input className="input" value={edit.link_label || ''} onChange={(e) => setEdit({ ...edit, link_label: e.target.value })} /></Field>
              <Field label="Link address" hint="A page on your website (like /site/p/progress) or a full web address"><input className="input" value={edit.link_href || ''} onChange={(e) => setEdit({ ...edit, link_href: e.target.value })} /></Field>
              <Field label="Show from"><input type="date" className="input" value={edit.starts_on || ''} onChange={(e) => setEdit({ ...edit, starts_on: e.target.value })} /></Field>
              <Field label="Show until"><input type="date" className="input" value={edit.ends_on || ''} onChange={(e) => setEdit({ ...edit, ends_on: e.target.value })} /></Field>
              <Field label="Pop up on the website"><Toggle value={!!edit.show_popup} onChange={(v) => setEdit({ ...edit, show_popup: v ? 1 : 0 })} /></Field>
              <Field label="Active"><Toggle value={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} /></Field>
            </div>
            <Field label="Image (optional)">
              <div className="row" style={{ gap: 10 }}>
                {(file || edit.image) && <img alt="" src={file ? URL.createObjectURL(file) : fileUrl(edit.image)} style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 6 }} />}
                <button type="button" className="btn" onClick={() => ref.current?.click()}>{edit.image || file ? 'Change image' : 'Choose image'}</button>
                <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </Field>
          </div>
        </Modal>)}
      {del && <ConfirmDialog danger title="Delete notice" message={`Delete “${del.title}”?`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const n = del; setDel(null); try { await api.del(`/api/society/launch-notices/${n.id}`); reload(); } catch (e) { toast(e.message, 'err'); } }} />}
    </div>
  );
}
