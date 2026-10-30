import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable, ViewsBar } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import { InstallmentTable, SaleLedgerSummary } from '../components/SaleBits.jsx';
import { ScheduleManager } from '../components/Schedule.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { BackLink, Card, ConfirmDialog, CurrencyInput, Field, KV, Loading, PageHead, ProgressBar, Select, StatusBadge, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, todayPK } from '../format.js';
import { celebrate } from '../celebrate.js';
import { PaymentFields, emptyPayment } from './Receipts.jsx';
import CustomerPicker from '../components/CustomerPicker.jsx';
import PropertyPicker from '../components/PropertyPicker.jsx';
import ChecklistCard from '../components/ChecklistCard.jsx';

export const KindBadge = ({ kind }) => (kind === 'construction' ? <span className="pill purple">Construction</span> : <span className="pill blue">Property</span>);

export function SaleList({ kind }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const { projects, agents } = useLookups();
  const t = useTable('/api/sales', { filters: { kind }, viewsKey: `sales-${kind || 'all'}` });
  const construction = kind === 'construction';
  return (
    <div>
      <PageHead title={construction ? 'Construction contracts' : 'Sales & bookings'} sub={`${t.total} ${construction ? 'contract' : 'sale'}(s)`}>
        {can('sales', 'create') && <Link className="btn" to="/sales/new?type=construction"><Icon name="hardhat" size={14} />New construction contract</Link>}
        {can('sales', 'create') && <Link className="btn primary" to="/sales/new"><Icon name="plus" size={14} />New property sale</Link>}
      </PageHead>
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search sale, customer, plot, contract…" />
          {!kind && <div style={{ width: 150 }}><Select value={t.extra.kind || ''} onChange={(v) => t.setFilter({ kind: v })} placeholder="All types" options={[{ value: 'property', label: 'Property sales' }, { value: 'construction', label: 'Construction contracts' }]} /></div>}
          <div style={{ width: 170 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div>
          {can('sales', 'approve') && <div style={{ width: 170 }}><Select value={t.extra.agent_id || ''} onChange={(v) => t.setFilter({ agent_id: v })} placeholder="All agents" options={agents.map((p) => ({ value: p.id, label: p.name }))} /></div>}
          <div style={{ width: 150 }}><Select value={t.extra.status || ''} onChange={(v) => t.setFilter({ status: v })} placeholder="All statuses" options={['confirmed', 'cancelled']} /></div>
          <div className="grow" /><ExportMenu url="/api/sales" params={t.params} name="sales" module="sales" /></div>
        <ViewsBar t={t} />
        <DataTable {...t.tableProps} onRowClick={(r) => nav(`/sales/${r.id}`)} columns={[
          { key: 'sale_no', label: 'Sale', render: (r) => <span>{r.sale_no}{r.bundle_id ? <span className="tag" title="Paid together with another sale" style={{ marginLeft: 6 }}>combined</span> : null}{r.is_demo ? <span className="demo-chip">DEMO</span> : null}</span> },
          { key: 'kind', label: 'Type', render: (r) => <KindBadge kind={r.kind} /> }, { key: 'sale_date', label: 'Date', render: (r) => date(r.sale_date) },
          { key: 'customer_name', label: 'Customer', render: (r) => <Link to={`/contacts/${r.contact_id}`} onClick={(e) => e.stopPropagation()}>{r.customer_name}</Link> },
          { key: 'property_title', label: 'Property / contract' }, { key: 'project_name', label: 'Project' },
          { key: 'net_price', label: 'Net value', num: true, render: (r) => money(r.net_price) }, { key: 'paid_amount', label: 'Paid', num: true, render: (r) => money(r.paid_amount) },
          { key: 'outstanding', label: 'Balance', num: true, render: (r) => money(r.outstanding) }, { key: 'agent_name', label: 'Agent' }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }]} />
      </Card>
    </div>
  );
}

const emptyHouse = { enabled: false, project_id: '', title: '', sale_price: '', discount: 0, booking_amount: '', installment_amount: '' };

/** Merge two payment plans month by month for a "what the customer pays each month" preview. */
function mergePlans(a, b) {
  const m = new Map();
  [[a, 'Plot'], [b, 'Construction']].forEach(([plan, label]) => (plan?.rows || []).forEach((r) => {
    const row = m.get(r.due_date) || { due_date: r.due_date, total: 0, parts: [] };
    row.total += r.amount; row.parts.push({ label, kind: r.kind, amount: r.amount }); m.set(r.due_date, row);
  }));
  return [...m.values()].sort((x, y) => x.due_date.localeCompare(y.due_date));
}

export function SaleForm() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can, user } = useAuth();
  const { agents, projects, treasury } = useLookups();
  const constructionProjects = projects.filter((p) => p.kind === 'construction');
  const [mode, setMode] = useState(sp.get('type') === 'construction' ? 'construction' : 'property');
  const [f, setF] = useState({ contact_id: Number(sp.get('contact')) || '', property_id: Number(sp.get('property')) || '', sale_date: todayPK(), sale_price: '', discount: 0, booking_amount: '', advance_amount: '', num_installments: 12, installment_amount: '', balloon_count: 0, balloon_amount: '', balloon_interval: 6, first_due: '', agent_id: '', notes: '', title: '', project_id: '', linked_sale_id: '' });
  const [h, setH] = useState(emptyHouse);
  const [collect, setCollect] = useState(false);
  const [pay, setPay] = useState({ ...emptyPayment, method: 'Cash' });
  const [contacts, setContacts] = useState([]);
  const [props, setProps] = useState([]);
  const [plotSales, setPlotSales] = useState([]);
  const [plan, setPlan] = useState(null);
  const [housePlan, setHousePlan] = useState(null);
  const [planErr, setPlanErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const isHouse = mode === 'construction';

  useEffect(() => { api.get('/api/properties', { limit: 300, status: 'available,featured,reserved' }).then((r) => setProps(r.rows.filter((p) => ['available', 'featured', 'reserved'].includes(p.status)))).catch(() => {}); }, []);
  useEffect(() => { if (f.contact_id && !contacts.find((c) => c.id === f.contact_id)) api.get(`/api/contacts/${f.contact_id}/workspace`).then((w) => setContacts((c) => [w.contact, ...c])).catch(() => {}); /* eslint-disable-next-line */ }, [f.contact_id]);
  // the customer's existing plot purchases — a construction contract can be linked to one (no re-entry)
  useEffect(() => { if (!f.contact_id) { setPlotSales([]); return; } api.get('/api/sales', { contact_id: f.contact_id, kind: 'property', status: 'confirmed', limit: 50 }).then((r) => setPlotSales(r.rows)).catch(() => {}); }, [f.contact_id]);
  const prop = props.find((p) => p.id === f.property_id);
  const contact = contacts.find((c) => c.id === f.contact_id);
  useEffect(() => { if (!isHouse && prop) setF((x) => ({ ...x, sale_price: prop.total_price, discount: prop.discount, agent_id: x.agent_id || contact?.agent_id || prop.agent_id || '' })); /* eslint-disable-next-line */ }, [f.property_id]);
  useEffect(() => { if (contact && !f.agent_id && contact.agent_id) set('agent_id', contact.agent_id); /* eslint-disable-next-line */ }, [contact]);
  useEffect(() => { if (user.own_scope) set('agent_id', user.id); /* eslint-disable-next-line */ }, []);
  // house contract title defaults from the plot
  useEffect(() => { if (!isHouse && h.enabled && !h.title && prop) setH((x) => ({ ...x, title: `House construction — ${prop.title}` })); /* eslint-disable-next-line */ }, [h.enabled, f.property_id]);

  const linkPlot = (saleId) => {
    const ps = plotSales.find((s) => s.id === Number(saleId));
    if (!ps) { setF((x) => ({ ...x, linked_sale_id: '', property_id: '' })); return; }
    // pull everything from the existing plot sale so nothing is typed twice
    api.get(`/api/sales/${ps.id}`).then((r) => {
      const s = r.sale; const inst = s.installments.filter((i) => i.kind === 'installment');
      setF((x) => ({ ...x, linked_sale_id: s.id, property_id: s.property_id, agent_id: s.agent_id || x.agent_id, num_installments: s.num_installments || x.num_installments, first_due: inst[0]?.due_date || x.first_due,
        title: x.title || `House construction — ${s.property_title}`, project_id: x.project_id }));
    }).catch(() => {});
  };

  const net = (Number(f.sale_price) || 0) - (Number(f.discount) || 0);
  const upfront = (Number(f.booking_amount) || 0) + (Number(f.advance_amount) || 0);
  const remaining = net - upfront;
  const balloonTotal = (Number(f.balloon_count) || 0) * (Number(f.balloon_amount) || 0);
  const suggested = Number(f.num_installments) > 0 ? Math.round((remaining - balloonTotal) / Number(f.num_installments)) : 0;

  const previewBody = { ...f, installment_amount: f.installment_amount || undefined };
  useEffect(() => {
    if (!f.sale_price) { setPlan(null); setPlanErr(''); return undefined; }
    const t = setTimeout(async () => { try { setPlan(await api.post('/api/sales/preview', previewBody)); setPlanErr(''); } catch (e) { setPlan(null); setPlanErr(e.message); } }, 300);
    return () => clearTimeout(t);
  }, [f.sale_price, f.discount, f.booking_amount, f.advance_amount, f.num_installments, f.installment_amount, f.balloon_count, f.balloon_amount, f.balloon_interval, f.first_due, f.sale_date]); // eslint-disable-line
  const houseBody = { sale_price: h.sale_price, discount: h.discount, booking_amount: h.booking_amount, num_installments: f.num_installments, installment_amount: h.installment_amount || undefined, first_due: f.first_due, sale_date: f.sale_date };
  useEffect(() => {
    if (isHouse || !h.enabled || !h.sale_price) { setHousePlan(null); return undefined; }
    const t = setTimeout(async () => { try { setHousePlan(await api.post('/api/sales/preview', houseBody)); } catch { setHousePlan(null); } }, 300);
    return () => clearTimeout(t);
  }, [h.enabled, h.sale_price, h.discount, h.booking_amount, h.installment_amount, f.num_installments, f.first_due, f.sale_date, isHouse]); // eslint-disable-line
  const merged = !isHouse && h.enabled && plan && housePlan ? mergePlans(plan, housePlan) : null;

  const submit = async () => {
    if (!f.contact_id) return toast('Select a customer', 'err');
    if (!isHouse && !f.property_id) return toast('Select a property', 'err');
    if (isHouse && !f.project_id) return toast('Select the construction project', 'err');
    setBusy(true);
    try {
      const body = { ...f, installment_amount: f.installment_amount || undefined, kind: isHouse ? 'construction' : 'property', linked_sale_id: f.linked_sale_id || undefined, property_id: f.property_id || undefined, project_id: isHouse ? f.project_id : undefined };
      if (!isHouse && h.enabled) body.construction = { project_id: h.project_id, title: h.title, sale_price: h.sale_price, discount: h.discount, booking_amount: h.booking_amount, installment_amount: h.installment_amount || undefined };
      if (collect && can('payments', 'create') && Number(f.booking_amount) > 0) body.collect_booking = { account_id: pay.account_id, method: pay.method, bank: pay.bank, txn_id: pay.txn_id, cheque_no: pay.cheque_no, reference_no: pay.reference_no };
      const created = await api.post('/api/sales', body);
      setDone(created); celebrate();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (done) {
    const many = done.sales?.length > 1;
    return (
      <div style={{ maxWidth: 680, margin: '40px auto' }}>
        <Card title={many ? 'Plot sale and construction contract created' : isHouse ? 'Construction contract created' : 'Sale created'}>
          <div className="stack">
            <div className="alert ok">{done.sales.map((s) => s.sale_no).join(' + ')} confirmed. {many ? 'Both share one combined payment plan — a single monthly receipt is split between them automatically. ' : ''}{!isHouse && 'The property is now Sold. '}The contact is a Customer, the installment plan and receivable ledger are created, and the agent commission has been generated for approval.</div>
            {done.portal && <div className="alert info"><b>Customer portal login created</b><br />Login: <code>{done.portal.login}</code> · Password: <code>{done.portal.password}</code><br /><span className="muted">Shown only once — share it securely.</span></div>}
            <div className="row wrap">{done.sales.map((s) => <Link key={s.id} className="btn primary" to={`/sales/${s.id}`}>{s.kind === 'construction' ? 'Open contract' : 'Open sale'} {s.sale_no}</Link>)}<Link className="btn" to={`/contacts/${done.sale.contact_id}`}>Open customer</Link>
              {can('payments', 'create') && <Link className="btn" to={`/receipts/new?contact=${done.sale.contact_id}&sale=${done.id}`}>Record payment</Link>}
              {isHouse && can('projects', 'create') && <Link className="btn" to={`/projects/${done.sale.project_id}?tab=schedule&scope=${done.id}`}>Plan the build schedule</Link>}</div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <BackLink to="/sales">Sales</BackLink>
      <PageHead title={isHouse ? 'New construction contract' : 'New property sale'} sub="Creates the contract, payment schedule, receivable ledger and agent commission in one step — nothing is entered twice." />
      <div className="top-tabs">
        <button className={`chip ${!isHouse ? 'active' : ''}`} onClick={() => setMode('property')}>Property sale (plot / house / shop)</button>
        <button className={`chip ${isHouse ? 'active' : ''}`} onClick={() => setMode('construction')}>Construction contract (house building)</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(300px,2fr)', alignItems: 'start' }}>
        <div className="stack">
          <Card title="Customer">
            <div className="form-grid">
              <Field label="Customer" required className="full" hint="Start typing a name, phone or CNIC — or add a new customer right here; they are saved to Contacts automatically.">
                <CustomerPicker value={f.contact_id} onChange={(id, c) => { if (c) setContacts((x) => [c, ...x.filter((y) => y.id !== c.id)]); set('contact_id', id); set('linked_sale_id', ''); }} autoFocus={!f.contact_id} />
              </Field>
              {!isHouse && <Field label="Property" required className="full"><PropertyPicker value={f.property_id} statuses={['available', 'featured', 'reserved']} onChange={(id) => set('property_id', id ? Number(id) : '')} /></Field>}
              {isHouse && (<>
                <Field label="Construction project" required><Select allowEmpty={false} value={f.project_id} onChange={(v) => set('project_id', Number(v))} options={[{ value: '', label: 'Select project…' }, ...(constructionProjects.length ? constructionProjects : projects).map((p) => ({ value: p.id, label: p.name }))]} hint="Projects of type “construction”" /></Field>
                <Field label="Contract title" required><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="House construction — Plot 7C" /></Field>
                <Field label="Customer’s plot (optional)" hint={plotSales.length ? 'Bought from us? Link it — dates, installments and agent are copied and both are paid together.' : 'This customer has no plot purchase from us (own land).'} className="full">
                  <Select value={f.linked_sale_id} onChange={linkPlot} options={plotSales.map((s) => ({ value: s.id, label: `${s.property_title} · ${s.sale_no}` }))} placeholder="Own land — no linked plot" />
                </Field>
              </>)}
              <Field label="Sale date"><input className="input" type="date" value={f.sale_date} onChange={(e) => set('sale_date', e.target.value)} /></Field>
              <Field label="Sales agent (earns the commission)"><Select value={f.agent_id} onChange={(v) => set('agent_id', v ? Number(v) : '')} options={agents.map((a) => ({ value: a.id, label: a.name }))} disabled={user.own_scope} placeholder="No agent (no commission)" /></Field>
            </div>
          </Card>
          <Card title={isHouse ? 'Contract value' : 'Pricing'}>
            <div className="form-grid">
              <Field label={isHouse ? 'Contract value' : 'Sale price'} required><CurrencyInput value={f.sale_price} onChange={(v) => set('sale_price', v)} /></Field>
              <Field label="Discount"><CurrencyInput value={f.discount} onChange={(v) => set('discount', v === '' ? 0 : v)} /></Field>
              <Field label="Net value" hint="Price − discount"><CurrencyInput value={net} onChange={() => {}} disabled /></Field>
              <Field label="Booking amount"><CurrencyInput value={f.booking_amount} onChange={(v) => set('booking_amount', v)} /></Field>
              <Field label="Advance payment (additional)"><CurrencyInput value={f.advance_amount} onChange={(v) => set('advance_amount', v)} /></Field>
              <Field label="Remaining after booking"><CurrencyInput value={Math.max(0, remaining)} onChange={() => {}} disabled /></Field>
            </div>
          </Card>
          <Card title="Installment plan">
            <div className="form-grid">
              <Field label="Number of installments"><input className="input" type="number" min="0" max="240" value={f.num_installments} onChange={(e) => set('num_installments', e.target.value === '' ? '' : Number(e.target.value))} /></Field>
              <Field label="Installment amount" hint={suggested ? `Suggested ${money(suggested)} (last installment absorbs rounding)` : ''}><CurrencyInput value={f.installment_amount} onChange={(v) => set('installment_amount', v)} /></Field>
              <Field label="Balloon payments (count)"><input className="input" type="number" min="0" max="20" value={f.balloon_count} onChange={(e) => set('balloon_count', e.target.value === '' ? 0 : Number(e.target.value))} /></Field>
              <Field label="Balloon amount (each)"><CurrencyInput value={f.balloon_amount} onChange={(v) => set('balloon_amount', v)} /></Field>
              <Field label="Balloon every (months)"><input className="input" type="number" min="1" value={f.balloon_interval} onChange={(e) => set('balloon_interval', Number(e.target.value) || 6)} /></Field>
              <Field label="First due date" hint="Date of the first installment"><input className="input" type="date" value={f.first_due} onChange={(e) => set('first_due', e.target.value)} /></Field>
            </div>
          </Card>

          {!isHouse && (
            <Card title="Also build a house on this plot?" actions={<label className="check"><input type="checkbox" checked={h.enabled} onChange={(e) => setH({ ...h, enabled: e.target.checked })} />Add a construction contract</label>}>
              {!h.enabled ? <span className="muted">Customers who buy a plot and also have us build on it pay one monthly amount that is split between the plot and the house. Tick to create both together — the customer, plot, agent, dates and number of installments are reused.</span> : (
                <div className="stack">
                  <div className="form-grid">
                    <Field label="Construction project" required><Select allowEmpty={false} value={h.project_id} onChange={(v) => setH({ ...h, project_id: Number(v) })} options={[{ value: '', label: 'Select project…' }, ...(constructionProjects.length ? constructionProjects : projects).map((p) => ({ value: p.id, label: p.name }))]} /></Field>
                    <Field label="Contract title"><input className="input" value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} /></Field>
                    <Field label="Contract value" required><CurrencyInput value={h.sale_price} onChange={(v) => setH({ ...h, sale_price: v })} /></Field>
                    <Field label="Discount"><CurrencyInput value={h.discount} onChange={(v) => setH({ ...h, discount: v === '' ? 0 : v })} /></Field>
                    <Field label="Booking amount"><CurrencyInput value={h.booking_amount} onChange={(v) => setH({ ...h, booking_amount: v })} /></Field>
                    <Field label="Monthly installment (construction share)" hint={`Uses the same ${f.num_installments || 0} installments and due dates as the plot`}><CurrencyInput value={h.installment_amount} onChange={(v) => setH({ ...h, installment_amount: v })} /></Field>
                  </div>
                  {plan && housePlan && <div className="alert info">Customer pays <b>{money((plan.installment_amount || 0) + (housePlan.installment_amount || 0))}</b> per month — {money(plan.installment_amount || 0)} to the plot and {money(housePlan.installment_amount || 0)} to the construction.</div>}
                </div>
              )}
            </Card>
          )}

          {can('payments', 'create') && Number(f.booking_amount) > 0 && (
            <Card title="Collect the booking amount now?" actions={<label className="check"><input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />Record receipt</label>}>
              {collect ? <PaymentFields p={pay} set={(k, v) => setPay((x) => ({ ...x, [k]: v }))} treasury={treasury} hideAmount /> : <span className="muted">Leave unchecked to record the booking payment later as a receipt voucher.</span>}
            </Card>
          )}
          <Card title="Notes"><textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Agreement reference, special terms, scope of work…" /></Card>
        </div>
        <div className="stack" style={{ position: 'sticky', top: 0 }}>
          <Card title={merged ? 'Combined monthly schedule' : isHouse ? 'Contract payment schedule' : 'Payment schedule preview'} flush>
            {planErr && <div className="alert err" style={{ margin: 12 }}>{planErr}</div>}
            {merged ? (
              <div style={{ maxHeight: 420, overflow: 'auto' }}><table className="t"><thead><tr><th>Due</th><th className="num">Plot</th><th className="num">House</th><th className="num">Total</th></tr></thead>
                <tbody>{merged.map((r) => { const g = (l) => r.parts.filter((p) => p.label === l).reduce((a, p) => a + p.amount, 0); return <tr key={r.due_date}><td>{date(r.due_date)}</td><td className="num mono">{g('Plot') ? money(g('Plot')) : ''}</td><td className="num mono">{g('Construction') ? money(g('Construction')) : ''}</td><td className="num mono bold">{money(r.total)}</td></tr>; })}</tbody>
                <tfoot><tr><td>Total</td><td className="num mono">{money(plan.net)}</td><td className="num mono">{money(housePlan.net)}</td><td className="num mono">{money(plan.net + housePlan.net)}</td></tr></tfoot></table></div>
            ) : plan ? (
              <div style={{ maxHeight: 420, overflow: 'auto' }}><table className="t"><thead><tr><th>#</th><th>Type</th><th>Due</th><th className="num">Amount</th></tr></thead>
                <tbody>{plan.rows.map((r) => <tr key={r.seq}><td>{r.seq}</td><td className="nowrap">{r.kind}</td><td>{date(r.due_date)}</td><td className="num mono">{money(r.amount)}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={3}>Net</td><td className="num mono">{money(plan.net)}</td></tr></tfoot></table></div>
            ) : !planErr && <div className="empty">Enter a price to preview the schedule.</div>}
          </Card>
          <div className="row"><Link className="btn" to="/sales">Cancel</Link><div className="grow" /><button className="btn primary" style={{ height: 40 }} disabled={busy || !plan} onClick={submit}>{busy ? 'Creating…' : !isHouse && h.enabled ? 'Confirm plot + construction' : isHouse ? 'Confirm contract' : 'Confirm sale'}</button></div>
          <div className="faint" style={{ fontSize: 11.5 }}>On confirm: {isHouse ? 'revenue booked to Construction Contract Income under the project' : 'property → Sold'} · contact → Customer · ledger Dr Receivable / Cr Income · commission generated by the active rule for this sale type.</div>
        </div>
      </div>
    </div>
  );
}

export function SaleDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch(`/api/sales/${id}`);
  const [cancel, setCancel] = useState(false);
  const tab = sp.get('tab') || 'plan';
  const setTab = (t) => setSp({ tab: t }, { replace: true });
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const s = data.sale;
  const b = s.bundle;
  const construction = s.kind === 'construction';
  const contracts = [{ id: s.id, customer: s.customer_name, title: s.title, sale_no: s.sale_no }];
  return (
    <div>
      <BackLink to={construction ? '/sales/construction' : '/sales'}>{construction ? 'Construction contracts' : 'Sales'}</BackLink>
      <PageHead title={<span>{s.sale_no} <KindBadge kind={s.kind} /> <StatusBadge status={s.status} /></span>}
        sub={<span>{s.property_id && !construction ? <Link to={`/properties/${s.property_id}`}>{s.property_title}</Link> : s.property_title} · <Link to={`/contacts/${s.contact_id}`}>{s.customer_name}</Link>{s.project_name && <> · <Link to={`/projects/${s.project_id}`}>{s.project_name}</Link></>}{construction && s.property_id && <> · plot <Link to={`/properties/${s.property_id}`}>{s.plot_no || 'view'}</Link></>}</span>}>
        {s.status === 'confirmed' && (b ? b.outstanding : s.outstanding) > 0 && can('payments', 'create') && <Link className="btn primary" to={`/receipts/new?contact=${s.contact_id}&sale=${s.id}`}>{b ? 'Receive combined payment' : 'Record payment'}</Link>}
        {can('customers', 'view') && !user.own_scope && <Link className="btn" to={`/customers/${s.contact_id}/statement?sale=${s.id}`}><Icon name="print" size={14} />Statement</Link>}
        {s.status === 'confirmed' && can('sales', 'delete') && <button className="btn danger" onClick={() => setCancel(true)}>Cancel {construction ? 'contract' : 'sale'}</button>}
      </PageHead>

      {b && (
        <Card title="Combined payment plan" actions={<span className="pill blue">{b.sales.length} sales paid together</span>} >
          <div className="grid g4" style={{ marginBottom: 10 }}>
            <div className="sum-box"><div className="l">Combined monthly installment</div><div className="v">{money(b.monthly_total)}</div></div>
            <div className="sum-box"><div className="l">Combined value</div><div className="v">{money(b.net_price)}</div></div>
            <div className="sum-box"><div className="l">Paid</div><div className="v pos">{money(b.paid_amount)}</div></div>
            <div className="sum-box"><div className="l">Outstanding</div><div className="v warn">{money(b.outstanding)}</div></div>
          </div>
          <table className="t"><thead><tr><th>Sale</th><th>For</th><th className="num">Monthly share</th><th className="num">Net value</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>{b.sales.map((x) => <tr key={x.id} style={x.id === s.id ? { background: 'var(--primary-l)' } : undefined}><td><Link to={`/sales/${x.id}`}>{x.sale_no}</Link> <KindBadge kind={x.kind} /></td><td>{x.title}</td><td className="num mono">{money(x.installment_amount)}</td><td className="num mono">{money(x.net_price)}</td><td className="num mono">{money(x.paid_amount)}</td><td className="num mono">{money(x.outstanding)}</td></tr>)}</tbody></table>
        </Card>
      )}
      <div style={{ height: 12 }} />
      <Card><SaleLedgerSummary s={s} /></Card>
      <ChecklistCard entity="sale" id={s.id} />
      {construction && data.schedule && data.schedule.tasks > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div className="row between"><b>Build progress</b><span className={`pill ${data.schedule.health === 'on_track' ? 'green' : data.schedule.health === 'at_risk' ? 'amber' : 'red'}`}>{data.schedule.health.replace('_', ' ')}{data.schedule.projected_delay_days > 0 ? ` · +${data.schedule.projected_delay_days}d` : ''}</span></div>
          <div className="row" style={{ marginTop: 8 }}><div className="grow"><ProgressBar value={data.schedule.actual_pct} /></div><b>{data.schedule.actual_pct}%</b><span className="muted">planned {data.schedule.planned_pct}%</span></div>
        </div>
      )}
      <div style={{ height: 12 }} />
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'plan', label: 'Payment plan' }, ...(b ? [{ key: 'combined', label: 'Combined schedule' }] : []),
          ...(data.receipts ? [{ key: 'receipts', label: 'Receipts', count: data.receipts.length }, { key: 'ledger', label: b ? 'Ledger (this sale)' : 'Customer ledger' }, ...(b ? [{ key: 'bledger', label: 'Combined ledger' }] : [])] : []),
          ...(construction ? [{ key: 'schedule', label: 'Build schedule' }, { key: 'costs', label: 'Contract costs', count: data.costs?.length }] : []),
          { key: 'info', label: 'Details' }, { key: 'docs', label: 'Agreement & documents', count: data.documents.length }]} />
        <div className="card-b flush" style={{ padding: ['plan', 'combined'].includes(tab) ? 0 : 16 }}>
          {tab === 'plan' && <InstallmentTable rows={s.installments} />}
          {tab === 'combined' && b && (
            <div className="table-wrap"><table className="t"><thead><tr><th>Due date</th>{b.sales.map((x) => <th key={x.id} className="num">{x.kind === 'construction' ? 'Construction' : 'Plot'}</th>)}<th className="num">Total due</th><th className="num">Paid</th><th>Status</th></tr></thead>
              <tbody>{b.schedule.map((m) => <tr key={m.due_date}><td>{date(m.due_date)}</td>{b.sales.map((x) => { const part = m.parts.filter((p) => p.sale_id === x.id); const amt = part.reduce((a, p) => a + p.amount, 0); return <td key={x.id} className="num mono">{amt ? money(amt) : ''}</td>; })}<td className="num mono bold">{money(m.amount)}</td><td className="num mono">{money(m.paid)}</td><td><StatusBadge status={m.status} /></td></tr>)}</tbody></table></div>
          )}
          {tab === 'receipts' && (<table className="t"><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Method</th><th>Deposited to</th><th className="num">This sale’s share</th><th>Status</th></tr></thead>
            <tbody>{data.receipts.map((r) => <tr key={r.id}><td><Link to={`/receipts/${r.id}`}>{r.receipt_no}</Link>{r.parts > 1 && <span className="tag" style={{ marginLeft: 6 }}>combined {money(r.amount)}</span>}</td><td>{date(r.date)}</td><td>{r.payment_type}</td><td>{r.method}</td><td>{r.account_name}</td><td className="num mono">{money(r.share + r.share_advance)}</td><td><StatusBadge status={r.status} /></td></tr>)}</tbody></table>)}
          {tab === 'ledger' && data.ledger && <LedgerTable ledger={data.ledger} />}
          {tab === 'bledger' && data.bundle_ledger && <LedgerTable ledger={data.bundle_ledger} withSale />}
          {tab === 'schedule' && construction && <ScheduleManager projectId={s.project_id} contracts={contracts} defaultScope={s.id} />}
          {tab === 'costs' && construction && (
            <div className="stack">
              <div className="grid g3"><div className="sum-box"><div className="l">Contract value</div><div className="v">{money(s.net_price)}</div></div><div className="sum-box"><div className="l">Costs booked</div><div className="v neg">{money(data.cost_total || 0)}</div></div><div className="sum-box"><div className="l">Margin</div><div className={`v ${s.net_price - (data.cost_total || 0) >= 0 ? 'pos' : 'neg'}`}>{money(s.net_price - (data.cost_total || 0))}</div></div></div>
              {can('accounting', 'create') && <div><Link className="btn primary sm" to={`/expenses/new?sale=${s.id}&project=${s.project_id}`}>Add contract cost</Link></div>}
              {data.costs?.length ? <table className="t"><thead><tr><th>Voucher</th><th>Date</th><th>Account</th><th>Vendor</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead><tbody>{data.costs.map((c) => <tr key={c.id}><td><Link to={`/expenses/${c.id}`}>{c.voucher_no}</Link></td><td>{date(c.date)}</td><td>{c.account}</td><td>{c.vendor || '—'}</td><td>{c.description}</td><td className="num mono">{money(c.amount)}</td><td><StatusBadge status={c.status} /></td></tr>)}</tbody></table> : <div className="muted">No costs tagged to this contract yet. Expense vouchers can be tagged to a contract so you see its real margin.</div>}
            </div>
          )}
          {tab === 'info' && (<div className="grid g2"><KV items={[['Type', construction ? 'Construction contract' : 'Property sale'], ['Sale date', date(s.sale_date)], ['Customer', <Link to={`/contacts/${s.contact_id}`}>{s.customer_name}</Link>], ['Phone', s.customer_phone], [construction ? 'Contract' : 'Property', s.property_title], ['Project', s.project_name], ['Plot / block', `${s.plot_no || '—'} / ${s.block || '—'}`], ['Sales agent', s.agent_name]]} />
            <KV items={[['First due', date(s.first_due)], ['Final due', date(s.final_due)], ['Late payments', s.late_payments], data.commission ? ['Commission', `${data.commission.commission_no} — ${money(data.commission.amount)} (${data.commission.status})`] : null, ['Notes', s.notes]]} /></div>)}
          {tab === 'docs' && <DocumentsPanel entityType="sale" entityId={s.id} canEdit={can('sales', 'edit')} categories={['Contract', 'Agreement', 'Architectural Drawing', 'Construction Drawing', 'Site Plan', 'Allotment Letter', 'Payment Proof', 'Other']} portalToggle />}
        </div>
      </Card>
      {cancel && <ConfirmDialog danger reason title={`Cancel this ${construction ? 'contract' : 'sale'}`} confirmLabel="Cancel" message="Commission is cancelled and the receivable is reversed; a property returns to Available. Sales with valid receipts must have them voided or refunded first."
        onCancel={() => setCancel(false)} onConfirm={async (reason) => { try { await api.post(`/api/sales/${s.id}/cancel`, { reason }); toast('Cancelled', 'ok'); setCancel(false); reload(); } catch (e) { toast(e.message, 'err'); setCancel(false); } }} />}
    </div>
  );
}

function LedgerTable({ ledger, withSale }) {
  return (
    <table className="t"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
      <tbody>{ledger.entries.map((e, i) => <tr key={i}><td>{date(e.date)}</td><td>{e.ref}</td><td>{e.description}</td><td className="num mono">{e.debit ? money(e.debit) : ''}</td><td className="num mono">{e.credit ? money(e.credit) : ''}</td><td className="num mono">{money(e.balance)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={5}>Closing balance (customer owes){withSale ? ' — all combined sales' : ''}</td><td className="num mono">{money(ledger.balance)}</td></tr></tfoot></table>
  );
}
