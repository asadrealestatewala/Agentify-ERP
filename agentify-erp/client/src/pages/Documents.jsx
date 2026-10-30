// Document templates: list, edit (each save is a new version) and preview with sample values.
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import SharedLibrary from '../components/SharedLibrary.jsx';

const KIND_LABEL = { offer: 'Offer', agency_agreement: 'Agency agreement', receipt_note: 'Receipt note', disclosure: 'Disclosure', letter: 'Letter' };
const SAMPLE = { company: { name: 'Your Company' }, client: { name: 'Sample Client' }, buyer: { name: 'Sample Buyer' }, seller: { name: 'Sample Seller' }, property: { title: 'Sample Property', address: '1 Example Street' }, price: 25000000, deposit: 500000, amount: 120000, method: 'Bank transfer', reference: 'REF-1', commission_percent: 2, closing_date: '2027-01-15', start_date: '2026-11-01', end_date: '2027-05-01', subject: 'Hello' };

export default function Documents() {
  const toast = useToast();
  const { can } = useAuth();
  const [list, setList] = useState(null);
  const [vars, setVars] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [preview, setPreview] = useState(null);
  const load = useCallback(() => api.get('/api/documents/templates').then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); api.get('/api/documents/variables').then(setVars).catch(() => {}); }, [load]);
  const open = async (t) => setEdit(t ? await api.get(`/api/documents/templates/${t.id}`) : { kind: 'letter', name: '', body: '' });
  const save = async () => {
    try { if (edit.id) await api.put(`/api/documents/templates/${edit.id}`, { body: edit.body }); else await api.post('/api/documents/templates', edit); toast('Saved as a new version'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const show = async (t) => { try { setPreview({ t, ...(await api.post(`/api/documents/templates/${t.id}/render`, { context: SAMPLE })) }); } catch (e) { toast(e.message, 'err'); } };
  const canEdit = can('settings', 'edit');
  return (
    <>
      <PageHead title="Document templates" sub="Wording for offers, agreements and letters. Each edit creates a new version. Starter wording is a sample only: have it reviewed by a licensed professional before use.">
        {canEdit && <button className="btn primary sm" onClick={() => open(null)}>New template</button>}
      </PageHead>
      <ErrorBox error={err} />
      {!list ? (!err && <Loading />) : !list.length ? <Empty title="No templates yet" /> : (
        <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>Template</th><th>Kind</th><th>Version</th><th>Review</th><th /></tr></thead><tbody>
          {list.map((t) => <tr key={t.id}><td><b>{t.name}</b></td><td>{KIND_LABEL[t.kind] || t.kind}</td><td>v{t.version}</td><td>{t.needs_legal_review ? 'Needs review' : 'Reviewed'}</td>
            <td className="right nowrap"><button className="btn sm" onClick={() => show(t)}>Preview</button>{canEdit && <> <button className="btn sm" onClick={() => open(t)}>Edit</button></>}</td></tr>)}
        </tbody></table></div></Card>)}
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'New template'} size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          {!edit.id && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Kind"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{(vars?.kinds || Object.keys(KIND_LABEL)).map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}</select></Field>
          </div>}
          <Field label="Text" hint={`Placeholders you can use: ${(vars?.variables?.[edit.kind] || []).map((v) => `{{${v}}}`).join(' ')}. Add |money or |date to format.`}>
            <textarea className="input mono" rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </Field>
        </Modal>)}
      {preview && (
        <Modal title={`Preview: ${preview.t.name}`} size="lg" onClose={() => setPreview(null)} footer={<button className="btn" onClick={() => setPreview(null)}>Close</button>}>
          {preview.notice && <div className="alert info">{preview.notice}</div>}
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{preview.text}</pre>
          {preview.missing.length > 0 && <div className="muted">Values still needed: {preview.missing.join(', ')}</div>}
        </Modal>)}
      <SharedLibrary />
    </>
  );
}
