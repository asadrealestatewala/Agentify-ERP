// Allotment letters on a plot sale: issue (prefilled from the customer, plot and project), download the PDF with its QR code,
// copy the public verification link, cancel. Issuing again replaces the letter in force.
import { useState } from 'react';
import { api, download } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date, dateTime } from '../format.js';
import Icon from './Icon.jsx';
import { Check, ConfirmDialog, Field, Loading, Modal, StatusBadge } from './ui.jsx';

const FIELDS = ['issue_date', 'customer_name', 'relation', 'customer_address', 'plot_no', 'block', 'project_name', 'plot_location', 'property_type', 'dimensions', 'area_size', 'area_unit', 'note', 'include_urdu', 'include_map', 'include_plan'];

function IssueForm({ draft, hasLetter, saleId, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, draft[k] ?? ''])));
  const [saveAddress, setSaveAddress] = useState(!draft.customer_address);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const inp = (k, p = {}) => <input className="input" value={f[k]} onChange={set(k)} {...p} />;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/sales/${saleId}/allotment`, { ...f, area_size: f.area_size === '' ? null : f.area_size, save_address: saveAddress && !draft.customer_address });
      toast(r.replaced ? `${r.letter_no} issued; the earlier letter is now cancelled` : `${r.letter_no} issued`, 'ok');
      onDone(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={hasLetter ? 'Issue a new allotment letter' : 'Issue allotment letter'} size="lg" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Issuing…' : 'Issue letter'}</button></>}>
      <div className="stack">
        {hasLetter && <div className="alert warn">Issuing a new letter cancels the one in force. Its QR code will then show "not valid".</div>}
        <div className="muted" style={{ fontSize: 12.5 }}>Filled from the customer, plot and project records. Correct anything here; the letter keeps exactly what you issue.</div>
        <div className="form-grid">
          <Field label="Date of issue" required><input className="input" type="date" value={f.issue_date} onChange={set('issue_date')} /></Field>
          <Field label="Customer name" required>{inp('customer_name')}</Field>
          <Field label="Son / daughter / wife of" hint="e.g. S/O Gul Badshah">{inp('relation')}</Field>
          <Field label="Residential address" required className="full">
            <textarea className="textarea" rows={2} value={f.customer_address} onChange={set('customer_address')} placeholder="House, street, town, district" />
            {!draft.customer_address && <Check checked={saveAddress} onChange={setSaveAddress}>Also save this address on the customer record</Check>}
          </Field>
          <Field label="Plot no." required>{inp('plot_no')}</Field>
          <Field label="Block">{inp('block')}</Field>
          <Field label="Project / society">{inp('project_name')}</Field>
          <Field label="Type">{inp('property_type', { placeholder: 'Residential plot' })}</Field>
          <Field label="Plot location" required className="full" hint="As it should read on the letter, e.g. University City, Chakri Road, Rawalpindi">{inp('plot_location')}</Field>
          <Field label="Dimensions" hint="e.g. 25x45">{inp('dimensions', { placeholder: '25x45' })}</Field>
          <Field label="Area"><div className="row" style={{ gap: 6 }}><input className="input" type="number" min="0" step="any" value={f.area_size} onChange={set('area_size')} style={{ flex: 2 }} /><input className="input" value={f.area_unit} onChange={set('area_unit')} placeholder="Unit" style={{ flex: 1 }} /></div></Field>
          <Field label="Extra note on the letter" className="full"><textarea className="textarea" rows={2} value={f.note} onChange={set('note')} placeholder="Optional, e.g. Duplicate issued on request" /></Field>
        </div>
        <PageOptions value={f} onChange={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
        {err && <div className="alert err">{err}</div>}
      </div>
    </Modal>
  );
}

/** Which extra pages a letter carries. Shared by the single and the bulk issue forms. */
export function PageOptions({ value, onChange }) {
  const on = (k) => Number(value[k]) !== 0 && value[k] !== false;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <b style={{ fontSize: 13 }}>Pages in the letter</b>
      <Check checked={on('include_urdu')} onChange={(v) => onChange('include_urdu', v ? 1 : 0)}>Urdu page with the same details</Check>
      <Check checked={on('include_map')} onChange={(v) => onChange('include_map', v ? 1 : 0)}>Plot position (the project's Site Plan image, or the block layout with this plot marked)</Check>
      <Check checked={on('include_plan')} onChange={(v) => onChange('include_plan', v ? 1 : 0)}>Payment plan summary (never shown on the public verification page)</Check>
    </div>
  );
}

/** Verification log of one letter: each time its QR page was opened. */
export function ScanLog({ letter, onClose }) {
  const { data, error } = useFetch(`/api/allotment-letters/${letter.id}/scans`);
  return (
    <Modal title={`Verification log · ${letter.letter_no}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? <div className="alert err">{error}</div> : !data ? <Loading rows={3} /> : data.rows.length ? (
        <table className="t"><thead><tr><th>When</th><th>Device</th><th>Page showed</th></tr></thead>
          <tbody>{data.rows.map((r, i) => <tr key={i}><td>{dateTime(r.scanned_at)}</td><td>{r.device}</td><td><StatusBadge status={r.result === 'valid' ? 'active' : 'cancelled'} label={r.result === 'valid' ? 'Genuine' : 'Not valid'} /></td></tr>)}</tbody></table>
      ) : <div className="muted">Nobody has scanned this letter's QR code yet.</div>}
      <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>Only the time, device type and result are kept. No location or personal details of the person scanning.</div>
    </Modal>
  );
}

