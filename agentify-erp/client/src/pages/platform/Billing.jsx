// Plans & pricing (plan builder), transactions & invoices, and subscription history.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const limitText = (v) => (v == null ? 'Unlimited' : n0(v));
const priceText = (p, cur = 'PKR') => (p?.[cur] ? `${cur} ${n0(p[cur].month)}/mo · ${n0(p[cur].year)}/yr` : '—');
export function downloadCsv(name, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- plans
const PRODUCT_LABEL = { real_estate: 'Real Estate Brokerage', construction: 'Construction Management', bundle: 'Both products (bundle)', any: 'Any product' };
const moneyMap = (m) => (m && Object.keys(m).length ? Object.entries(m).map(([c, v]) => `${c} ${n0(v)}`).join(' · ') : '—');
const days = (arr) => (Array.isArray(arr) ? arr.join(', ') : String(arr || ''));

export function PlansPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState('real_estate');
  const load = useCallback(() => api.get(`${A}/plans`).then((x) => { setD(x); setSettings({ ...x.settings, trial_reminder_days: days(x.settings.trial_reminder_days), renewal_reminder_days: days(x.settings.renewal_reminder_days) }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const open = (p) => setEdit(p ? { ...p, isNew: false, allModules: p.modules == null, modules: p.modules || [], features: (p.features || []).join('\n'), setup_fee: { ...(p.setup_fee || {}) }, email: emailForm(p.email_limits), price: { PKR: { ...(p.price.PKR || {}) }, USD: { ...(p.price.USD || {}) } } }
    : { isNew: true, id: '', name: '', product: tab, description: '', seats: '', projects: '', properties: '', storage_mb: '', api_access: true, grace_days: 7, allModules: true, modules: [], features: '', highlight: false, trial_eligible: true, setup_fee: {}, email: emailForm(null), visible: true, active: true, price: { PKR: {}, USD: {} } });
  const nul = (v) => (v === '' || v == null ? null : v);
  const emailForm = (l) => ({ set: !!l, op_m: l?.operational?.monthly ?? '', op_d: l?.operational?.daily ?? '', mk_m: l?.marketing?.monthly ?? '', mk_d: l?.marketing?.daily ?? '', thresholds: (l?.thresholds || [70, 90, 100]).join(', '), hard_stop: l?.hard_stop !== false, topups: l?.topups !== false, op_on: !!l?.operational, mk_on: !!l?.marketing });
  const emailBody = (e) => (!e?.set ? null : { ...(e.op_on ? { operational: { monthly: nul(e.op_m), daily: nul(e.op_d) } } : {}), ...(e.mk_on ? { marketing: { monthly: nul(e.mk_m), daily: nul(e.mk_d) } } : {}),
    thresholds: String(e.thresholds).split(',').map((x) => Number(x.trim())).filter(Boolean), hard_stop: e.hard_stop, topups: e.topups });
  const save = async () => {
    const body = { name: edit.name, product: edit.product, description: edit.description, seats: nul(edit.seats), projects: nul(edit.projects), properties: nul(edit.properties), storage_mb: nul(edit.storage_mb), api_access: edit.api_access,
      grace_days: edit.grace_days, modules: edit.allModules ? null : edit.modules, features: String(edit.features || '').split('\n').map((x) => x.trim()).filter(Boolean), highlight: edit.highlight, trial_eligible: edit.trial_eligible,
      setup_fee: edit.setup_fee, email_limits: emailBody(edit.email), visible: edit.visible, active: edit.active, price: edit.price };
    try { await api.put(`${A}/plans/${encodeURIComponent(edit.id.trim().toLowerCase())}`, body); toast('Plan saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const saveSettings = async () => {
    try {
      await api.put(`${A}/plan-settings`, { default_trial_days: settings.default_trial_days, trial_plan: settings.trial_plan, trial_plan_construction: settings.trial_plans?.construction,
        trial_reminder_days: String(settings.trial_reminder_days).split(','), renewal_reminder_days: String(settings.renewal_reminder_days).split(','), one_trial_per_email: settings.one_trial_per_email });
      toast('Trial settings saved'); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const products = d ? [...Object.keys(d.products || {}), 'bundle'] : [];
  const shown = d ? d.plans.filter((p) => p.product === tab) : [];
  const modulesFor = (prod) => Object.entries(d.modules).filter(([, m]) => !m.product || prod === 'bundle' || m.product === prod);
  return (
    <>
      <PageTitle title="Plans & pricing" sub="Each product family has its own tiers. Changing a price affects new purchases and renewals only; workspaces keep the price they pay until they renew. Limit changes apply straight away.">
        <button className="btn primary sm" onClick={() => open(null)}>New plan</button>
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {products.map((p) => <button key={p} className={`btn sm ${tab === p ? 'primary' : ''}`} onClick={() => setTab(p)}>{PRODUCT_LABEL[p]} ({d.plans.filter((x) => x.product === p).length})</button>)}
          </div>
          <Card flush>
            {!shown.length ? <Empty title="No plans in this family yet" hint="Create one with New plan." /> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Plan</th><th>Price (PKR)</th><th>Price (USD)</th><th>Setup fee</th><th>Users</th><th>Projects</th><th>Properties</th><th>Storage</th><th>API</th><th>Subscribers</th><th>Status</th><th /></tr></thead><tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b>{p.highlight && <StatusBadge status="active" label="Recommended" />}<div className="muted mono">{p.id}</div>{p.description && <div className="muted">{p.description}</div>}</td>
                  <td className="nowrap">{priceText(p.price, 'PKR')}</td><td className="nowrap">{priceText(p.price, 'USD')}</td><td className="nowrap">{moneyMap(p.setup_fee)}</td>
                  <td>{limitText(p.seats)}</td><td>{limitText(p.projects)}</td><td>{limitText(p.properties)}</td><td>{p.storage_mb == null ? 'Unlimited' : `${n0(p.storage_mb)} MB`}</td><td>{p.api_access ? 'Yes' : 'No'}</td>
                  <td>{p.subscribers}</td>
                  <td>{p.active ? <StatusBadge status="active" label={p.visible ? 'On sale' : 'On sale (hidden)'} /> : <StatusBadge status="inactive" label="Retired" />}{!p.trial_eligible && <div className="muted">No trial</div>}</td>
                  <td className="right"><button className="btn sm" onClick={() => open(p)}>Edit</button></td>
                </tr>
              ))}
            </tbody></table></div>)}
          </Card>
          <Card title="Free trial and reminders">
            <div className="pa-grid3" style={{ marginBottom: 0 }}>
              <Field label="Trial length for new sign-ups (days)" hint="Default 7. 0 means no trial: new workspaces wait for a first payment."><TextInput type="number" value={settings.default_trial_days} onChange={(v) => setSettings({ ...settings, default_trial_days: v })} /></Field>
              <Field label="Real estate trials get the limits of"><select className="input" value={settings.trial_plan} onChange={(e) => setSettings({ ...settings, trial_plan: e.target.value })}>{d.plans.filter((p) => p.product !== 'construction').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></Field>
              <Field label="Construction trials get the limits of"><select className="input" value={settings.trial_plans?.construction || ''} onChange={(e) => setSettings({ ...settings, trial_plans: { ...settings.trial_plans, construction: e.target.value } })}>{d.plans.filter((p) => p.product !== 'real_estate').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></Field>
              <Field label="Trial reminders (days before the end)" hint="Comma separated, 0 = on the last day. Default 3, 1, 0."><TextInput value={settings.trial_reminder_days} onChange={(v) => setSettings({ ...settings, trial_reminder_days: v })} /></Field>
              <Field label="Renewal reminders for bank/wallet payers" hint="Days before the paid period ends. Card renewals are automatic."><TextInput value={settings.renewal_reminder_days} onChange={(v) => setSettings({ ...settings, renewal_reminder_days: v })} /></Field>
              <Field label="Trial abuse protection"><Toggle value={settings.one_trial_per_email} onChange={(v) => setSettings({ ...settings, one_trial_per_email: v })} label="One free trial per owner email" /></Field>
            </div>
            <p className="muted">Trials start and end at exact times stored in UTC; customers see them in their own timezone. The hourly lifecycle job sends reminders once and makes expired trials read-only even if nobody signs in.</p>
            <button className="btn primary sm" onClick={saveSettings}>Save trial settings</button>
          </Card>
          <AddonsCard />
          <CouponsCard plans={d.plans} />
        </>
      )}
      {edit && (
        <Modal title={edit.isNew ? 'New plan' : `Edit plan · ${edit.name}`} size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save plan</button></>}>
          <div className="pa-grid3" style={{ marginBottom: 0 }}>
            <Field label="Plan ID" required hint={edit.isNew ? 'Lowercase, e.g. con_pro. Cannot be changed later.' : 'Fixed'}><TextInput value={edit.id} disabled={!edit.isNew} onChange={(v) => setEdit({ ...edit, id: v })} /></Field>
            <Field label="Name" required><TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
            <Field label="Product family" hint={edit.subscribers ? 'Locked while workspaces subscribe to it' : ''}><select className="input" value={edit.product} disabled={!edit.isNew && edit.subscribers > 0} onChange={(e) => setEdit({ ...edit, product: e.target.value })}>{products.map((p) => <option key={p} value={p}>{PRODUCT_LABEL[p]}</option>)}</select></Field>
          </div>
          <Field label="Description"><TextInput value={edit.description || ''} onChange={(v) => setEdit({ ...edit, description: v })} /></Field>
          <Field label="Features shown on the pricing page" hint="One per line. Describe only what the plan really includes."><textarea className="input" rows={4} value={edit.features} onChange={(e) => setEdit({ ...edit, features: e.target.value })} /></Field>
          <h4 style={{ margin: '12px 0 6px' }}>Prices</h4>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            {['PKR', 'USD'].flatMap((cur) => ['month', 'year'].map((int) => (
              <Field key={cur + int} label={`${cur} per ${int}`} hint={!edit.isNew && edit.price[cur]?.[int] != null ? `Now ${n0(d.plans.find((p) => p.id === edit.id)?.price?.[cur]?.[int])}` : cur === 'PKR' ? 'Required' : 'Optional (card payments in USD)'}>
                <TextInput type="number" value={edit.price[cur]?.[int] ?? ''} onChange={(v) => setEdit({ ...edit, price: { ...edit.price, [cur]: { ...edit.price[cur], [int]: v === '' ? undefined : Number(v) } } })} />
              </Field>
            )))}
            {['PKR', 'USD'].map((cur) => <Field key={`fee${cur}`} label={`One-time setup fee (${cur})`} hint="Charged with the first payment only. Empty = none."><TextInput type="number" value={edit.setup_fee?.[cur] ?? ''} onChange={(v) => setEdit({ ...edit, setup_fee: { ...edit.setup_fee, [cur]: v === '' ? undefined : Number(v) } })} /></Field>)}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>Annual discount: set the yearly price lower than 12 x monthly.</p>
          <h4 style={{ margin: '12px 0 6px' }}>Limits</h4>
          <div className="pa-grid3" style={{ marginBottom: 0 }}>
            <Field label="Users" hint="Empty = unlimited"><TextInput type="number" value={edit.seats ?? ''} onChange={(v) => setEdit({ ...edit, seats: v })} /></Field>
            <Field label="Projects" hint="Empty = unlimited"><TextInput type="number" value={edit.projects ?? ''} onChange={(v) => setEdit({ ...edit, projects: v })} /></Field>
            <Field label="Properties" hint="Real estate. Empty = unlimited"><TextInput type="number" value={edit.properties ?? ''} onChange={(v) => setEdit({ ...edit, properties: v })} /></Field>
            <Field label="File storage (MB)" hint="Empty = unlimited"><TextInput type="number" value={edit.storage_mb ?? ''} onChange={(v) => setEdit({ ...edit, storage_mb: v })} /></Field>
            <Field label="Grace days after a failed payment"><TextInput type="number" value={edit.grace_days} onChange={(v) => setEdit({ ...edit, grace_days: v })} /></Field>
            <Field label="Website / partner API"><Toggle value={edit.api_access} onChange={(v) => setEdit({ ...edit, api_access: v })} label="Included" /></Field>
          </div>
          <h4 style={{ margin: '12px 0 6px' }}>Email allowance (per workspace, per usage period)</h4>
          <Toggle value={edit.email.set} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, set: v } })} label="This plan includes tenant email sending" />
          {edit.email.set && <>
            <p className="muted" style={{ fontSize: 12.5 }}>Counted per recipient when the provider accepts a message. Empty = unlimited for a category that is switched on. Account and security email is never counted. Periods are monthly from the workspace's start date and do not reset when the plan changes.</p>
            <div className="pa-grid3" style={{ marginBottom: 0 }}>
              <Field label="Appointments and receipts"><Toggle value={edit.email.op_on} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, op_on: v } })} label="Included" /></Field>
              <Field label="Monthly allowance"><TextInput type="number" disabled={!edit.email.op_on} value={edit.email.op_m} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, op_m: v } })} /></Field>
              <Field label="Daily limit (optional)"><TextInput type="number" disabled={!edit.email.op_on} value={edit.email.op_d} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, op_d: v } })} /></Field>
              <Field label="Campaigns and sequences"><Toggle value={edit.email.mk_on} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, mk_on: v } })} label="Included" /></Field>
              <Field label="Monthly allowance"><TextInput type="number" disabled={!edit.email.mk_on} value={edit.email.mk_m} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, mk_m: v } })} /></Field>
              <Field label="Daily limit (optional)"><TextInput type="number" disabled={!edit.email.mk_on} value={edit.email.mk_d} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, mk_d: v } })} /></Field>
              <Field label="Warn at (%)" hint="Comma separated"><TextInput value={edit.email.thresholds} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, thresholds: v } })} /></Field>
              <Field label="When the allowance is used"><Toggle value={edit.email.hard_stop} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, hard_stop: v } })} label="Stop sending (otherwise allow overage)" /></Field>
              <Field label="Top-ups"><Toggle value={edit.email.topups} onChange={(v) => setEdit({ ...edit, email: { ...edit.email, topups: v } })} label="Support can add extra messages" /></Field>
            </div></>}
          <h4 style={{ margin: '12px 0 6px' }}>Modules</h4>
          <Toggle value={edit.allModules} onChange={(v) => setEdit({ ...edit, allModules: v })} label="All modules of this product included" />
          {!edit.allModules && <div className="pa-grid2" style={{ marginTop: 8 }}>{modulesFor(edit.product).map(([k, m]) => (
            <label key={k} className="row" style={{ gap: 8 }}><input type="checkbox" checked={edit.modules.includes(k)} onChange={(e) => setEdit({ ...edit, modules: e.target.checked ? [...edit.modules, k] : edit.modules.filter((x) => x !== k) })} />{m.label}</label>
          ))}</div>}
          <p className="muted">CRM, contacts, projects, sales/contracts, receipts and settings are always included. Product modules are only available to workspaces of that product.</p>
          <h4 style={{ margin: '12px 0 6px' }}>Availability</h4>
          <Toggle value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="On sale (off = retired: current subscribers can still renew)" />
          <Toggle value={edit.visible} onChange={(v) => setEdit({ ...edit, visible: v })} label="Shown on the public price list" />
          <Toggle value={edit.highlight} onChange={(v) => setEdit({ ...edit, highlight: v })} label="Mark as recommended on the pricing page" />
          <Toggle value={edit.trial_eligible} onChange={(v) => setEdit({ ...edit, trial_eligible: v })} label="Free trial available" />
          {!edit.isNew && !!edit.price_history?.length && <>
            <h4 style={{ margin: '12px 0 6px' }}>Price history</h4>
            <div className="table-wrap"><table className="t"><tbody>{edit.price_history.map((h, i) => <tr key={i}><td className="muted nowrap">{h.effective_from.startsWith('2000') ? 'Original' : h.effective_from.slice(0, 16)}</td><td>{h.currency} per {h.interval}</td><td className="mono">{n0(h.amount)}</td><td className="muted">{h.created_by}</td></tr>)}</tbody></table></div>
          </>}
        </Modal>
      )}
    </>
  );
}

