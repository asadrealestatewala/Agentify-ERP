// Settings > Payment gateways: the workspace connects its own merchant accounts so customers can pay from the portal.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Loading, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { money } from '../format.js';

const STATUS_TONE = { paid: 'green', paid_test: 'blue', pending: 'amber', created: 'grey', failed: 'red', mismatch: 'red', needs_review: 'red', posting: 'amber' };
const STATUS_LABEL = { paid: 'Paid', paid_test: 'Test payment (no receipt)', pending: 'Waiting for customer', created: 'Started', failed: 'Failed', mismatch: 'Amount mismatch', needs_review: 'Needs posting', posting: 'Posting' };

function GatewayCard({ g, can, reload }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ mode: g.mode, ...Object.fromEntries(g.fields.map((x) => [x.key, x.value])) }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.mode === 'live' && !window.confirm(`Switch ${g.label} to LIVE? Real customer payments will be posted as receipts.`)) return;
    setBusy(true);
    try { await api.put(`/api/gateways/${g.id}`, f); toast(`${g.label} connected`, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const toggle = async () => { try { await api.post(`/api/gateways/${g.id}/enabled`, { enabled: !g.enabled }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const off = async () => { if (!window.confirm(`Disconnect ${g.label}? Customers can no longer pay with it.`)) return; await api.del(`/api/gateways/${g.id}`); reload(); };
  const connected = g.status === 'connected';
  return (
    <Card title={g.label} actions={connected ? <StatusBadge status="active" label={g.enabled ? `Connected · ${g.mode === 'live' ? 'LIVE' : 'test mode'}` : 'Connected · hidden from customers'} /> : <StatusBadge status="inactive" label={g.available ? 'Not connected' : 'Not built yet'} />}>
      <p className="muted" style={{ marginTop: 0 }}>{g.blurb}</p>
      {!g.available && <div className="alert info">{g.note}</div>}
      {g.available && !g.region_ok && <div className="alert warn">{g.label} is not offered in this workspace's country.</div>}
      {g.available && g.region_ok && !g.currency_ok && <div className="alert warn">{g.label} cannot charge in {g.currency}, so it will not be shown to customers here.</div>}
      {g.available && g.region_ok && (
        <>
          {g.docs && <p style={{ margin: '0 0 8px' }}><a className="btn sm" href={g.docs} target="_blank" rel="noreferrer">Open {g.label} dashboard ↗</a></p>}
          {can && (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
              <Field label="Mode" hint="Test mode never creates receipts. Keep it on until you have made a test payment."><select className="input" value={f.mode} onChange={set('mode')}><option value="test">Test (sandbox)</option><option value="live">Live (real money)</option></select></Field>
              {g.fields.map((x) => <Field key={x.key} label={x.label} hint={x.hint}><input className="input" type={x.secret ? 'password' : 'text'} value={f[x.key] || ''} onChange={set(x.key)} autoComplete="off" /></Field>)}
            </div>)}
          {g.webhook_url && <p className="muted" style={{ fontSize: 12.5 }}>Webhook address to add in {g.label}: <span className="mono">{g.webhook_url}</span></p>}
          {g.last_error && <div className="alert err">{g.last_error}</div>}
          {can && <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? `Checking with ${g.label}…` : connected ? 'Update and test' : 'Save and test'}</button>
            {connected && <button className="btn" onClick={toggle}>{g.enabled ? 'Hide from customers' : 'Show to customers'}</button>}
            {connected && <button className="btn danger" onClick={off}>Disconnect</button>}
          </div>}
        </>)}
    </Card>
  );
}

export default function PaymentGateways() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/gateways');
  const checkouts = useFetch('/api/gateways/checkouts/list');
  const retry = async (id) => { try { await api.post(`/api/gateways/checkouts/${id}/retry`); toast('Posted', 'ok'); checkouts.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="Payment gateways" sub="Connect your own merchant accounts so customers can pay installments online from their portal. Receipts are posted automatically once the provider confirms the payment." />
      <div className="alert info" style={{ marginBottom: 12 }}>Bank accounts and wallet numbers (Easypaisa, JazzCash, bank transfer with a payment slip that your team confirms) are set up in <Link to="/settings/payment-methods">Payment methods</Link> and appear next to the online options.</div>
      {!data ? <Loading /> : <div className="stack">{data.map((g) => <GatewayCard key={g.id} g={g} can={can('settings', 'edit')} reload={reload} />)}</div>}
      <Card title="Online payments" flush>
        {!checkouts.data?.length ? <Empty icon="receipt" title="No online payments yet" hint="Payments started from the customer portal appear here." /> : (
          <table className="t"><thead><tr><th>When</th><th>Customer</th><th>Provider</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>{checkouts.data.map((k) => (
              <tr key={k.id}><td className="nowrap">{k.created_at}</td><td>{k.customer}</td><td>{k.provider_label}{k.sandbox ? <span className="cell-sub">test</span> : null}</td><td className="num mono">{money(k.amount)}</td>
                <td><StatusBadge status={k.status} tone={STATUS_TONE[k.status]} label={STATUS_LABEL[k.status] || k.status} />{k.error && <div className="cell-sub">{k.error}</div>}</td>
                <td className="right">{k.status === 'needs_review' && can('payments', 'create') && <button className="btn sm" onClick={() => retry(k.id)}>Retry posting</button>}</td></tr>))}</tbody></table>)}
      </Card>
    </div>
  );
}
