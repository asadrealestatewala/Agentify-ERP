import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Empty, Field, KV, Modal, StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { date, money, cur } from '../format.js';

const METHODS = [['Bank Transfer', '🏦 Bank transfer'], ['Easypaisa', 'Easypaisa'], ['JazzCash', 'JazzCash'], ['Online Transfer', 'Other wallet / app'], ['Cheque', 'Cheque'], ['Cash', 'Cash at office']];
const ONLINE = ['Bank Transfer', 'Online Transfer', 'JazzCash', 'Easypaisa'];

export const STATE = {
  overdue: ['red', 'Overdue'], due: ['amber', 'Due soon'], upcoming: ['grey', 'Upcoming'], in_process: ['blue', 'In process'], verifying: ['purple', 'Under verification'],
};
export const stateBadge = (s) => <StatusBadge status={s} tone={STATE[s]?.[0]} label={STATE[s]?.[1] || s} />;

/** Opens the company WhatsApp chat with the proof message ready, and tells finance the proof is on its way. */
async function sendProof(claim, toast) {
  if (!claim.wa_url) { toast('The company WhatsApp number is not set — please contact the accounts office.', 'err'); return; }
  window.open(claim.wa_url, '_blank', 'noopener');
  try { await api.post(`/api/portal/payment-claims/${claim.id}/proof-sent`); } catch { /* the chat still opened */ }
}

/** Shown when the customer returns from an online payment page (?gw=token): confirms with the server, which asks the provider. */
export function OnlinePayBanner({ onPaid }) {
  const [sp, setSp] = useSearchParams();
  const token = sp.get('gw'), cancelled = sp.get('cancelled') === '1';
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!token || cancelled) return undefined;
    let stop = false, n = 0, t;
    const tick = async () => {
      try { const r = await api.get(`/api/portal/pay-online/${token}`); if (stop) return; setSt(r); if (r.status === 'paid' || r.status === 'paid_test') { onPaid?.(); return; } } catch { /* keep trying */ }
      if (!stop && ++n < 20) t = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [token, cancelled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!token) return null;
  const close = <button className="btn sm" onClick={() => setSp({}, { replace: true })}>Dismiss</button>;
  if (cancelled) return <div className="alert warn row between">You cancelled the online payment. Nothing was charged. {close}</div>;
  if (!st) return <div className="alert info">Checking your payment…</div>;
  if (st.status === 'paid') return <div className="alert ok row between"><span>Payment of {money(st.amount)} received through {st.provider}. Your receipt is ready below.</span>{close}</div>;
  if (st.status === 'paid_test') return <div className="alert info row between"><span>Test payment confirmed ({st.provider}). No real money moved and no receipt was created.</span>{close}</div>;
  if (st.status === 'paid_pending_posting') return <div className="alert info row between"><span>We received your payment of {money(st.amount)}. Our accounts team is recording it; your receipt will appear shortly.</span>{close}</div>;
  if (st.status === 'failed') return <div className="alert err row between"><span>The online payment could not be confirmed. If money left your account, please contact us with this reference: {st.token.slice(0, 8)}.</span>{close}</div>;
  return <div className="alert info row between"><span>We are confirming your payment of {money(st.amount)} with {st.provider}. This usually takes a few seconds. You do not need to pay again.</span>{close}</div>;
}

/** Where to send the money, filtered to the chosen method. */
function PayTo({ method }) {
  const { data } = useFetch('/api/portal/pay-to');
  const shown = useMemo(() => { const m = (data || []).filter((x) => x.name === method); return m.length ? m : (data || []); }, [data, method]);
  if (!data?.length) return <div className="muted">Ask our accounts office for the payment details.</div>;
  return (
    <div className="grid g2">{shown.map((m) => (
      <div key={m.name} className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
        <b>{m.name}</b>
        <KV items={[['Bank', m.bank_name], ['Account title', m.account_title], ['Account number', m.account_number], ['IBAN', m.iban], ['Branch', m.branch], ['Wallet number', m.wallet_number]].filter((x) => x[1])} />
        {m.instructions && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{m.instructions}</div>}
      </div>))}</div>
  );
}

