// Shared library for a workspace: wording kept by Agentify (contract templates, clauses, brochure layouts, email templates).
// Items are read-only; "Use my own version" saves this workspace's text, which only this workspace sees.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Modal } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

export default function SharedLibrary() {
  const toast = useToast();
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // { item, text, editing }
  const load = useCallback(() => api.get('/api/library').then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <ErrorBox error={err} />;
  if (!d || !d.items.length) return null;
  const canEdit = can('settings', 'edit');
  const own = async () => {
    try { await api.put(`/api/library/${open.item.id}/override`, { content: open.text }); toast('Saved. This workspace now uses its own version.'); setOpen(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const back = async (item) => {
    if (!window.confirm('Go back to the shared version? Your own text for this item will be removed.')) return;
    try { await api.del(`/api/library/${item.id}/override`); toast('Using the shared version again'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div style={{ marginTop: 20 }}>
      <Card title="Shared library" flush>
        <p className="muted" style={{ margin: '12px 16px 0', fontSize: 13 }}>Ready-made wording kept up to date for every workspace. It is a starting point: have contracts and clauses reviewed by a licensed professional before use. You can keep your own version of any item; only your workspace sees it.</p>
        <div className="table-wrap"><table className="t"><thead><tr><th>Item</th><th>Kind</th><th>Version</th><th /></tr></thead><tbody>
          {d.items.map((i) => (
            <tr key={i.id}>
              <td><b>{i.title}</b>{i.overridden && <span className="pill blue" style={{ marginLeft: 6 }}>Your version</span>}{i.shared_changed && <span className="pill amber" style={{ marginLeft: 6 }}>Shared text updated</span>}</td>
              <td>{i.type_label}</td><td>v{i.version}</td>
              <td className="right nowrap">
                <button className="btn sm" onClick={() => setOpen({ item: i, text: i.content, editing: false })}>View</button>
                {canEdit && !i.overridden && <> <button className="btn sm" onClick={() => setOpen({ item: i, text: i.content, editing: true })}>Use my own version</button></>}
                {canEdit && i.overridden && <> <button className="btn sm" onClick={() => setOpen({ item: i, text: i.content, editing: true })}>Edit mine</button> <button className="btn sm" onClick={() => back(i)}>Use the shared version</button></>}
              </td>
            </tr>))}
        </tbody></table></div>
      </Card>
      {open && (
        <Modal title={open.item.title} size="lg" onClose={() => setOpen(null)}
          footer={open.editing ? <><button className="btn" onClick={() => setOpen(null)}>Cancel</button><button className="btn primary" onClick={own}>Save my version</button></> : <button className="btn" onClick={() => setOpen(null)}>Close</button>}>
          {open.item.shared_changed && <div className="alert info">The shared text was updated after you made your own version. Open the shared text below to compare.</div>}
          {open.editing
            ? <textarea className="input mono" rows={14} value={open.text} onChange={(e) => setOpen({ ...open, text: e.target.value })} aria-label="Your version" />
            : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{open.text}</pre>}
          {open.editing && open.item.shared_changed && <details style={{ marginTop: 12 }}><summary>Current shared text</summary><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{open.item.shared_content}</pre></details>}
        </Modal>)}
    </div>
  );
}
