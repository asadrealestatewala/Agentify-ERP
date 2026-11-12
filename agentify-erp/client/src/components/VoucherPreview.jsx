import { DocFooter, DocHeader, useBrand } from './DocBrand.jsx';
import { useMeta } from '../context.jsx';
import { date, money, getRegion } from '../format.js';

/** Paper-style rows: label left, value right. Empty values are skipped, as on the printed voucher. */
function Rows({ items }) {
  const rows = items.filter(Boolean).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== '—');
  return (
    <div className="vp-rows">
      {rows.map(([l, v]) => <div key={l} className="vp-row"><span>{l}</span><b>{v}</b></div>)}
    </div>
  );
}
const Todo = ({ children }) => <span className="vp-todo">{children}</span>;

function Sheet({ title, children }) {
  return (
    <div className="vp-wrap" aria-label={`${title} preview`}>
      <div className="vp-tag">Live preview — updates as you type</div>
      <div className="vp">{children}</div>
    </div>
  );
}

/** Receipt voucher exactly as it will print — filled in from the form while the user works. */
export function ReceiptPreview({ p, customer, sale, record, bundleParts, shares, amount, allocations, account, receiver, isRefund, advance }) {
  const rec = record || {};
  const { meta } = useMeta();
  const co = meta?.settings || {};
  const title = isRefund ? 'REFUND VOUCHER' : (co.receipt_title || 'RECEIPT VOUCHER');
  const subject = bundleParts?.length > 1 ? bundleParts.map((x) => x.title).join(' + ') : sale ? (sale.property_title || sale.title) : '';
  return (
    <Sheet title="Receipt">
      <DocHeader kind="receipt" title={title} number={<Todo>Number assigned on save</Todo>} />
      <Rows items={[
        ['Date', p.date ? date(p.date) : ''],
        ['Received from', customer ? `${customer.full_name}${customer.customer_code ? `  (${customer.customer_code})` : ''}` : <Todo>Select a customer</Todo>],
        [`${getRegion().idLabel} no.`, customer?.cnic || rec.cnic], ['Contact no.', customer?.phone || rec.phone], ['Email', customer?.email || rec.email],
        ['Registration no.', rec.registration_no], ['File #', rec.file_no], ['File status', rec.file_status], ['Type', rec.property_type], ['Plot size', rec.plot_size],
        ['Booking date', rec.booking_date ? date(rec.booking_date) : ''], ['Address', rec.address],
        ['Property / contract', subject || (customer ? 'Customer advance (no sale)' : '')],
        ['Project', sale?.project_name || rec.project_name],
        ['Payment type', p.payment_type], ['Method', p.method], ['Deposited to', account?.name],
        ['Reference', p.reference_no], ['Transaction ID', p.txn_id], ['Cheque no.', p.cheque_no], ['Bank / channel', p.bank], ['Sender', p.sender],
        ['Received by', receiver?.name],
      ]} />
      <div className="vp-amount"><small>Amount {isRefund ? 'refunded' : 'received'}</small><b>{amount ? money(amount) : <Todo>Enter the amount</Todo>}</b>{advance > 0 && <small>Includes {money(advance)} advance</small>}</div>
      {bundleParts?.length > 1 && (
        <><div className="vp-h">Split between</div>
          <table className="vp-t"><tbody>{bundleParts.map((x) => <tr key={x.id}><td>{x.kind === 'construction' ? 'Construction' : 'Plot'} — {x.title}</td><td className="r">{money(Number(shares?.[x.id]) || 0)}</td></tr>)}</tbody></table></>
      )}
      {allocations?.length > 0 && (
        <><div className="vp-h">Applied to installments</div>
          <table className="vp-t"><tbody>{allocations.map((i) => <tr key={i.id}><td>#{i.seq} {i.kind} · due {date(i.due_date)}</td><td className="r">{money(i.take)}</td></tr>)}</tbody></table></>
      )}
      {p.notes && <p className="vp-note"><b>Notes:</b> {p.notes}</p>}
      {co.receipt_terms && <p className="vp-note muted">Terms: {co.receipt_terms}</p>}
      <div className="vp-qr"><span aria-hidden="true">▦</span><div><b>QR code</b> — created automatically when this receipt is saved, printed or downloaded. It carries the customer’s ledger summary (installments, paid, remaining) and a link to the customer portal.</div></div>
      <div className="vp-sign"><span>Received by</span><span>Customer signature</span></div>
      <DocFooter kind="receipt" />
    </Sheet>
  );
}

/** Expense voucher preview. */
export function ExpensePreview({ f, project, contract, vendor, account, paidFrom, total, creator, assetUnits }) {
  const { meta } = useMeta();
  const co = meta?.settings || {};
  const qty = Number(f.quantity) || 0;
  return (
    <Sheet title="Expense voucher">
      <DocHeader kind="expense" title={co.expense_title || 'EXPENSE VOUCHER'} number={<Todo>Number assigned on save</Todo>} />
      <Rows items={[
        ['Date', f.date ? date(f.date) : ''], ['Project', project?.name || (f.project_id ? '' : 'Company expense')], ['Contract', contract ? `${contract.sale_no} — ${contract.customer_name || contract.title || ''}` : ''],
        ['Vendor', vendor?.name], ['Vendor no.', vendor?.vendor_code], ['Vendor contact no.', vendor?.phone], ['Vendor email', vendor?.email], ['Expense account', account ? `${account.code} ${account.name}` : <Todo>Choose an expense account</Todo>], ['Description', f.description],
        ['Quantity × unit cost', f.unit_cost && f.amount === '' ? `${qty.toLocaleString('en-PK')} × ${money(Number(f.unit_cost))}` : ''],
        ['Payment method', f.payment_method], f.show_paid_from ? ['Paid from', paidFrom?.name] : null, assetUnits ? ['Asset record', `${assetUnits} asset(s) will be added to the Asset Library`] : null, ['Reference', f.reference_no],
        ['Credit purchase', f.is_credit ? `Yes${f.due_date ? ` — due ${date(f.due_date)}` : ''}` : (f.due_date ? `Due ${date(f.due_date)}` : '')], ['Created by', creator?.name],
      ]} />
      <div className="vp-amount"><small>Total amount</small><b>{total ? money(total) : <Todo>Enter quantity and cost, or a total</Todo>}</b></div>
      {f.notes && <p className="vp-note"><b>Notes:</b> {f.notes}</p>}
      {co.expense_footer && <p className="vp-note muted">{co.expense_footer}</p>}
      <div className="vp-sign"><span>Prepared by</span><span>Approved by</span><span>Received by</span></div>
      <DocFooter kind="expense" />
    </Sheet>
  );
}
export { useBrand };
