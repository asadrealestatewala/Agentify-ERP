import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Empty, Field, Loading, Modal, PageHead, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const fmtMoney = (amount, currency) => new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
const price = (p, currency, interval) => {
  const cur = p.price[currency] ? currency : p.price.PKR ? 'PKR' : 'USD';
  return p.price[cur]?.[interval] == null ? '—' : fmtMoney(p.price[cur][interval], cur);
};
const PRODUCT_LABEL = { real_estate: 'Real Estate Brokerage', construction: 'Construction Management', bundle: 'Real Estate + Construction', website: 'Free website' };
/** A UTC instant shown in the viewer's own timezone. */
const localWhen = (iso) => (iso ? new Date(String(iso).length > 10 ? iso : `${iso}T23:59:59Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Slim bar above every page while the workspace is on trial, past due or read-only. Renders nothing when all is well. */
export function BillingBanner() {
  const { can } = useAuth();
  const { data } = useFetch('/api/billing/status');
  if (!data) return null;
  const manage = can('settings', 'view') ? <> <Link to="/settings/billing"><b>Choose a plan</b></Link></> : ' Ask an admin to choose a plan.';
  if (data.locked) return <div className="alert err no-print" role="alert" style={{ margin: '0 0 12px' }}>{data.message}{manage}</div>;
  if (data.status === 'past_due') return <div className="alert warn no-print" role="alert" style={{ margin: '0 0 12px' }}>Your last payment failed or your renewal is due. Pay by {data.grace_until} to keep editing.{manage}</div>;
  if (data.status === 'canceled') return <div className="alert warn no-print" style={{ margin: '0 0 12px' }}>Your subscription is cancelled and ends on {data.period_end}.{manage}</div>;
  if (data.status === 'trialing' && data.days_left != null && data.days_left <= 7) return <div className="alert info no-print" style={{ margin: '0 0 12px' }}>Your free trial ends {data.days_left === 0 ? 'today' : `in ${data.days_left} day${data.days_left === 1 ? '' : 's'}`} ({localWhen(data.trial_ends_at)}).{manage}</div>;
  return null;
}

/** Shown to a signed-in user whose email address is not confirmed yet. */
export function VerifyBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [sent, setSent] = useState(false);
  if (!user || user.portal || user.email_verified !== false) return null;
  const resend = async () => { try { await api.post('/api/auth/resend-verification'); setSent(true); } catch (e) { toast(e.message, 'err'); } };
  return <div className="alert info no-print" role="status" style={{ margin: '0 0 12px' }}>Please confirm your email address with the link we sent to {user.email}. {sent ? 'Sent again, check your inbox.' : <button className="btn sm" onClick={resend}>Resend the email</button>}</div>;
}

/** The server's price for a purchase (plan + setup fee + add-ons - coupon). Shown before paying; the payment is checked against it. */
function useQuote(body) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body) return undefined;
    let live = true;
    const t = setTimeout(() => api.post('/api/billing/quote', body).then((x) => { if (live) { setQ(x); setErr(''); } }).catch((e) => { if (live) { setQ(null); setErr(e.message); } }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { q, err };
}

function PayModal({ data, plan, interval, onClose, onDone }) {
  const toast = useToast();
  const [method, setMethod] = useState(data.methods[0].id);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const [addons, setAddons] = useState({});
  const [busy, setBusy] = useState(false);
  const m = data.methods.find((x) => x.id === method);
  const p = data.plans.find((x) => x.id === plan);
  const chosen = Object.entries(addons).filter(([, n]) => n > 0).map(([id, quantity]) => ({ id, quantity }));
  const { q, err } = useQuote(m.kind === 'transfer' ? { plan, interval, currency: 'PKR', coupon: coupon.trim() || null, addons: chosen } : { plan, interval, currency: data.currency });
  const pay = async () => {
    setBusy(true);
    try {
      if (m.kind === 'gateway') { const out = await api.post('/api/billing/gateway-checkout', { provider: m.id, plan, interval }); window.location.assign(out.url); return; }
      if (m.kind === 'online') { const out = await api.post('/api/billing/checkout', { plan, interval }); window.location.assign(out.url); return; }
      await api.post('/api/billing/manual-payment', { plan, interval, method, reference, note, coupon: coupon.trim() || null, addons: chosen });
      toast('Payment submitted. We will confirm it shortly.', 'ok'); onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pay for ${p.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (m.kind === 'transfer' && (reference.trim().length < 6 || !q))} onClick={pay}>{busy ? 'Please wait…' : m.kind !== 'transfer' ? 'Continue to secure payment' : 'I have paid'}</button></>}>
      <div className="stack">
        <Field label="Payment method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{data.methods.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        {m.kind === 'transfer' && !!data.addons?.length && (
          <Field label="Add-ons (optional)">
            <div className="stack">{data.addons.map((a) => (
              <label key={a.id} className="row between" style={{ gap: 8 }}><span>{a.name}<span className="muted"> · {a.price.PKR ? fmtMoney(a.price.PKR[interval] || 0, 'PKR') : ''} / {interval === 'month' ? 'mo' : 'yr'}</span></span>
                <input className="input" type="number" min="0" max="50" style={{ width: 70 }} value={addons[a.id] || 0} onChange={(e) => setAddons({ ...addons, [a.id]: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Quantity of ${a.name}`} /></label>
            ))}</div>
          </Field>
        )}
        {m.kind === 'transfer' && <Field label="Coupon code (optional)"><input className="input" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></Field>}
        {err && <div className="alert err">{err}</div>}
        {q && (
          <div className="card" style={{ padding: 12 }}>
            {q.lines.map((l, i) => <div key={i} className="row between"><span>{l.label}</span><span className="mono">{fmtMoney(l.amount, q.currency)}</span></div>)}
            <div className="row between" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}><b>Total now</b><b className="mono">{fmtMoney(q.total, q.currency)}</b></div>
            <div className="muted" style={{ fontSize: 12 }}>Prices include any applicable taxes. The setup fee is charged once.</div>
          </div>
        )}
        {m.kind !== 'transfer' ? <div className="muted">You will pay on a secure page run by our payment provider{m.kind === 'gateway' ? `${m.test_mode ? ' (test mode: no real money, your plan will not change)' : ''}. This pays for one ${interval === 'year' ? 'year' : 'month'}; pay again to renew` : ''}. We never see or store your card number.</div> : q && (
          <>
            <div className="alert info">Send <b>{fmtMoney(q.total, 'PKR')}</b> by {m.label} to <b>{m.account}</b>{m.account_name ? ` (${m.account_name})` : ''}{m.note ? `. ${m.note}` : ''}. Then enter the transaction ID from your receipt. Your plan starts when we confirm the money arrived.</div>
            <Field label="Transaction ID / reference" required><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function CloseAccount({ slug }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  if (!slug) return null;
  const send = async () => { try { const r = await api.post('/api/billing/close-request', f); toast(r.message, 'ok'); setF(null); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Close your account" style={{ marginTop: 16 }}>
      <p className="muted">Export anything you need first (every list and report has Excel/PDF export, and the Super Admin can download the whole database under My Space › Security). We confirm by email before deleting anything; billing records are kept as the law requires.</p>
      {f ? <div className="stack">
        <Field label="Why are you leaving? (optional)"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label={`Type ${slug} to confirm`}><input className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value.trim().toLowerCase() })} /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn danger" disabled={f.confirm !== slug} onClick={send}>Ask to close the account</button><button className="btn" onClick={() => setF(null)}>Cancel</button></div>
      </div> : <button className="btn" onClick={() => setF({ reason: '', confirm: '' })}>Ask to close the account and delete our data</button>}
    </Card>
  );
}

