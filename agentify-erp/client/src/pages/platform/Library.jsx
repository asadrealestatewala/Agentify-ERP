// Shared template library: wording kept once for the whole platform. Every workspace reads the active items; a workspace may
// replace an item with its own text, which only that workspace sees. This page edits the shared items and shows who replaced what.
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, Modal, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const when = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleDateString() : '—');

function ItemModal({ item, types, onClose, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ type: item?.type || 'clause', title: item?.title || '', content: item?.content || '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { if (item) await api.put(`${A}/library/${item.id}`, f); else await api.post(`${A}/library`, f); toast(item ? 'Saved as a new version' : 'Item added'); reload(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? `Edit ${item.title}` : 'Add a library item'} size="lg" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{item ? 'Save new version' : 'Add item'}</button></>}>
      <ErrorBox error={err} />
      <div className="pa-grid2">
        <Field label="Kind"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Title" required><TextInput value={f.title} onChange={(v) => setF({ ...f, title: v })} maxLength={140} /></Field>
      </div>
      <Field label="Text" required hint={item ? 'Saving changes the wording for every workspace that has not replaced this item. Workspaces that did are told the shared text has moved on.' : 'Plain text. Workspaces see it read-only unless they choose to use their own version.'}>
        <textarea className="input mono" rows={14} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
      </Field>
    </Modal>
  );
}

export default function LibraryPage() {
  const toast = useToast();
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`${A}/library`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const flip = async (i) => { try { await api.post(`${A}/library/${i.id}/${i.status === 'active' ? 'retire' : 'reinstate'}`); toast(i.status === 'active' ? 'Retired: workspaces no longer see it' : 'Back in the library'); load(); } catch (e) { toast(e.message, 'err'); } };
  if (err && !d) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  return (
    <>
      <PageTitle title="Template library" sub="Contract templates, clauses, brochure layouts and email templates that every workspace can read. A workspace can use its own version of any item.">
        <button className="btn primary" onClick={() => setOpen('new')}>Add an item</button>
      </PageTitle>
      <ErrorBox error={err} />
      <p className="muted" style={{ fontSize: 13 }}>Items appear read-only in each workspace under Documents &gt; Shared library. Wording here is a starting point: have contracts and clauses reviewed by a licensed professional for each country before use.</p>
      {!d.items.length ? <Empty title="The library is empty" hint="Add the first item to give every workspace something to start from." /> : (
        <Card flush><div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th>Kind</th><th className="num">Version</th><th className="num">Own versions</th><th>Updated</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((i) => (
            <tr key={i.id}><td><b>{i.title}</b></td><td>{d.types[i.type]}</td><td className="num">v{i.version}</td><td className="num">{i.overrides}</td><td>{when(i.updated_at)}</td>
              <td>{i.status === 'active' ? <span className="pill green">Active</span> : <span className="pill grey">Retired</span>}</td>
              <td className="right nowrap"><button className="btn sm" onClick={() => setOpen(i)}>Edit</button> <button className="btn sm" onClick={() => flip(i)}>{i.status === 'active' ? 'Retire' : 'Reinstate'}</button></td></tr>))}
        </tbody></table></div></Card>)}
      <Card title="Workspaces using their own version">
        {!d.drift.length ? <p className="muted" style={{ margin: 0 }}>No workspace has replaced a shared item.</p> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th>Workspace</th><th>Their copy is based on</th><th>Shared text now</th><th /></tr></thead><tbody>
            {d.drift.map((r) => (
              <tr key={`${r.item_id}-${r.tenant_id}`}><td>{r.title}{r.status === 'retired' && <span className="pill grey" style={{ marginLeft: 6 }}>retired</span>}</td><td>{r.workspace} <span className="muted">{r.slug}</span></td><td>v{r.base_version}</td><td>v{r.version}</td>
                <td>{r.behind ? <span className="pill amber">Shared text has moved on</span> : <span className="pill green">Up to date</span>}</td></tr>))}
          </tbody></table></div>)}
      </Card>
      {open && <ItemModal item={open === 'new' ? null : open} types={d.types} onClose={() => setOpen(null)} reload={load} />}
    </>
  );
}