export default function AllotmentLetters({ sale }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch(`/api/sales/${sale.id}/allotment`);
  const [issuing, setIssuing] = useState(false);
  const [cancel, setCancel] = useState(null);
  const [log, setLog] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading rows={2} />;
  const live = data.letters.find((l) => l.status === 'issued');
  const canIssue = can('sales', 'edit') && sale.status === 'confirmed' && data.draft.has_property;
  const pdf = (l) => download(`/api/allotment-letters/${l.id}/pdf`, {}, `allotment-letter-${l.letter_no}.pdf`).catch((e) => toast(e.message, 'err'));
  const copy = async (l) => { try { await navigator.clipboard.writeText(l.verify_url); toast('Verification link copied', 'ok'); } catch { window.prompt('Verification link', l.verify_url); } };
  return (
    <div className="stack" data-tour="sale-allotment">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="muted" style={{ fontSize: 13, maxWidth: 620 }}>
          The allotment letter is printed on your letterhead with a QR code. Scanning it opens a page on your own portal address that confirms the letter is genuine and shows the plot details (never CNIC, phone or payments).
        </div>
        {canIssue && <button className="btn primary" onClick={() => setIssuing(true)}><Icon name="plus" size={14} />{live ? 'Issue new letter' : 'Issue allotment letter'}</button>}
      </div>
      {!data.draft.has_property && <div className="alert warn">This sale has no plot attached, so no allotment letter can be issued.</div>}
      {data.letters.length ? (
        <div className="table-wrap"><table className="t"><thead><tr><th>Letter</th><th>Issued</th><th>Allottee</th><th>Plot</th><th>Status</th><th>Scans</th><th /></tr></thead>
          <tbody>{data.letters.map((l) => (
            <tr key={l.id}>
              <td className="mono nowrap">{l.letter_no}</td><td className="nowrap">{date(l.issue_date)}</td><td>{l.customer_name}</td>
              <td>{[l.plot_no && `Plot ${l.plot_no}`, l.block && `Block ${l.block}`].filter(Boolean).join(', ')}</td>
              <td><StatusBadge status={l.status === 'issued' ? 'active' : 'cancelled'} label={l.status === 'issued' ? 'In force' : 'Cancelled'} />{l.cancel_reason && <div className="faint" style={{ fontSize: 11.5 }}>{l.cancel_reason}</div>}</td>
              <td><button className="btn sm ghost" onClick={() => setLog(l)}>{l.scans || 0}</button></td>
              <td className="nowrap" style={{ textAlign: 'right' }}>
                <button className="btn sm" onClick={() => pdf(l)}><Icon name="download" size={13} />PDF</button>{' '}
                {l.status === 'issued' && <button className="btn sm" onClick={() => copy(l)}>Copy verify link</button>}{' '}
                {l.status === 'issued' && can('sales', 'edit') && <button className="btn sm danger" onClick={() => setCancel(l)}>Cancel</button>}
              </td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="muted">No allotment letter issued yet.</div>}
      {log && <ScanLog letter={log} onClose={() => setLog(null)} />}
      {issuing && <IssueForm draft={data.draft} hasLetter={!!live} saleId={sale.id} onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); reload(); }} />}
      {cancel && <ConfirmDialog danger reason title={`Cancel ${cancel.letter_no}`} confirmLabel="Cancel letter" message="Its QR code will show that the letter is not valid. This cannot be undone; issue a new letter if needed."
        onCancel={() => setCancel(null)} onConfirm={async (reason) => { try { await api.post(`/api/allotment-letters/${cancel.id}/cancel`, { reason }); toast('Letter cancelled', 'ok'); } catch (e) { toast(e.message, 'err'); } setCancel(null); reload(); }} />}
    </div>
  );
}
