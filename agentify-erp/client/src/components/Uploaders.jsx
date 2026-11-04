import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api, fileUrl } from '../api.js';
import { useToast } from '../context.jsx';
import { dateTime } from '../format.js';
import { Loading, Empty, Select, ConfirmDialog } from './ui.jsx';
import { useFetch, useLookups, useUndoDelete } from '../context.jsx';

/** Drag-and-drop / click-to-pick file area. Calls onFiles(File[]). */
export function FileUploader({ onFiles, accept, multiple = true, label = 'Drag files here or click to browse', hint, busy }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}
      role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && ref.current.click()}>
      <Icon name="upload" size={22} />
      <div style={{ marginTop: 6 }}>{busy ? 'Uploading…' : label}</div>
      {hint && <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{hint}</div>}
      <input ref={ref} type="file" hidden multiple={multiple} accept={accept} onChange={(e) => { if (e.target.files.length) onFiles([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}

/**
 * Property/project media manager with drag-to-reorder, cover selection and delete.
 * `base` is e.g. /api/properties/12. Server validates type and size.
 */
export function ImageUploader({ base, media, onChange, kinds = ['gallery'], defaultKind = 'gallery', readOnly }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(defaultKind);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const items = media || [];

  const upload = async (files) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      files.forEach((f) => fd.append('files', f));
      onChange(await api.upload(`${base}/media`, fd));
      toast('Uploaded', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const reorder = async (targetId) => {
    if (!dragId || dragId === targetId) return;
    const ids = items.map((m) => m.id);
    ids.splice(ids.indexOf(targetId), 0, ids.splice(ids.indexOf(dragId), 1)[0]);
    onChange(ids.map((id) => items.find((m) => m.id === id)));
    try { await api.put(`${base}/media-order`, { ids }); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (m) => {
    try { await api.del(`${base}/media/${m.id}`); onChange(items.filter((x) => x.id !== m.id)); } catch (e) { toast(e.message, 'err'); }
  };
  const makeCover = async (m) => {
    try { await api.post(`${base}/media/${m.id}/cover`); onChange(items.map((x) => ({ ...x, kind: x.id === m.id ? 'cover' : x.kind === 'cover' ? 'gallery' : x.kind }))); } catch (e) { toast(e.message, 'err'); }
  };
  const isVid = (p) => /\.(mp4|webm|mov)$/i.test(p);
  return (
    <div>
      {!readOnly && (
        <>
          <div className="upload-opts" style={{ marginBottom: 8 }}>
            <span className="muted">Upload as</span>
            <select className="select upload-cat" value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <FileUploader onFiles={upload} busy={busy} accept="image/*,video/*,application/pdf" label="Drag photos, plans or videos here, or click to browse" hint="JPG, PNG, WebP, MP4 — up to 50 MB each. Drag thumbnails to reorder; the cover appears first." />
        </>
      )}
      <div className="thumbs">
        {items.map((m) => (
          <div key={m.id} className={`thumb ${overId === m.id ? 'drag-over' : ''}`} draggable={!readOnly}
            onDragStart={() => setDragId(m.id)} onDragOver={(e) => { e.preventDefault(); setOverId(m.id); }} onDragLeave={() => setOverId(null)}
            onDrop={(e) => { e.preventDefault(); setOverId(null); reorder(m.id); }} onDoubleClick={() => !readOnly && m.kind !== 'cover' && makeCover(m)} title={m.caption || ''}>
            {isVid(m.path) ? <video src={fileUrl(m.path)} muted /> : /\.pdf$/i.test(m.path) ? <div className="center-box" style={{ padding: 20 }}><Icon name="file" size={28} /></div> : <img src={fileUrl(m.path)} alt={m.caption || m.kind} loading="lazy" />}
            {m.kind === 'cover' ? <span className="cv">Cover</span> : m.kind !== 'gallery' && <span className="cv" style={{ background: '#475467' }}>{m.kind}</span>}
            {!readOnly && <button type="button" className="x" aria-label="Remove" onClick={() => remove(m)}>×</button>}
          </div>
        ))}
      </div>
      {!items.length && <div className="faint" style={{ marginTop: 8 }}>No images yet. Double-click a thumbnail to make it the cover.</div>}
    </div>
  );
}

const iconFor = (mime = '') => (mime.startsWith('image') ? 'image' : 'file');

/** Centralised document list for any entity (contact, property, project, employee, vendor, receipt, expense, sale). */
export function DocumentsPanel({ entityType, entityId, canEdit = true, categories, portalToggle, portalLabel = 'Share with the customer in their portal' }) {
  const toast = useToast();
  const { list } = useLookups();
  const { data, loading, reload } = useFetch('/api/documents', { entity_type: entityType, entity_id: entityId });
  const [category, setCategory] = useState('Other');
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const { hidden, remove } = useUndoDelete('documents');
  const [preview, setPreview] = useState(null);
  const cats = categories || list('document_category');

  const upload = async (files) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('entity_type', entityType); fd.append('entity_id', entityId); fd.append('category', category);
      if (portalToggle && share) fd.append('portal_visible', '1');
      files.forEach((f) => fd.append('files', f));
      await api.upload('/api/documents', fd);
      toast('Document uploaded', 'ok'); reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      {canEdit && (
        <div className="upload-panel">
          <div className="upload-opts">
            <span className="muted">Category</span>
            <div className="upload-cat"><Select value={category} onChange={setCategory} options={cats} allowEmpty={false} /></div>
            {portalToggle && <label className="row upload-share"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span>{portalLabel}</span></label>}
          </div>
          <FileUploader onFiles={upload} busy={busy} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" hint="PDF, JPG, PNG, DOC/DOCX, XLS/XLSX — up to 25 MB" />
        </div>
      )}
      {loading ? <Loading /> : !data?.filter((d) => !hidden.has(d.id)).length ? <Empty icon="file" title="No documents yet" hint="Attach the CNIC, agreements, invoices or any file that belongs here." /> : (
        <table className="t">
          <thead><tr><th>Name</th><th>Category</th><th>Uploaded</th><th>By</th>{portalToggle && <th>Portal</th>}<th /></tr></thead>
          <tbody>
            {data.filter((d) => !hidden.has(d.id)).map((d) => (
              <tr key={d.id}>
                <td><div className="row"><Icon name={iconFor(d.mime)} size={15} /><a href="#preview" onClick={(e) => { e.preventDefault(); setPreview(d); }}>{d.name}</a></div></td>
                <td>{d.category}</td><td>{dateTime(d.created_at)}</td><td>{d.uploaded_by_name || '—'}</td>
                {portalToggle && <td><input type="checkbox" checked={!!d.portal_visible} disabled={!canEdit} onChange={async (e) => { await api.put(`/api/documents/${d.id}`, { portal_visible: e.target.checked }); reload(); }} /></td>}
                <td className="right nowrap">
                  <a className="btn sm" href={`/api/documents/${d.id}/file?download=1`}>Download</a>{' '}
                  {canEdit && <button className="btn sm danger" onClick={() => setDel(d)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {del && <ConfirmDialog danger title="Delete document" message={`Delete "${del.name}"? This cannot be undone.`} confirmLabel="Delete" onCancel={() => setDel(null)}
        onConfirm={async () => { const d = del; setDel(null); remove(d.id, `“${d.name}” deleted`, () => api.del(`/api/documents/${d.id}`), { onDone: reload }); }} />}
      {preview && <DocumentViewer doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export function DocumentViewer({ doc, onClose }) {
  const src = `/api/documents/${doc.id}/file`;
  const img = (doc.mime || '').startsWith('image/');
  const pdf = doc.mime === 'application/pdf';
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={doc.name}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 10, width: 'min(960px, 94vw)', height: '88vh', display: 'flex', flexDirection: 'column', cursor: 'default' }}>
        <div className="modal-h"><h3>{doc.name}</h3><div className="row"><a className="btn sm" href={`${src}?download=1`}>Download</a><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div></div>
        <div style={{ flex: 1, overflow: 'auto', display: 'grid', placeItems: 'center', background: 'var(--grey-bg)' }}>
          {img ? <img src={src} alt={doc.name} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : pdf ? <iframe title={doc.name} src={src} style={{ width: '100%', height: '100%', border: 0 }} /> : <div className="empty">Preview is not available for this file type. Use Download to open it.</div>}
        </div>
      </div>
    </div>
  );
}
