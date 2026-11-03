// Content tiers in the console: the margin view (price against estimated cost, with fees, tax and the commission estimate) and the Launch offer page.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A } from './AdminShell.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const FLAG = { red: ['Below cost', '#b3261e'], orange: ['Under target', '#b26a00'], ok: ['OK', 'var(--g2, #0e7c6b)'] };

export function PlanMarginPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [m, setM] = useState(null);
  const [cur, setCur] = useState('');
  const load = useCallback(() => api.get(`${A}/plan-margin`).then((x) => { setD(x); setM(x.settings); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d || !m) return <Loading />;
  const num = (k) => (v) => setM({ ...m, [k]: v });
  const nested = (g, k) => (v) => setM({ ...m, [g]: { ...m[g], [k]: v } });
  const save = async () => { try { const r = await api.put(`${A}/margin-settings`, m); setD(r.report); setM(r.settings); toast('Cost inputs saved'); } catch (e) { toast(e.message, 'err'); } };
  const CURS = Object.keys(m.fx);
  const curNow = cur || CURS[0];
  const rows = d.rows.filter((r) => r.currency === curNow);
  const cc = d.credit_costs;
  const input = (k, label, hint) => <Field key={k} label={label} hint={hint}><TextInput type="number" value={m[k]} onChange={num(k)} /></Field>;
  return (
    <>
      <ErrorBox error={err} />
      <Card title="Cost inputs (all editable)">
        <div className="pa-grid3">
          {input('vps_usd', 'Server (USD a month)', 'Shared by all workspaces')}
          {input('resend_usd', 'Resend Pro (USD a month)', 'Shared by the whole platform')}
          {input('resend_emails', 'Resend emails included', 'Cost of one email = price / this')}
          {input('storage_usd', 'Object storage (USD)', 'For the GB below')}
          {input('storage_gb', 'Object storage GB')}
          {input('paying_tenants', 'Paying workspaces sharing fixed costs', 'Fixed cost per workspace = (server + Resend) / this')}
          {input('typical_use_pct', 'Typical use (%)', 'Share of credits and storage a normal workspace uses')}
          {input('payment_fee_pct', 'Payment gateway fee (%)')}
          {input('commission_pct', 'Sales commission estimate (%)', 'A cost estimate only; no commission is tracked or paid from here')}
          {input('target_multiple', 'Target: price at least this many times cost', 'Below it a row turns orange; below cost it turns red')}
          {input('yearly_discount_pct', 'Yearly discount (%)', 'Guide for setting yearly prices')}
          {CURS.filter((c) => c !== 'USD').map((c) => <Field key={`fx${c}`} label={`${c} per 1 USD`}><TextInput type="number" value={m.fx[c]} onChange={nested('fx', c)} /></Field>)}
          {CURS.map((c) => <Field key={`tx${c}`} label={`Tax in ${c} prices (%)`} hint="Prices are treated as tax-inclusive"><TextInput type="number" value={m.tax_pct[c]} onChange={nested('tax_pct', c)} /></Field>)}
          {['video', 'voice', 'image'].map((k) => <Field key={k} label={`Credit mix: ${k} (%)`} hint="How a workspace spends credits at full use"><TextInput type="number" value={m.mix[k]} onChange={nested('mix', k)} /></Field>)}
        </div>
        <button className="btn primary sm" onClick={save}>Save cost inputs</button>
        <p className="muted" style={{ fontSize: 12.5 }}>Live AI cost per credit (from the AI price list): video {money(cc.video)}, voice {money(cc.voice)}, image {money(cc.image)}; blended at your mix {money(cc.blended)}. One email costs about ${(d.per_email_usd).toFixed(5)}. Fixed cost per workspace: {Object.entries(d.fixed_per_tenant).map(([n, v]) => `${money(v)} at ${n} workspaces`).join(', ')}.</p>
      </Card>
      <Card title="Margin by plan" actions={<span>{CURS.map((c) => <button key={c} className={`btn sm ${curNow === c ? 'primary' : ''}`} onClick={() => setCur(c)}>{c}</button>)}</span>}>
        {!rows.length ? <p className="muted">No content tier has a {curNow} price yet.</p> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Plan</th><th>Price</th><th className="right">In USD</th><th className="right">Credits</th><th className="right">AI full</th><th className="right">Storage</th><th className="right">Fixed</th><th className="right">Fees</th><th className="right">Tax</th><th className="right">Commission</th><th className="right">Cost full use</th><th className="right">Profit</th><th className="right">Margin full</th><th className="right">Margin typical</th><th>Check</th></tr></thead>
            <tbody>{rows.map((r) => { const [l, c] = FLAG[r.flag]; return (
              <tr key={r.plan + r.kind}><td><b>{r.name}</b><div className="muted">{r.label}</div></td><td className="nowrap">{r.price.toLocaleString()} {r.currency}</td><td className="right">{money(r.price_usd)}</td><td className="right">{r.credits}</td>
                <td className="right">{money(r.ai_full)}</td><td className="right">{money(r.storage_full)}</td><td className="right">{money(r.fixed)}</td><td className="right">{money(r.fees)}</td><td className="right">{money(r.tax)}</td><td className="right">{money(r.commission)}</td>
                <td className="right">{money(r.cost_full)}</td><td className="right">{money(r.profit_full)}</td><td className="right">{r.margin_full_pct}% ({r.multiple_full}x)</td><td className="right">{r.margin_typical_pct}%</td>
                <td><b style={{ color: c }}>{r.flag === 'red' ? '● ' : r.flag === 'orange' ? '● ' : ''}{l}</b></td></tr>); })}</tbody></table></div>
        )}
        <p className="muted" style={{ fontSize: 12.5 }}>{d.warnings ? `${d.warnings} price${d.warnings === 1 ? '' : 's'} need a look across all countries. ` : 'Every price meets your target. '}Red = the price is below the cost of serving a workspace that uses everything. Orange = above cost but under your target multiple (a launch offer in orange is allowed; it blocks nothing). Costs here are estimates, not invoices.</p>
      </Card>
    </>
  );
}

