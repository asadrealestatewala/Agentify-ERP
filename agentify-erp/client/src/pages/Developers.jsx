import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { BackLink, Card, Empty, Loading, Modal, PageHead, Select, Stat, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { money } from '../format.js';

const devFields = [
  { name: 'name', label: 'Developer name', required: true }, { name: 'company', label: 'Company' }, { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email (becomes their portal login)', type: 'email' }, { name: 'ntn', label: 'NTN / tax ID' },
  { name: 'address', label: 'Address', full: true }, { name: 'bank_details', label: 'Bank details', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** "90:20, 180:15, after:10" <-> [{to_day:90,pct:20},{to_day:180,pct:15},{pct:10}] */
const tiersToText = (json) => { try { return JSON.parse(json || '[]').map((t) => (t.to_day ? `${t.to_day}:${t.pct}` : `after:${t.pct}`)).join(', '); } catch { return ''; } };
const textToTiers = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const [a, b] = x.split(':').map((s) => s.trim());
  if (b === undefined || Number.isNaN(Number(b))) throw new Error('Write deduction tiers like 90:20, 180:15, after:10 (days since booking : percent)');
  return /^after$/i.test(a) ? { pct: Number(b) } : { to_day: Number(a), pct: Number(b) };
});

const agreementFields = [
  { name: 'title', label: 'Agreement title', required: true, full: true },
  { name: 'pricing_basis', label: 'Pricing basis', type: 'select', allowEmpty: false, options: [{ value: 'per_sqft', label: 'Per sqft' }, { value: 'per_plot', label: 'Per plot' }] },
  { name: 'developer_rate', label: 'Developer rate', type: 'number' }, { name: 'company_rate', label: 'Company sale rate', type: 'number' },
  { name: 'rebate_basis', label: 'Rebate basis', type: 'select', allowEmpty: false, options: [{ value: 'percent_of_payment', label: 'Percent of each payment' }, { value: 'spread', label: 'Spread between the two rates' }] },
  { name: 'rebate_down_pct', label: 'Rebate on down payment %', type: 'number', min: 0, max: 100 }, { name: 'rebate_installment_pct', label: 'Rebate on installments %', type: 'number', min: 0, max: 100 },
  { name: 'rebate_balloon_pct', label: 'Rebate on balloon payments %', type: 'number', min: 0, max: 100 },
  { name: 'cancel_window_days', label: 'Cancellation window (days)', type: 'number', min: 0 },
  { name: 'tiers_text', label: 'Deduction on down payment (days:percent)', placeholder: '90:20, 180:15, after:10', full: true },
  { name: 'effective_from', label: 'Effective from', type: 'date' }, { name: 'effective_to', label: 'Effective to', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];

export function DeveloperList() {
  return (
    <ResourcePage title="Developers" sub="Partner developers whose plots the company sells under a joint venture" endpoint="/api/developers" module="developers" noun="developer" tableId="developers" exportName="developers"
      fields={devFields} defaults={{}}
      columns={[{ key: 'name', label: 'Developer', render: (r) => <div><Link to={`/developers/${r.id}`} className="cell-main">{r.name}</Link><div className="cell-sub">{r.company || r.phone || ''}</div></div> },
        { key: 'plots', label: 'Plots', num: true }, { key: 'files', label: 'Files sold', num: true },
        { key: 'contract_value', label: 'Contract value', num: true, render: (r) => money(r.contract_value) }, { key: 'collected', label: 'Collected by developer', num: true, render: (r) => money(r.collected) },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }]}
      rowActions={(r) => <Link to={`/developers/${r.id}`}>Open</Link>} canDeleteRow={() => false} />
  );
}

const rebateText = (p) => (!p.rebate_type ? 'Agreement rates' : p.rebate_type === 'percent' ? `${p.rebate_value}% · ${money(p.rebate_amount)}` : money(p.rebate_value));

function RebateInputs({ rebate, setRebate }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Select value={rebate.rebate_type || ''} onChange={(v) => setRebate({ rebate_type: v || '', rebate_value: v ? rebate.rebate_value : '' })} placeholder="Agreement rates"
        options={[{ value: 'percent', label: 'Percent of price' }, { value: 'fixed', label: 'Fixed amount' }]} />
      {rebate.rebate_type ? <input className="input" type="number" min="0" step="any" value={rebate.rebate_value ?? ''} onChange={(e) => setRebate({ ...rebate, rebate_value: e.target.value })} placeholder={rebate.rebate_type === 'percent' ? '%' : 'Amount'} /> : null}
    </div>
  );
}

/** Pick already-added properties and link them to this developer (with an optional rebate for all of them). */
function LinkPlotsModal({ developer, agreements, onClose, onDone }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState([]);
  const [agreementId, setAgreementId] = useState(agreements.find((a) => a.status === 'active')?.id || null);
  const [rebate, setRebate] = useState({ rebate_type: '', rebate_value: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => api.get(`/api/developers/${developer.id}/linkable-plots?q=${encodeURIComponent(q)}`).then(setRows).catch((e) => toast(e.message, 'error')), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line
  const toggle = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const save = async () => {
    setBusy(true);
    try {
      const out = await api.post(`/api/developers/${developer.id}/link-plots`, { property_ids: picked, agreement_id: agreementId, ...(rebate.rebate_type ? rebate : {}) });
      toast(`${out.linked.length} plot${out.linked.length === 1 ? '' : 's'} linked${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}`); onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Link plots to ${developer.name}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !picked.length || !agreementId} onClick={save}>{`Link ${picked.length || ''} plot${picked.length === 1 ? '' : 's'}`}</button></>}>
      {agreements.filter((a) => a.status === 'active').length === 0 ? <div className="alert err">Add an active agreement first.</div> : (
        <div className="form-grid">
          <label className="field"><span className="label">Agreement</span><Select value={agreementId} onChange={(v) => setAgreementId(v ? Number(v) : null)} allowEmpty={false} options={agreements.filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: a.title }))} /></label>
          <label className="field"><span className="label">Rebate for these plots (optional)</span><RebateInputs rebate={rebate} setRebate={setRebate} /></label>
        </div>)}
      <input className="input" style={{ margin: '12px 0' }} placeholder="Search by title, plot no, code or project" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty title="No unlinked plots found" hint="Only the company's own plots that are not sold or booked can be linked." /> : (
        <div style={{ maxHeight: 340, overflow: 'auto' }}>
          <table className="t"><thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={picked.length === rows.length} onChange={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.id))} /></th><th>Plot</th><th>Size</th><th>Price</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
                <td><input type="checkbox" aria-label={`Select ${p.title}`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                <td><div className="cell-main">{p.title}</div><div className="cell-sub">{[p.project_name, p.plot_no && `Plot ${p.plot_no}`, p.code].filter(Boolean).join(' · ')}</div></td>
                <td>{p.area_size} {p.unit}</td><td className="num">{money(p.net_price)}</td></tr>))}</tbody></table>
        </div>)}
    </Modal>
  );
}

