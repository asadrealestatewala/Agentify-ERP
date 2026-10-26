// Super Admin console: Billing mail. The billing@ sender, whether its inbox exists in the Mailbox, and the receipts sent for payments.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Loading, StatusBadge } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, useCan } from './AdminShell.jsx';

const TONE = { sent: ['green', 'Sent'], failed: ['red', 'Not sent'], pending: ['amber', 'Sending'] };

export default function BillingMailPage() {
  const can = useCan();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api.get(`${A}/billing-mail`).then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!d) return <Loading />;
  const createInbox = async () => { setBusy('inbox'); try { await api.post(`${A}/billing-mail/inbox`); toast('Billing inbox created', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const resend = async (id) => { setBusy(`r${id}`); try { const r = await api.post(`${A}/billing-mail/receipts/${id}/resend`); toast(r.sent ? 'Receipt sent' : 'Receipt could not be sent', r.sent ? 'ok' : 'err'); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  return (
    <>
      <Card title="Billing sender and inbox" actions={<StatusBadge tone={d.inbox ? 'green' : 'amber'} label={d.inbox ? 'Inbox ready' : 'Inbox not created'} />}>
        <p style={{ marginTop: 0 }}>Payment receipts and billing notices are sent as <span className="mono">{d.from}</span>. Customers who reply, or write to <span className="mono">{d.address}</span>, land in the billing inbox.</p>
        {d.can_open_mailbox
          ? (d.inbox
            ? <p><Link to="/platform/mailbox">Open the Mailbox</Link> and choose {d.inbox.email} to read and answer billing questions.</p>
            : <>
              <p className="muted">{d.inbox_error || (d.resend_ready ? `There is no ${d.address} inbox at Resend yet.` : 'Save the Resend key under Integrations first.')} The domain must already receive mail at Resend (hello@ and admin@ do).</p>
              <button className="btn primary" disabled={!d.resend_ready || busy === 'inbox'} onClick={createInbox}>Create {d.address} inbox</button>
            </>)
          : <p className="muted">Only the Platform Owner and Super Admin can read the billing inbox.</p>}
      </Card>
      <Card title="Payment receipts">
        {!d.receipts.length ? <Empty>No receipts yet. One is sent for each payment you approve or record, and for each paid card invoice.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Workspace</th><th>Amount</th><th>Reference</th><th>Sent to</th><th>Status</th><th /></tr></thead>
            <tbody>{d.receipts.map((r) => {
              const [tone, label] = TONE[r.status] || ['grey', r.status];
              return <tr key={r.id}>
                <td>{String(r.created_at).slice(0, 16).replace('T', ' ')}</td>
                <td>{r.tenant_name || '—'}</td>
                <td>{r.currency} {Number(r.amount).toLocaleString()}</td>
                <td className="mono">{r.reference}</td>
                <td>{r.to_addr || '—'}</td>
                <td><StatusBadge tone={tone} label={label} />{r.error && <div className="muted" style={{ fontSize: 12 }}>{r.error}</div>}</td>
                <td>{can('billing.manage') && <button className="btn sm" disabled={busy === `r${r.id}`} onClick={() => resend(r.id)}>{r.status === 'sent' ? 'Send again' : 'Retry'}</button>}</td>
              </tr>;
            })}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