export function LaunchOfferPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState(null);
  const [plans, setPlans] = useState([]);
  const load = useCallback(() => Promise.all([api.get(`${A}/launch-offer`), api.get(`${A}/plans`)]).then(([x, p]) => { setD(x); setPlans(p.plans.filter((q) => q.launch_offer)); setF({ ...x.offer, ends_at: x.offer.ends_at ? x.offer.ends_at.slice(0, 16) : '', spots: x.offer.spots ?? '' }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d || !f) return <Loading />;
  const save = async (extra = {}) => {
    try {
      const body = { ...f, ...extra, ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null, spots: f.spots === '' ? null : Number(f.spots) };
      const r = await api.put(`${A}/launch-offer`, body); setD(r); setF({ ...r.offer, ends_at: r.offer.ends_at ? r.offer.ends_at.slice(0, 16) : '', spots: r.offer.spots ?? '' }); toast('Launch offer saved');
    } catch (e) { toast(e.message, 'err'); }
  };
  const country = (c, k, v) => setF({ ...f, countries: { ...f.countries, [c]: { ...f.countries[c], [k]: v } } });
  const fill = (t, c) => String(t).replaceAll('{percent}', c.percent).replaceAll('{months}', c.months);
  const CURS = Object.keys(f.countries);
  const live = d.live;
  return (
    <>
      <ErrorBox error={err} />
      <Card title="Launch offer">
        <Toggle value={!!f.on} onChange={(v) => save({ on: v })} label={f.on ? (live.on ? 'ON: visitors see the banner and launch prices' : 'ON, but not showing right now (ended, out of spots or no discount set)') : 'OFF: no banner, no crossed-out prices, normal prices charged'} />
        <p className="muted" style={{ fontSize: 12.5 }}>The discount applies to the first monthly payments of plans marked "Part of the launch offer". Yearly billing has no launch discount. Workspaces that already paid before you switched the offer on keep their price. Switching the offer off, passing the end date or running out of spots removes the banner and the crossed-out prices and stops the discount at checkout.</p>
        <div className="pa-grid3">
          {CURS.map((c) => <div key={c}><b>{c}</b>
            <Field label="Discount (%)"><TextInput type="number" value={f.countries[c].percent} onChange={(v) => country(c, 'percent', v)} /></Field>
            <Field label="For the first (months)"><TextInput type="number" value={f.countries[c].months} onChange={(v) => country(c, 'months', v)} /></Field></div>)}
        </div>
        <Field label="Banner text" hint="{percent} and {months} are filled in for each country"><TextInput value={f.banner_text} onChange={(v) => setF({ ...f, banner_text: v })} /></Field>
        <Field label="Banner button text"><TextInput value={f.button_text} onChange={(v) => setF({ ...f, button_text: v })} /></Field>
        <div className="pa-grid3">
          <Field label="Offer ends (optional)" hint="Empty = no end date"><input className="input" type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
          <Field label="Founding spots (optional)" hint="Offer stops when this many workspaces have paid"><TextInput type="number" value={f.spots} onChange={(v) => setF({ ...f, spots: v })} /></Field>
          <Field label="Founding spots taken so far"><div style={{ paddingTop: 8 }}>{d.claimed_spots}</div></Field>
          <Field label="Show the days left"><Toggle value={!!f.show_countdown} onChange={(v) => setF({ ...f, show_countdown: v })} label="Needs an end date. Off by default." /></Field>
          <Field label="Show the spots left"><Toggle value={!!f.show_spots} onChange={(v) => setF({ ...f, show_spots: v })} label="Needs founding spots. Off by default." /></Field>
        </div>
        <button className="btn primary sm" onClick={() => save()}>Save launch offer</button>
      </Card>
      <Card title="Live preview">
        {!live.on ? <p className="muted">The offer is not showing, so visitors see normal prices and no banner.</p> : (
          CURS.filter((c) => live.countries[c]).map((c) => (
            <div key={c} style={{ marginBottom: 14 }}>
              <div style={{ background: 'var(--g2, #0e7c6b)', color: '#fff', padding: '8px 14px', borderRadius: 8, textAlign: 'center' }}><b>{live.countries[c].banner}</b>{live.ends_at ? ` · ends ${new Date(live.ends_at).toLocaleDateString()}` : ''}{live.spots_left != null ? ` · ${live.spots_left} founding spots left` : ''}</div>
              <div className="pa-grid3" style={{ marginTop: 8 }}>
                {plans.filter((p) => p.price[c]?.month != null).map((p) => { const n = p.price[c].month, l = Math.round(n * (1 - live.countries[c].percent / 100)); return (
                  <div key={p.id} className="card" style={{ padding: 12 }}><b>{p.name}</b><div className="muted"><s>{n.toLocaleString()} {c}</s></div><div style={{ fontSize: 22, fontWeight: 700 }}>{l.toLocaleString()} {c}<small> / month</small></div><div>Save {live.countries[c].percent}% for {live.countries[c].months} months</div><div className="muted">Then {n.toLocaleString()} {c} / month from month {live.countries[c].months + 1}</div></div>); })}
              </div>
            </div>))
        )}
        {!!live.on && !plans.some((p) => p.visible) && <p className="muted">No plan marked for the launch offer is on the public pricing page yet. Open Plans, switch a tier to "Visible" and it appears with the launch price.</p>}
      </Card>
    </>
  );
}