/** The payments the customer owes (overdue and coming up) with their status and a Pay button. */
export function DuesCard({ refreshKey, onPay }) {
  const toast = useToast();
  const { data } = useFetch('/api/portal/dues', { k: refreshKey }, [refreshKey]);
  if (!data) return null;
  if (!data.length) return <Card title="Payments due"><Empty icon="check" title="You are all paid up" hint="Nothing is due right now." /></Card>;
  return (
    <Card title="Payments due" flush actions={<span className="muted" style={{ fontSize: 12 }}>Pay by bank, Easypaisa, JazzCash or any wallet, then send us the proof</span>}>
      <table className="t"><thead><tr><th>Due date</th><th>Plan</th><th>Payment</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((d) => (
          <tr key={d.id} style={d.state === 'overdue' ? { background: 'var(--red-bg)' } : undefined}>
            <td className="nowrap">{date(d.due_date)}<div className="cell-sub">{d.days < 0 ? `${-d.days} day(s) late` : d.days === 0 ? 'today' : `in ${d.days} day(s)`}</div></td>
            <td>{d.title}<div className="cell-sub">{d.sale_no}</div></td>
            <td style={{ textTransform: 'capitalize' }}>{d.kind} #{d.seq}</td>
            <td className="num mono">{money(d.remaining)}</td>
            <td>{stateBadge(d.state)}{d.claim_ref && <div className="cell-sub">{d.claim_ref}</div>}</td>
            <td className="right nowrap">
              {['overdue', 'due', 'upcoming'].includes(d.state) && <button className={`btn sm ${d.state === 'upcoming' ? '' : 'primary'}`} onClick={() => onPay([d.id])}>Pay</button>}
              {d.state === 'in_process' && <button className="btn sm success" onClick={() => sendProof({ id: d.claim_id, wa_url: d.wa_url }, toast)}>Send proof on WhatsApp</button>}
              {d.state === 'verifying' && <span className="muted" style={{ fontSize: 12 }}>We are confirming it</span>}
            </td>
          </tr>))}</tbody></table>
    </Card>
  );
}

