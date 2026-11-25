// Allotment Letters screen (housing societies / developers): every letter issued, its verification scans, bulk issue for a
// project or block, and one combined PDF of the letters in force for printing.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date, dateTime, todayPK } from '../format.js';
import Icon from '../components/Icon.jsx';
import { Card, Field, Loading, Modal, PageHead, StatusBadge } from '../components/ui.jsx';
import { PageOptions, ScanLog } from '../components/AllotmentLetters.jsx';

function BulkIssue({ projects, blocks, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ project_id: projects[0]?.id || '', block: '', issue_date: todayPK(), include_urdu: 1, include_map: 1, include_plan: 1 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const { data } = useFetch(f.project_id ? '/api/allotment-letters/bulk' : null, { project_id: f.project_id, block: f.block || undefined });
  const rows = data?.rows || [];
  const todo = rows.filter((r) => !r.letter_no);
  const noAddress = todo.filter((r) => !r.has_address).length;
  const blockOpts = blocks.filter((b) => String(b.project_id) === String(f.project_id)).map((b) => b.block);
  const go = async () => {
    setBusy(true);
    try { const r = await api.post('/api/allotment-letters/bulk', f); setResult(r); toast(`${r.issued.length} letter(s) issued`, 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Issue letters for a whole block" size="lg" onClose={onClose}
      footer={result ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !todo.length} onClick={go}>{busy ? 'Issuing…' : `Issue ${todo.length} letter(s)`}</button></>}>
      {result ? (
        <div className="stack">
          <div className="alert ok">{result.issued.length} letter(s) issued. Use Print block to download them as one PDF.</div>
          {result.skipped.length > 0 && <><b>Not issued ({result.skipped.length})</b>
            <table className="t"><thead><tr><th>Sale</th><th>Plot</th><th>Customer</th><th>Why</th></tr></thead>
              <tbody>{result.skipped.map((x) => <tr key={x.sale_id}><td><Link to={`/sales/${x.sale_id}?tab=allotment`}>{x.sale_no}</Link></td><td>{x.plot_no}</td><td>{x.customer_name}</td><td>{x.reason}</td></tr>)}</tbody></table></>}
        </div>
      ) : (
        <div className="stack">
          <div className="form-grid">
            <Field label="Project" required><select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value, block: '' })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Block"><select className="input" value={f.block} onChange={(e) => setF({ ...f, block: e.target.value })}><option value="">All blocks</option>{blockOpts.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
            <Field label="Date of issue"><input className="input" type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
          </div>
          <PageOptions value={f} onChange={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
          <div className="muted" style={{ fontSize: 13 }}>
            {data ? `${rows.length} sold plot(s) here: ${rows.length - todo.length} already have a letter, ${todo.length} will get one.` : 'Loading sold plots…'}
            {noAddress > 0 && ` ${noAddress} customer(s) have no residential address on file and will be skipped; add their address first.`}
            {' '}Each letter is filled from the customer, plot and project records exactly as they are now.
          </div>
          {todo.length > 0 && <div style={{ maxHeight: 260, overflow: 'auto' }}><table className="t"><thead><tr><th>Plot</th><th>Block</th><th>Customer</th><th>Address on file</th></tr></thead>
            <tbody>{todo.map((r) => <tr key={r.sale_id}><td>{r.plot_no}</td><td>{r.block}</td><td>{r.customer_name}</td><td>{r.has_address ? 'Yes' : <span className="warn">Missing</span>}</td></tr>)}</tbody></table></div>}
        </div>
      )}
    </Modal>
  );
}

export default function AllotmentRegister() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState({ project_id: '', block: '', status: '', q: '' });
  const { data, error, reload } = useFetch('/api/allotment-letters', { project_id: q.project_id || undefined, block: q.block || undefined, status: q.status || undefined, q: q.q || undefined });
  const [bulk, setBulk] = useState(false);
  const [log, setLog] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const blockOpts = data.blocks.filter((b) => !q.project_id || String(b.project_id) === String(q.project_id)).map((b) => b.block).filter((b, i, a) => a.indexOf(b) === i);
  const printBlock = () => download('/api/allotment-letters/bulk.pdf', { project_id: q.project_id, block: q.block || undefined }, `allotment-letters${q.block ? `-block-${q.block}` : ''}.pdf`).catch((e) => toast(e.message, 'err'));
  const scans = data.rows.reduce((a, l) => a + (l.scans || 0), 0);
  return (
    <div>
      <PageHead title="Allotment Letters" sub={`${data.rows.length} letter(s) · ${scans} verification scan(s)`}>
        {q.project_id && <button className="btn" onClick={printBlock}><Icon name="print" size={14} />Print {q.block ? `block ${q.block}` : 'project'}</button>}
        {can('sales', 'edit') && data.projects.length > 0 && <button className="btn primary" data-tour="allotment-bulk" onClick={() => setBulk(true)}><Icon name="plus" size={14} />Issue for a block</button>}
      </PageHead>
      <Card>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <select className="input" style={{ maxWidth: 220 }} value={q.project_id} onChange={(e) => setQ({ ...q, project_id: e.target.value, block: '' })} aria-label="Project"><option value="">All projects</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="input" style={{ maxWidth: 140 }} value={q.block} onChange={(e) => setQ({ ...q, block: e.target.value })} aria-label="Block"><option value="">All blocks</option>{blockOpts.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <select className="input" style={{ maxWidth: 160 }} value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })} aria-label="Status"><option value="">Any status</option><option value="issued">In force</option><option value="cancelled">Cancelled</option></select>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Search letter, customer, plot" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} aria-label="Search" />
        </div>
        {data.rows.length ? (
          <div className="table-wrap"><table className="t"><thead><tr><th>Letter</th><th>Issued</th><th>Allottee</th><th>Plot</th><th>Project</th><th>Status</th><th>Scans</th><th>Last scanned</th><th /></tr></thead>
            <tbody>{data.rows.map((l) => (
              <tr key={l.id}>
                <td className="mono nowrap">{l.letter_no}</td><td className="nowrap">{date(l.issue_date)}</td><td>{l.customer_name}</td>
                <td>{[l.plot_no && `Plot ${l.plot_no}`, l.block && `Block ${l.block}`].filter(Boolean).join(', ')}</td><td>{l.project_name}</td>
                <td><StatusBadge status={l.status === 'issued' ? 'active' : 'cancelled'} label={l.status === 'issued' ? 'In force' : 'Cancelled'} /></td>
                <td><button className="btn sm ghost" onClick={() => setLog(l)}>{l.scans || 0}</button></td>
                <td>{l.last_scanned_at ? dateTime(l.last_scanned_at) : '—'}</td>
                <td className="nowrap" style={{ textAlign: 'right' }}>
                  <button className="btn sm" onClick={() => download(`/api/allotment-letters/${l.id}/pdf`, {}, `allotment-letter-${l.letter_no}.pdf`).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={13} />PDF</button>{' '}
                  <Link className="btn sm" to={`/sales/${l.sale_id}?tab=allotment`}>Sale</Link>
                </td>
              </tr>
            ))}</tbody></table></div>
        ) : <div className="muted">No allotment letters yet. Open a sold plot's sale and choose Allotment letter, or use Issue for a block.</div>}
      </Card>
      {bulk && <BulkIssue projects={data.projects} blocks={data.blocks} onClose={() => setBulk(false)} onDone={reload} />}
      {log && <ScanLog letter={log} onClose={() => setLog(null)} />}
    </div>
  );
}