export default function Billing() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/billing');
  const [interval, setInterval] = useState('month');
  const [busy, setBusy] = useState('');
  const [manual, setManual] = useState(null);
  const [paying, setPaying] = useState(null);
  const [sp, setSp] = useSearchParams();
  const gw = sp.get('gw');
  const gwStatus = useFetch(gw ? `/api/billing/gateway-checkout/${gw}` : null);
  useEffect(() => {
    if (!gw || !gwStatus.data || ['paid', 'paid_test', 'failed'].includes(gwStatus.data.status)) { if (gwStatus.data?.status === 'paid') reload(); return undefined; }
    const t = setTimeout(gwStatus.reload, 3000); return () => clearTimeout(t);
  }, [gw, gwStatus.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Loading />;
  // no online or local method configured: ask the server for its instructions (contact us / bank transfer)
  const choose = async (plan) => {
    if (data.methods?.length) return setPaying(plan);
    setBusy(plan);
    try { const out = await api.post('/api/billing/checkout', { plan, interval }); if (out.mode === 'redirect') window.location.assign(out.url); else setManual({ plan, text: out.instructions }); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const openPortal = async () => { try { const out = await api.post('/api/billing/portal'); window.location.assign(out.url); } catch (e) { toast(e.message, 'err'); } };
  const lim = data.limits;
  const u = data.usage;
  const seatsUsed = u.seats + u.invited;
  const statusLabel = { trialing: data.locked ? 'Trial ended' : `Free trial · ${data.days_left} day${data.days_left === 1 ? '' : 's'} left`, pending: 'Waiting for first payment', expired: 'Expired (read-only)', past_due: 'Payment due', canceled: 'Cancelled', suspended: 'Suspended' }[data.status];
  const label = statusLabel ? `${statusLabel}${data.plan && data.status !== 'trialing' ? ` · ${data.plans.find((p) => p.id === data.plan)?.name || data.plan}` : ''}` : lim.name;
  const bar = (used, max) => (max == null ? null : <ProgressBar value={Math.min(100, Math.round((used / max) * 100))} tone={used >= max ? 'red' : used / max > 0.8 ? 'amber' : 'green'} />);
  const usageRow = (name, used, max, unit = '') => <div><div className="row between"><span>{name}</span><span className="muted">{used}{unit}{max != null ? ` of ${max}${unit}` : ' · unlimited'}</span></div>{bar(used, max)}</div>;
  const intervalSaving = data.plans.some((p) => p.price.PKR && p.price.PKR.year < p.price.PKR.month * 12);
  return (
    <div>
      <PageHead title="Plan & billing" sub={`${PRODUCT_LABEL[data.product] || ''} · your plan, usage and invoices`} />
      {sp.get('cancelled') === '1' && <div className="alert warn row between">You cancelled the online payment. Nothing was charged. <button className="btn sm" onClick={() => setSp({}, { replace: true })}>Dismiss</button></div>}
      {gw && gwStatus.data && (() => {
        const st = gwStatus.data.status;
        const [tone, text] = st === 'paid' ? ['ok', 'Payment received. Your plan is active.'] : st === 'paid_test' ? ['info', 'Test payment confirmed. No real money moved and your plan did not change.']
          : st === 'received' ? ['info', 'We received your payment and are activating your plan. This page will update shortly.'] : st === 'failed' ? ['err', 'The online payment could not be confirmed. If money left your account, please contact us.'] : ['info', 'Confirming your payment with the provider. You do not need to pay again.'];
        return <div className={`alert ${tone} row between`}><span>{text}</span><button className="btn sm" onClick={() => setSp({}, { replace: true })}>Dismiss</button></div>;
      })()}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', marginBottom: 16 }}>
        <Card title="Current plan">
          <div className="stack">
            <div className="row between"><b style={{ fontSize: 18 }}>{label}</b><StatusBadge status={data.locked ? 'inactive' : data.status === 'past_due' ? 'pending' : 'active'} /></div>
            {data.status === 'trialing' && data.trial_ends_at && <div className="muted">Trial started {localWhen(data.trial_started_at)} and ends {localWhen(data.trial_ends_at)} (your local time).</div>}
            {data.trial_note && <div className="muted">{data.trial_note}.</div>}
            {data.period_end && <div className="muted">{data.status === 'canceled' ? 'Access until' : data.status === 'expired' ? 'Ended' : 'Paid until'} {data.period_end}</div>}
            {data.status === 'past_due' && <div className="muted">Pay by {data.grace_until} to keep editing.</div>}
            {data.locked && <div className="muted">Your data is safe: you can still sign in, view and export everything. Nothing is deleted.</div>}
            {data.plan === 'legacy' && <div className="muted">This workspace is not metered.</div>}
            <div className="muted">Products: {(data.products || []).map((p) => PRODUCT_LABEL[p]).join(' + ')}</div>
            {data.card_portal && can('settings', 'edit') && <button className="btn sm" onClick={openPortal}>Manage card, plan or cancel</button>}
            {data.payments?.filter((p) => p.status === 'pending').map((p) => <div key={p.id} className="alert info">Payment of PKR {p.amount.toLocaleString('en-PK')} by {data.methods.find((m) => m.id === p.method)?.label || p.method} is waiting for confirmation (ref {p.reference}).</div>)}
          </div>
        </Card>
        <Card title="Usage">
          <div className="stack">
            {usageRow(`Team members${u.invited ? ` (${u.invited} invited)` : ''}`, seatsUsed, lim.seats)}
            {usageRow('Projects', u.projects, lim.projects)}
            {data.products?.includes('real_estate') && usageRow('Properties', u.properties, lim.properties)}
            {usageRow('File storage', u.storage_mb, lim.storage_mb, ' MB')}
            <div className="row between"><span>Website / partner API</span><span className="muted">{lim.api_access ? 'Included' : 'Not included'}</span></div>
            {!!data.my_addons?.filter((a) => a.status === 'active').length && <div className="muted">Add-ons: {data.my_addons.filter((a) => a.status === 'active').map((a) => `${a.name} x ${a.quantity}`).join(', ')}</div>}
          </div>
        </Card>
      </div>
      {data.plan !== 'legacy' && (
        <Card title={`Choose a plan · ${PRODUCT_LABEL[data.product] || ''}`} actions={<div className="row" style={{ gap: 6 }}>{['month', 'year'].map((i) => <button key={i} className={`btn sm ${interval === i ? 'primary' : ''}`} onClick={() => setInterval(i)}>{i === 'month' ? 'Monthly' : `Yearly${intervalSaving ? ' (save)' : ''}`}</button>)}</div>}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            {data.plans.map((p) => {
              const current = data.plan === p.id && data.status === 'active';
              const fee = p.setup_fee?.[data.currency] || p.setup_fee?.PKR;
              return (
                <div key={p.id} className="card" style={{ padding: 16, border: current || p.highlight ? '2px solid var(--primary)' : undefined }}>
                  <div className="row between"><b style={{ fontSize: 16 }}>{p.name}</b>{p.highlight && <StatusBadge status="active" label="Recommended" />}</div>
                  {p.product === 'bundle' && <div className="muted">Both products</div>}
                  <div style={{ fontSize: 26, fontWeight: 700, margin: '8px 0' }}>{price(p, data.currency, interval)}<small className="muted" style={{ fontSize: 13, fontWeight: 400 }}> / {interval === 'month' ? 'mo' : 'yr'}</small></div>
                  {fee ? <div className="muted" style={{ marginBottom: 6 }}>+ one-time setup fee {fmtMoney(fee, p.setup_fee?.[data.currency] ? data.currency : 'PKR')}</div> : null}
                  <ul className="muted" style={{ paddingLeft: 18, margin: '0 0 12px' }}>
                    <li>{p.seats == null ? 'Unlimited' : `Up to ${p.seats}`} team members</li><li>{p.projects == null ? 'Unlimited' : `Up to ${p.projects}`} projects</li>
                    {p.product !== 'construction' && <li>{p.properties == null ? 'Unlimited' : `Up to ${p.properties.toLocaleString()}`} properties</li>}
                    <li>{p.storage_mb == null ? 'Unlimited' : `${Math.round(p.storage_mb / 1024 * 10) / 10} GB`} file storage</li>
                    {p.api_access && <li>Website / partner API</li>}
                    {(p.features || []).map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  {can('settings', 'edit') ? <button className="btn primary" style={{ width: '100%' }} disabled={current || busy === p.id} onClick={() => choose(p.id)}>{current ? 'Current plan' : busy === p.id ? 'Opening…' : data.status === 'active' ? 'Switch to this plan' : 'Choose plan'}</button> : <div className="muted">Ask an admin to change plan.</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {data.invoices?.length > 0 && (
        <Card title="Invoices & receipts" flush style={{ marginTop: 16 }}>
          <table className="t"><thead><tr><th>Date</th><th>Amount</th><th>Covers</th><th>Status</th><th /></tr></thead>
            <tbody>{data.invoices.map((i) => <tr key={i.id}><td>{dateTime(i.created_at)}</td><td>{fmtMoney(i.amount, i.currency)}</td><td className="muted">{i.period_start ? `${i.period_start} → ${i.period_end}` : ''}</td><td><StatusBadge status={i.status === 'paid' ? 'active' : 'pending'} label={i.status} /></td><td className="right">{i.hosted_url && <a className="btn sm" href={i.hosted_url} target="_blank" rel="noreferrer">View</a>}</td></tr>)}</tbody></table>
        </Card>
      )}
      {data.refunds?.length > 0 && (
        <Card title="Refunds" flush style={{ marginTop: 16 }}>
          <table className="t"><tbody>{data.refunds.map((r) => <tr key={r.id}><td>{dateTime(r.created_at)}</td><td>{fmtMoney(r.amount, r.currency)}</td><td className="muted">{r.reason || ''}</td></tr>)}</tbody></table>
        </Card>
      )}
      {!data.invoices?.length && data.plan !== 'legacy' && <Empty title="No invoices yet" />}
      {data.plan !== 'legacy' && can('settings', 'edit') && <CloseAccount slug={data.slug} />}
      {paying && <PayModal data={data} plan={paying} interval={interval} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
      {manual && <Modal title="Activate your plan" size="sm" onClose={() => setManual(null)} footer={<button className="btn primary" onClick={() => setManual(null)}>Close</button>}><p>{manual.text}</p></Modal>}
    </div>
  );
}
