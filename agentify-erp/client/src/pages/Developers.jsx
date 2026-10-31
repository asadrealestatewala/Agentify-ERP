import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { BackLink, Card, Empty, Loading, Modal, PageHead, Stat, StatusBadge } from '../components/ui.jsx';
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

export function DeveloperDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch(`/api/developers/${id}`);
  const plots = useFetch(`/api/developers/${id}/plots`);
  const [editing, setEditing] = useState(false);
  const [agreement, setAgreement] = useState(null); // {} for new, row for edit
  const [login, setLogin] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const saveAgreement = async (f) => {
    const { tiers_text, ...rest } = f;
    const body = { ...rest, cancel_tiers: textToTiers(tiers_text) };
    if (agreement.id) await api.put(`/api/developers/${id}/agreements/${agreement.id}`, body); else await api.post(`/api/developers/${id}/agreements`, body);
    toast(agreement.id ? 'Agreement updated' : 'Agreement added'); setAgreement(null); reload();
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
      <Card title="Plots and files" flush>
        {!plots.data ? <Loading /> : plots.data.length === 0 ? <Empty title="No plots yet" hint="Add a property and set its source to Developer to list it here." /> : (
          <table className="t"><thead><tr><th>Plot</th><th>Size</th><th>Price</th><th>Status</th><th>Booking</th><th>Customer</th></tr></thead>
            <tbody>{plots.data.map((p) => (
              <tr key={p.id}><td><Link to={`/properties/${p.id}`} className="cell-main">{p.title}</Link><div className="cell-sub">{p.registration_no || p.code}</div></td>
                <td>{p.area_size} {p.unit}{p.area_sqft ? <div className="cell-sub">{p.area_sqft} sqft</div> : null}</td><td className="num">{money(p.net_price)}</td>
                <td><StatusBadge status={p.status} /></td><td>{p.sale_id ? <Link to={`/sales/${p.sale_id}`}>{p.booking_id}</Link> : '-'}</td><td>{p.customer_name || '-'}</td></tr>))}</tbody></table>)}
      </Card>
      {editing && <FormModal title="Edit developer" fields={devFields} initial={data} onClose={() => setEditing(false)} onSave={async (f) => { await api.put(`/api/developers/${id}`, f); toast('Saved'); setEditing(false); reload(); }} />}
      {agreement && <FormModal title={agreement.id ? 'Edit agreement' : 'Add agreement'} fields={agreementFields} initial={agreement} onClose={() => setAgreement(null)} onSave={saveAgreement} />}
      {login && (
        <Modal title="Developer portal login" onClose={() => setLogin(null)} footer={<button className="btn primary" onClick={() => setLogin(null)}>Done</button>}>
          <p>Share these details with the developer. The password is shown only now.</p>
          <p><b>Login:</b> {login.login}<br /><b>Password:</b> {login.password}</p>
        </Modal>)}
    </div>
  );
}