function AddonsCard() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get(`${A}/addons`).then(setRows).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    const ent = {}; for (const k of ['seats', 'projects', 'properties', 'storage_mb']) if (edit.entitlements[k]) ent[k] = Number(edit.entitlements[k]); if (edit.entitlements.api_access) ent.api_access = true;
    try { await api.put(`${A}/addons/${encodeURIComponent(edit.id.trim().toLowerCase())}`, { ...edit, entitlements: ent }); toast('Add-on saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const setPrice = (cur, int, v) => setEdit({ ...edit, price: { ...edit.price, [cur]: { ...(edit.price[cur] || {}), [int]: v === '' ? undefined : Number(v) } } });
  return (
    <Card title="Add-ons" actions={<button className="btn sm" onClick={() => setEdit({ isNew: true, id: '', name: '', description: '', product: 'any', price: { PKR: {} }, entitlements: {}, active: true })}>New add-on</button>}>
      <p className="muted">Extras sold on top of a plan. Their limits are added to the plan's. Customers buy them with bank or wallet payments; a Billing Manager can also switch one on for a workspace.</p>
      {!rows ? <Loading /> : !rows.length ? <Empty title="No add-ons yet" /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Add-on</th><th>Product</th><th>Price</th><th>Adds</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((a) => <tr key={a.id}><td><b>{a.name}</b><div className="muted mono">{a.id}</div></td><td>{PRODUCT_LABEL[a.product]}</td><td className="nowrap">{priceText(a.price, 'PKR')}</td>
            <td>{Object.entries(a.entitlements).map(([k, v]) => (k === 'api_access' ? 'API access' : `+${n0(v)} ${k.replace('_mb', ' MB')}`)).join(', ') || '—'}</td>
            <td><StatusBadge status={a.active ? 'active' : 'inactive'} label={a.active ? 'On sale' : 'Off'} /></td><td className="right"><button className="btn sm" onClick={() => setEdit({ ...a, isNew: false })}>Edit</button></td></tr>)}
        </tbody></table></div>
      )}
      {edit && (
        <Modal title={edit.isNew ? 'New add-on' : `Edit add-on · ${edit.name}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="ID" required><TextInput value={edit.id} disabled={!edit.isNew} onChange={(v) => setEdit({ ...edit, id: v })} /></Field>
            <Field label="Name" required><TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
          </div>
          <Field label="Description"><TextInput value={edit.description || ''} onChange={(v) => setEdit({ ...edit, description: v })} /></Field>
          <Field label="Available with"><select className="input" value={edit.product} onChange={(e) => setEdit({ ...edit, product: e.target.value })}>{['any', 'real_estate', 'construction'].map((p) => <option key={p} value={p}>{PRODUCT_LABEL[p]}</option>)}</select></Field>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            {['PKR', 'USD'].flatMap((cur) => ['month', 'year'].map((int) => <Field key={cur + int} label={`${cur} per ${int}`}><TextInput type="number" value={edit.price?.[cur]?.[int] ?? ''} onChange={(v) => setPrice(cur, int, v)} /></Field>))}
          </div>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            {[['seats', 'Extra users'], ['projects', 'Extra projects'], ['properties', 'Extra properties'], ['storage_mb', 'Extra storage (MB)']].map(([k, l]) => <Field key={k} label={l}><TextInput type="number" value={edit.entitlements?.[k] ?? ''} onChange={(v) => setEdit({ ...edit, entitlements: { ...edit.entitlements, [k]: v } })} /></Field>)}
          </div>
          <Toggle value={!!edit.entitlements?.api_access} onChange={(v) => setEdit({ ...edit, entitlements: { ...edit.entitlements, api_access: v } })} label="Adds website / partner API access" />
          <Toggle value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="On sale" />
        </Modal>
      )}
    </Card>
  );
}

function CouponsCard({ plans }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get(`${A}/coupons`).then(setRows).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    const body = { description: edit.description, percent_off: edit.kind === 'percent' ? edit.percent_off : null, amount_off: edit.kind === 'amount' ? edit.amount_off : {}, products: edit.products?.length ? edit.products : null,
      plans: edit.plans?.length ? edit.plans : null, intervals: edit.intervals?.length ? edit.intervals : null, first_payment_only: edit.first_payment_only, max_redemptions: edit.max_redemptions || null,
      valid_from: edit.valid_from || null, valid_until: edit.valid_until || null, active: edit.active };
    try { await api.put(`${A}/coupons/${encodeURIComponent(edit.code.trim().toUpperCase())}`, body); toast('Coupon saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const toggleIn = (k, v) => setEdit({ ...edit, [k]: (edit[k] || []).includes(v) ? edit[k].filter((x) => x !== v) : [...(edit[k] || []), v] });
  return (
    <Card title="Coupons & promotions" actions={<button className="btn sm" onClick={() => setEdit({ isNew: true, code: '', description: '', kind: 'percent', percent_off: 10, amount_off: {}, products: [], plans: [], intervals: [], first_payment_only: true, max_redemptions: '', valid_from: '', valid_until: '', active: true })}>New coupon</button>}>
      <p className="muted">Codes customers enter when paying by bank or wallet; the discount is applied by the server. For card payments create matching promotion codes in Stripe (checkout accepts them).</p>
      {!rows ? <Loading /> : !rows.length ? <Empty title="No coupons yet" /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Valid</th><th>Used</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((c) => <tr key={c.code}><td className="mono"><b>{c.code}</b><div className="muted">{c.description}</div></td>
            <td>{c.percent_off ? `${c.percent_off}%` : moneyMap(c.amount_off)}{c.first_payment_only ? <div className="muted">first payment</div> : null}</td>
            <td>{[c.products?.map((p) => PRODUCT_LABEL[p]).join(', '), c.plans?.join(', '), c.intervals?.join(', ')].filter(Boolean).join(' · ') || 'Everything'}</td>
            <td className="nowrap">{c.valid_from || '…'} – {c.valid_until || '…'}</td><td>{c.redeemed}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
            <td><StatusBadge status={c.active ? 'active' : 'inactive'} label={c.active ? 'Active' : 'Off'} /></td>
            <td className="right"><button className="btn sm" onClick={() => setEdit({ ...c, isNew: false, kind: c.percent_off ? 'percent' : 'amount', products: c.products || [], plans: c.plans || [], intervals: c.intervals || [], max_redemptions: c.max_redemptions || '', valid_from: c.valid_from || '', valid_until: c.valid_until || '' })}>Edit</button></td></tr>)}
        </tbody></table></div>
      )}
      {edit && (
        <Modal title={edit.isNew ? 'New coupon' : `Edit coupon · ${edit.code}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="Code" required><TextInput value={edit.code} disabled={!edit.isNew} onChange={(v) => setEdit({ ...edit, code: v.toUpperCase() })} /></Field>
            <Field label="Description"><TextInput value={edit.description || ''} onChange={(v) => setEdit({ ...edit, description: v })} /></Field>
            <Field label="Discount type"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="percent">Percent off</option><option value="amount">Fixed amount off</option></select></Field>
            {edit.kind === 'percent' ? <Field label="Percent off"><TextInput type="number" value={edit.percent_off ?? ''} onChange={(v) => setEdit({ ...edit, percent_off: v })} /></Field>
              : <Field label="Amount off (PKR)"><TextInput type="number" value={edit.amount_off?.PKR ?? ''} onChange={(v) => setEdit({ ...edit, amount_off: { ...edit.amount_off, PKR: v === '' ? undefined : Number(v) } })} /></Field>}
            <Field label="Valid from"><TextInput type="date" value={edit.valid_from} onChange={(v) => setEdit({ ...edit, valid_from: v })} /></Field>
            <Field label="Valid until"><TextInput type="date" value={edit.valid_until} onChange={(v) => setEdit({ ...edit, valid_until: v })} /></Field>
            <Field label="Maximum uses" hint="Empty = unlimited"><TextInput type="number" value={edit.max_redemptions} onChange={(v) => setEdit({ ...edit, max_redemptions: v })} /></Field>
          </div>
          <Field label="Products (none ticked = all)"><div className="row" style={{ gap: 12 }}>{['real_estate', 'construction'].map((p) => <label key={p} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.products.includes(p)} onChange={() => toggleIn('products', p)} />{PRODUCT_LABEL[p]}</label>)}</div></Field>
          <Field label="Plans (none ticked = all)"><div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{plans.map((p) => <label key={p.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.plans.includes(p.id)} onChange={() => toggleIn('plans', p.id)} />{p.name} <span className="muted mono">{p.id}</span></label>)}</div></Field>
          <Field label="Billing (none ticked = both)"><div className="row" style={{ gap: 12 }}>{['month', 'year'].map((i) => <label key={i} className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.intervals.includes(i)} onChange={() => toggleIn('intervals', i)} />{i === 'month' ? 'Monthly' : 'Yearly'}</label>)}</div></Field>
          <Toggle value={edit.first_payment_only} onChange={(v) => setEdit({ ...edit, first_payment_only: v })} label="First payment only" />
          <Toggle value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- transactions
const TX_STATUS = [['', 'Any status'], ['paid', 'Invoice paid'], ['pending', 'Waiting for approval'], ['approved', 'Approved'], ['rejected', 'Rejected']];
export function TransactionsPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ status: '', method: '', q: '', page: 0 });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    const p = new URLSearchParams(Object.entries({ ...f, per: 50 }).filter(([, v]) => v !== '' && v != null));
    const t = setTimeout(() => api.get(`${A}/transactions?${p}`).then(setD).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [f]);
  const exportAll = async () => {
    const p = new URLSearchParams(Object.entries({ ...f, page: 0, per: 200 }).filter(([, v]) => v !== '' && v != null));
    let page = 0, rows = [];
    for (;;) { p.set('page', page); const r = await api.get(`${A}/transactions?${p}`); rows = rows.concat(r.rows); if (rows.length >= r.total || !r.rows.length) break; page += 1; }
    downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, ['Date (UTC)', 'Workspace', 'Type', 'Reference', 'Method', 'Amount', 'Currency', 'Payment status', 'Invoice status', 'Plan', 'Period'],
      rows.map((r) => [r.created_at, r.tenant, r.kind, r.reference, r.method, r.amount, r.currency, r.payment_status, r.invoice_status, r.plan ? `${r.plan}/${r.interval}` : '', r.period_start ? `${r.period_start} to ${r.period_end}` : '']));
  };
  return (
    <>
      <PageTitle title="Transactions & invoices" sub="Every payment and invoice in one list. Payment status (for bank and wallet transfers) and invoice status are shown separately.">
        <button className="btn sm" onClick={exportAll} disabled={!d?.total}>Export CSV</button>
      </PageTitle>
      <Card flush title={d ? `${d.total} record${d.total === 1 ? '' : 's'}${Object.keys(d.paid_totals).length ? ` · paid ${Object.entries(d.paid_totals).map(([c, v]) => `${c} ${n0(v)}`).join(' · ')}` : ''}` : 'Loading'} actions={<>
        <input className="input" style={{ width: 220 }} placeholder="Reference or workspace" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 0 })} aria-label="Search transactions" />
        <select className="input" style={{ width: 190 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 0 })} aria-label="Status">{TX_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="input" style={{ width: 160 }} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value, page: 0 })} aria-label="Method"><option value="">Any method</option>{['stripe', 'bank', 'raast', 'easypaisa', 'jazzcash', 'sadapay', 'nayapay', 'manual'].map((m) => <option key={m}>{m}</option>)}</select>
      </>}>
        <ErrorBox error={err} />
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No transactions match" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Workspace</th><th>Reference</th><th>Method</th><th className="right">Amount</th><th>Payment</th><th>Invoice</th><th>Covers</th></tr></thead><tbody>
            {d.rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${r.tenant_id}`)}>
                <td className="nowrap muted">{String(r.created_at).slice(0, 16)}</td><td><b>{r.tenant}</b><div className="muted">{r.slug}</div></td>
                <td className="mono">{r.reference}{r.note && <div className="muted" style={{ fontFamily: 'inherit' }}>{r.note}</div>}</td><td>{r.method || '—'}</td>
                <td className="right mono nowrap">{r.currency} {n0(r.amount)}</td>
                <td>{r.payment_status ? <StatusBadge status={r.payment_status} /> : <span className="muted">—</span>}</td>
                <td>{r.invoice_status ? <StatusBadge status={r.invoice_status} /> : <span className="muted">Not issued</span>}</td>
                <td className="nowrap muted">{r.period_start ? `${r.period_start} → ${r.period_end}` : r.plan ? `${r.plan} / ${r.interval}` : '—'}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {d && d.total > d.per && <div className="pa-pager"><span className="muted">{d.page * d.per + 1}–{Math.min(d.total, (d.page + 1) * d.per)} of {d.total}</span><span><button className="btn sm" disabled={!d.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button> <button className="btn sm" disabled={(d.page + 1) * d.per >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></span></div>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- subscription history
export const historyLine = (h) => {
  const parts = [];
  if (h.from_plan !== h.to_plan) parts.push(`plan ${h.from_plan || '—'} → ${h.to_plan || '—'}`);
  if (h.from_status !== h.to_status) parts.push(`status ${h.from_status || '—'} → ${h.to_status || '—'}`);
  if (h.from_period_end !== h.to_period_end) parts.push(`paid until ${h.from_period_end || '—'} → ${h.to_period_end || '—'}`);
  if (!parts.length && h.trial_ends_at) parts.push(`trial until ${h.trial_ends_at}`);
  if (!parts.length && h.grace_until) parts.push(`grace until ${h.grace_until}`);
  if (!parts.length && h.price_amount != null) parts.push(`price ${h.price_currency} ${n0(h.price_amount)}`);
  return parts.join(' · ') || 'updated';
};
export function SubscriptionHistoryPage() {
  const nav = useNavigate();
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`${A}/subscriptions/history?page=${page}&per=50`).then(setD).catch((e) => setErr(e.message)); }, [page]);
  return (
    <>
      <PageTitle title="Subscription history" sub="Every plan and billing change on every workspace: who or what made it, and why. This record cannot be edited." />
      <ErrorBox error={err} />
      <Card flush>
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No changes recorded yet" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When (UTC)</th><th>Workspace</th><th>Change</th><th>By</th><th>Reason</th></tr></thead><tbody>
            {d.rows.map((h) => <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${h.tenant_id}`)}><td className="nowrap muted">{h.created_at.slice(0, 16)}</td><td><b>{h.tenant_name}</b></td><td>{historyLine(h)}</td><td>{h.actor || h.source}</td><td className="muted">{h.reason || '—'}</td></tr>)}
          </tbody></table></div>
        )}
        {d && d.total > 50 && <div className="pa-pager"><span className="muted">{page * 50 + 1}–{Math.min(d.total, (page + 1) * 50)} of {d.total}</span><span><button className="btn sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button> <button className="btn sm" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</button></span></div>}
      </Card>
    </>
  );
}