/** Pay now: choose what you are paying, see where to send it, report it, then send the proof on WhatsApp. */
export function PayNowModal({ onClose, onDone, presetIds }) {
  const toast = useToast();
  const dues = useFetch('/api/portal/dues');
  const rows = (dues.data || []).filter((d) => ['overdue', 'due', 'upcoming'].includes(d.state));
  const [picked, setPicked] = useState(presetIds || null);
  const sel = picked || (() => { const first = rows.find((d) => d.state === 'overdue') || rows.find((d) => d.state === 'due') || rows[0]; if (!first) return []; return rows.filter((d) => d.sale_id === first.sale_id && d.state === 'overdue').map((d) => d.id).concat(first.state === 'overdue' ? [] : [first.id]); })();
  const chosen = rows.filter((d) => sel.includes(d.id));
  const total = chosen.reduce((a, d) => a + d.remaining, 0);
  const [f, setF] = useState({ amount: '', method: 'Bank Transfer', txn_id: '', bank: '', cheque_no: '', paid_date: new Date().toLocaleDateString('en-CA'), note: '' });
  const [slip, setSlip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const gws = useFetch('/api/portal/pay-online');
  const payOnline = async (g) => {
    setBusy(true);
    try { const r = await api.post('/api/portal/pay-online', { provider: g.id, installment_ids: sel }); window.location.assign(r.url); } catch (er) { toast(er.message, 'err'); setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const online = ONLINE.includes(f.method);
  const toggle = (d) => {
    const cur = chosen.length && chosen[0].sale_id !== d.sale_id ? [] : sel;
    setPicked(cur.includes(d.id) ? cur.filter((x) => x !== d.id) : [...cur, d.id]); setF((x) => ({ ...x, amount: '' }));
  };
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      const fd = new FormData();
      Object.entries({ ...f, amount: f.amount || total, installment_ids: sel.join(',') }).forEach(([k, v]) => v !== '' && v !== 0 && fd.append(k, v));
      if (!f.bank && ['Easypaisa', 'JazzCash'].includes(f.method)) fd.set('bank', f.method);
      if (slip) fd.append('slip', slip);
      const r = await api.upload('/api/portal/payment-claims', fd);
      setDone({ ...r, amount: Number(f.amount || total) }); onDone?.();
    } catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title="Payment reported" size="sm" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <div className="alert ok">Reference <b>{done.ref}</b> · {money(done.amount)} · status <b>In process</b></div>
          <p style={{ margin: 0 }}>Now send your payment proof (slip or screenshot) to our WhatsApp number so we can verify it. Your status will move to <b>Under verification</b> and then <b>Paid</b>, and your receipt appears here.</p>
          <button className="btn success" onClick={() => sendProof({ id: done.id, wa_url: done.wa_url }, toast)}>Send proof on WhatsApp</button>
          <span className="muted" style={{ fontSize: 12 }}>The message is pre-filled with your reference — just attach the picture and send.</span>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Pay now" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !chosen.length} onClick={submit}>{busy ? 'Sending…' : 'I have paid — report my payment'}</button></>}>
      <div className="stack">
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>1. What are you paying?</div>
          {!rows.length ? <Empty icon="check" title="Nothing is open for payment" hint="Everything due is paid or already being processed." /> : (
            <table className="t"><tbody>{rows.map((d) => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => toggle(d)}>
                <td style={{ width: 28 }}><input type="checkbox" checked={sel.includes(d.id)} onChange={() => toggle(d)} aria-label={`Pay ${d.kind} ${d.seq}`} /></td>
                <td>{d.title}<div className="cell-sub" style={{ textTransform: 'capitalize' }}>{d.kind} #{d.seq} · due {date(d.due_date)}</div></td><td>{stateBadge(d.state)}</td><td className="num mono">{money(d.remaining)}</td></tr>))}</tbody></table>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Payments of one plan are reported together; plot and house payments are reported separately.</div>
        </div>
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>2. How will you pay?</div>
          {!!gws.data?.length && (
            <div className="stack" style={{ marginBottom: 12 }}>
              <div className="row wrap" style={{ gap: 8 }}>{gws.data.map((g) => (
                <button type="button" key={g.id} className="btn primary" disabled={busy || !chosen.length} onClick={() => payOnline(g)}>Pay {chosen.length ? money(total) : ''} online with {g.label}{g.test_mode ? ' (test)' : ''}</button>))}</div>
              <div className="muted" style={{ fontSize: 12 }}>You will be taken to a secure payment page. Your receipt appears here automatically once the payment is confirmed. Or pay by bank / wallet below and report it.</div>
            </div>)}
          <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>{METHODS.map(([v, l]) => <button type="button" key={v} className={`btn sm ${f.method === v ? 'primary' : ''}`} onClick={() => setF({ ...f, method: v })}>{l}</button>)}</div>
          {f.method === 'Cash' ? <div className="muted">Pay at our office and ask for your receipt — no need to report it here.</div> : <PayTo method={f.method} />}
        </div>
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>3. Tell us what you paid</div>
          <form className="form-grid" onSubmit={submit}>
            <Field label={`Amount paid (${cur()})`} required hint={chosen.length ? `Selected: ${money(total)}` : ''}><input className="input" type="number" min="1" value={f.amount} onChange={set('amount')} placeholder={total ? String(total) : ''} /></Field>
            <Field label="Date paid" required><input className="input" type="date" max={new Date().toLocaleDateString('en-CA')} value={f.paid_date} onChange={set('paid_date')} /></Field>
            {(online || f.method === 'Cheque') && <Field label={f.method === 'Cheque' ? 'Bank' : 'Bank / channel you paid from'} required><input className="input" value={f.bank} onChange={set('bank')} placeholder={['Easypaisa', 'JazzCash'].includes(f.method) ? f.method : 'e.g. HBL, Meezan'} /></Field>}
            {online && <Field label="Transaction ID" required hint="From your bank / wallet receipt"><input className="input" value={f.txn_id} onChange={set('txn_id')} /></Field>}
            {f.method === 'Cheque' && <Field label="Cheque number" required><input className="input" value={f.cheque_no} onChange={set('cheque_no')} /></Field>}
            <Field label="Payment slip / screenshot (optional — you can also send it on WhatsApp next)" className="full"><input type="file" accept="image/*,.pdf" onChange={(e) => setSlip(e.target.files?.[0] || null)} /></Field>
            <Field label="Note (optional)" className="full"><input className="input" value={f.note} onChange={set('note')} /></Field>
          </form>
        </div>
      </div>
    </Modal>
  );
}

const TONE = { pending: 'blue', verifying: 'purple', approved: 'green', rejected: 'red' };
const LABEL = { pending: 'In process', verifying: 'Under verification', approved: 'Paid', rejected: 'Not confirmed' };
/** The customer's reported payments with their status; "In process" ones offer the WhatsApp proof button. */
export function MyPaymentReports({ refreshKey, onViewReceipt }) {
  const toast = useToast();
  const { data, reload } = useFetch('/api/portal/payment-claims', { k: refreshKey }, [refreshKey]);
  if (!data?.length) return null;
  return (
    <Card title="Payments I reported" flush>
      <table className="t"><thead><tr><th>Reference</th><th>Property</th><th>Method</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((c) => (
          <tr key={c.id}><td>{c.ref}<div className="cell-sub">{date(c.paid_date)}</div></td><td>{c.property}</td><td>{c.method}{c.txn_id ? <div className="cell-sub">{c.txn_id}</div> : null}</td><td className="num mono">{money(c.amount)}</td>
            <td><StatusBadge status={c.status} tone={TONE[c.status]} label={LABEL[c.status]} />{c.status === 'pending' && (c.proof_sent_at ? <div className="cell-sub">Proof sent on WhatsApp</div> : <div className="cell-sub">Send your proof on WhatsApp</div>)}{c.reject_reason && <div className="cell-sub">{c.reject_reason}</div>}</td>
            <td className="right nowrap">
              {c.status === 'pending' && <button className="btn sm success" onClick={async () => { await sendProof(c, toast); reload(); }}>{c.proof_sent_at ? 'Send again' : 'Send proof on WhatsApp'}</button>}
              {c.receipt_id && <button className="btn sm" onClick={() => onViewReceipt(c.receipt_id)}>View receipt {c.receipt_no}</button>}</td></tr>))}</tbody></table>
    </Card>
  );
}