export function DeveloperDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch(`/api/developers/${id}`);
  const plots = useFetch(`/api/developers/${id}/plots`);
  const [editing, setEditing] = useState(false);
  const [agreement, setAgreement] = useState(null); // {} for new, row for edit
  const [login, setLogin] = useState(null);
  const [linking, setLinking] = useState(false);
  const [sel, setSel] = useState([]);
  const [bulkRebate, setBulkRebate] = useState(null); // null = closed, else {rebate_type, rebate_value}
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const saveAgreement = async (f) => {
    const { tiers_text, ...rest } = f;
    const body = { ...rest, cancel_tiers: textToTiers(tiers_text) };
    if (agreement.id) await api.put(`/api/developers/${id}/agreements/${agreement.id}`, body); else await api.post(`/api/developers/${id}/agreements`, body);
    toast(agreement.id ? 'Agreement updated' : 'Agreement added'); setAgreement(null); reload();
  };
  const refresh = () => { reload(); plots.reload?.(); setSel([]); };
  const applyRebate = async () => {
    try {
      const out = await api.post(`/api/developers/${id}/plot-rebates`, { property_ids: sel, ...bulkRebate });
      toast(`Rebate set on ${out.updated.length} plot${out.updated.length === 1 ? '' : 's'}`); setBulkRebate(null); refresh();
    } catch (e) { toast(e.message, 'error'); }
  };
  const unlink = async () => {
    if (!window.confirm(`Return ${sel.length} plot${sel.length === 1 ? '' : 's'} to the company's own stock?`)) return;
    try { const out = await api.post(`/api/developers/${id}/unlink-plots`, { property_ids: sel }); toast(`${out.unlinked.length} returned${out.skipped.length ? `, ${out.skipped.length} skipped (sold or booked)` : ''}`); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const makeLogin = async () => {
    try { setLogin(await api.post(`/api/developers/${id}/portal-login`, {})); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <BackLink to="/developers">Developers</BackLink>
      <PageHead title={data.name} sub={[data.company, data.phone, data.email].filter(Boolean).join(' · ')}>
        {can('developers', 'edit') && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit</button>}
        {can('developers', 'edit') && <button className="btn" onClick={makeLogin}><Icon name="user" size={14} />{data.has_portal_login ? 'Reset portal password' : 'Create portal login'}</button>}
      </PageHead>
      <div className="grid g4">
        <Stat label="Plots" value={data.plots} /><Stat label="Files sold" value={data.files} />
        <Stat label="Contract value" value={money(data.contract_value)} /><Stat label="Collected by developer" value={money(data.collected)} />
        <Stat label="Plot rebate (all plots)" value={money(data.rebate_expected)} /><Stat label="Plot rebate (sold plots)" value={money(data.rebate_on_sold)} />
      </div>
      <div style={{ height: 12 }} />
      <Card title="Agreements" actions={can('developers', 'create') && <button className="btn primary" onClick={() => setAgreement({ pricing_basis: 'per_sqft', rebate_basis: 'percent_of_payment' })}>Add agreement</button>} flush>
        {data.agreements.length === 0 ? <Empty title="No agreements yet" hint="An agreement holds the rates, rebate percentages and cancellation terms. Add one before assigning plots to this developer." /> : (
          <table className="t"><thead><tr><th>Agreement</th><th>Rates</th><th>Rebate % (down / inst. / balloon)</th><th>Cancellation</th><th>Status</th><th /></tr></thead>
            <tbody>{data.agreements.map((a) => (
              <tr key={a.id}><td><div className="cell-main">{a.title}</div><div className="cell-sub">{a.project_name || 'All projects'}</div></td>
                <td>{a.developer_rate ?? '-'} / {a.company_rate ?? '-'}</td><td>{a.rebate_down_pct} / {a.rebate_installment_pct} / {a.rebate_balloon_pct}</td>
                <td>{a.cancel_window_days ? `${a.cancel_window_days} days` : 'No window'}<div className="cell-sub">{tiersToText(a.cancel_tiers)}</div></td>
                <td><StatusBadge status={a.status} /></td>
                <td>{can('developers', 'edit') && <button className="btn sm" onClick={() => setAgreement({ ...a, tiers_text: tiersToText(a.cancel_tiers) })}>Edit</button>}</td></tr>))}</tbody></table>)}
      </Card>
      <div style={{ height: 12 }} />
      <Card title="Plots and files" flush actions={can('developers', 'edit') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sel.length > 0 && <button className="btn" onClick={() => setBulkRebate({ rebate_type: 'percent', rebate_value: '' })}>Set rebate ({sel.length})</button>}
          {sel.length > 0 && <button className="btn" onClick={unlink}>Unlink ({sel.length})</button>}
          <button className="btn" onClick={() => setBulkRebate({ rebate_type: 'percent', rebate_value: '' })}>Rebate for all plots</button>
          <button className="btn primary" onClick={() => setLinking(true)}>Link existing plots</button>
        </div>)}>
        {!plots.data ? <Loading /> : plots.data.length === 0 ? <Empty title="No plots yet" hint="Use Link existing plots to attach properties you already added, or add a new property with source set to Developer." /> : (
          <table className="t"><thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all plots" checked={sel.length === plots.data.length} onChange={() => setSel(sel.length === plots.data.length ? [] : plots.data.map((p) => p.id))} /></th><th>Plot</th><th>Size</th><th>Price</th><th>Rebate</th><th>Status</th><th>Booking</th><th>Customer</th></tr></thead>
            <tbody>{plots.data.map((p) => (
              <tr key={p.id}><td><input type="checkbox" aria-label={`Select ${p.title}`} checked={sel.includes(p.id)} onChange={() => setSel((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} /></td><td><Link to={`/properties/${p.id}`} className="cell-main">{p.title}</Link><div className="cell-sub">{p.registration_no || p.code}</div></td>
                <td>{p.area_size} {p.unit}{p.area_sqft ? <div className="cell-sub">{p.area_sqft} sqft</div> : null}</td><td className="num">{money(p.net_price)}</td><td>{rebateText(p)}</td>
                <td><StatusBadge status={p.status} /></td><td>{p.sale_id ? <Link to={`/sales/${p.sale_id}`}>{p.booking_id}</Link> : '-'}</td><td>{p.customer_name || '-'}</td></tr>))}</tbody></table>)}
      </Card>
      {editing && <FormModal title="Edit developer" fields={devFields} initial={data} onClose={() => setEditing(false)} onSave={async (f) => { await api.put(`/api/developers/${id}`, f); toast('Saved'); setEditing(false); reload(); }} />}
      {agreement && <FormModal title={agreement.id ? 'Edit agreement' : 'Add agreement'} fields={agreementFields} initial={agreement} onClose={() => setAgreement(null)} onSave={saveAgreement} />}
      {linking && <LinkPlotsModal developer={data} agreements={data.agreements} onClose={() => setLinking(false)} onDone={() => { setLinking(false); refresh(); }} />}
      {bulkRebate && (
        <Modal title={sel.length ? `Set rebate on ${sel.length} selected plot${sel.length === 1 ? '' : 's'}` : 'Set rebate on all of this developer’s plots'} onClose={() => setBulkRebate(null)}
          footer={<><button className="btn" onClick={() => setBulkRebate(null)}>Cancel</button><button className="btn primary" onClick={applyRebate}>Apply rebate</button></>}>
          <p>The rebate is what the developer pays the company for each plot, as a percent of the plot price or a fixed amount. Choose “Agreement rates” to clear it.</p>
          <RebateInputs rebate={bulkRebate} setRebate={setBulkRebate} />
        </Modal>)}
      {login && (
        <Modal title="Developer portal login" onClose={() => setLogin(null)} footer={<button className="btn primary" onClick={() => setLogin(null)}>Done</button>}>
          <p>Share these details with the developer. The password is shown only now.</p>
          <p><b>Login:</b> {login.login}<br /><b>Password:</b> {login.password}</p>
        </Modal>)}
    </div>
  );
}
