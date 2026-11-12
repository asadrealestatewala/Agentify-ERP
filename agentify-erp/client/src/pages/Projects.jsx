import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarsChart, DonutChart } from '../components/Charts.jsx';
import DataTable, { SearchBar, useTable } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import ResourcePage, { FormModal } from '../components/ResourcePage.jsx';
import { DocumentsPanel, FileUploader } from '../components/Uploaders.jsx';
import { BackLink, Card, ConfirmDialog, Empty, Field, KV, LedgerSummary, Loading, PageHead, ProgressBar, Select, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, getRegion } from '../format.js';
import { DateRangeFilter } from '../components/ui.jsx';
import { ScheduleManager } from '../components/Schedule.jsx';

const DEV_STATUS = ['Planning', 'Under Development', 'Completed', 'On Hold'];

export function projectFields(users) {
  return [
    { name: 'code', label: 'Project code', required: true }, { name: 'name', label: 'Project name', required: true },
    { name: 'kind', label: 'Project type', type: 'select', options: [{ value: 'development', label: 'Development (plots, housing scheme)' }, { value: 'construction', label: 'Construction (house-building contracts)' }], allowEmpty: false, full: true },
    { name: 'location', label: 'Location' }, { name: 'developer', label: 'Developer' },
    { name: 'total_land_area', label: 'Total land area', type: 'number' }, { name: 'land_unit', label: 'Land unit', type: 'select', options: ['Kanal', 'Marla', 'Acre', 'Sq Ft'], allowEmpty: false },
    { name: 'total_units', label: 'Total units', type: 'number' }, { name: 'total_value', label: 'Total project value', type: 'money' }, { name: 'budget', label: 'Project budget (cost ceiling)', type: 'money', hint: 'Used for “budget utilised” in reports and the assistant' },
    { name: 'dev_status', label: 'Development status', type: 'select', options: DEV_STATUS, allowEmpty: false },
    { name: 'manager_id', label: 'Project manager', type: 'select', number: true, options: users.map((u) => ({ value: u.id, label: u.name })) },
    { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'expected_completion', label: 'Expected completion', type: 'date' },
    { name: 'is_development', label: 'Development project (shows progress to customers)', type: 'bool', full: true },
    { name: 'site_visible', label: 'Show on the public website', type: 'bool', full: true },
    { name: 'description', label: 'Description', type: 'textarea' },
  ];
}

export function ProjectList({ development, kind }) {
  const nav = useNavigate();
  const { users } = useLookups();
  return (
    <ResourcePage title={kind === 'construction' ? 'Construction projects' : development ? 'Development projects' : 'Projects'} sub={kind === 'construction' ? 'House-building contracts with customers' : 'Every unit belongs to a project'} endpoint="/api/projects" module="projects" noun="project" tableId="projects"
      filters={kind ? { kind } : development ? { is_development: 1 } : {}} fields={projectFields(users)} defaults={{ site_visible: 1, dev_status: 'Planning', land_unit: 'Kanal', is_development: kind === 'construction' ? 0 : 1, kind: kind || 'development' }}
      columns={[
        { key: 'name', label: 'Project', render: (r) => <div><Link to={`/projects/${r.id}`} className="cell-main">{r.name}</Link>{r.is_demo ? <span className="demo-chip">DEMO</span> : null}<div className="cell-sub">{r.code} · {r.location}</div></div> },
        { key: 'manager_name', label: 'Manager' }, { key: 'dev_status', label: 'Status', render: (r) => <StatusBadge status={r.dev_status || 'Planning'} tone="blue" label={r.dev_status} /> },
        { key: 'kind', label: 'Type', render: (r) => (r.kind === 'construction' ? <span className="pill purple">Construction</span> : <span className="pill blue">Development</span>) },
        { key: 'units', label: 'Units / contracts', num: true, render: (r) => (r.kind === 'construction' ? `${r.contracts} contract(s)` : `${r.units_sold}/${r.units} sold`) }, { key: 'units_available', label: 'Available', num: true, hidden: true },
        { key: 'total_value', label: 'Project value', num: true, render: (r) => money(r.total_value) },
        { key: 'progress', label: 'Progress', render: (r) => <div style={{ width: 120 }} className="row"><div className="grow"><ProgressBar value={r.progress || 0} /></div><span>{r.progress || 0}%</span></div> },
        { key: 'expected_completion', label: 'Completion', render: (r) => date(r.expected_completion) },
      ]} rowLink={(r) => `/projects/${r.id}`} />
  );
}

export function ProjectUnits() {
  const nav = useNavigate();
  const { projects } = useLookups();
  const t = useTable('/api/properties', { sort: 'project', dir: 'asc', limit: 50 });
  return (
    <div>
      <PageHead title="Project units" sub="All units by project, block and plot" />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search plot, e.g. 2B…" />
          <div style={{ width: 200 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div></div>
        <DataTable {...t.tableProps} onRowClick={(r) => nav(`/properties/${r.id}`)} columns={[
          { key: 'project_name', label: 'Project', sortKey: 'project' }, { key: 'block', label: 'Block' }, { key: 'plot_no', label: 'Plot / unit', render: (r) => <Link to={`/properties/${r.id}`} className="cell-main">{r.plot_no || r.title}</Link> },
          { key: 'property_type', label: 'Type' }, { key: 'area', label: 'Area', render: (r) => (r.area_size ? `${r.area_size} ${r.unit}` : '—') }, { key: 'net_price', label: 'Net price', num: true, render: (r) => money(r.net_price) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'customer_name', label: 'Customer', render: (r) => r.customer_name || '—' }]} />
      </Card>
    </div>
  );
}

export function ProjectFinancials() {
  const { data } = useFetch('/api/reports/project-profitability');
  const nav = useNavigate();
  return (
    <div>
      <PageHead title="Project financials" sub="Income, collections, expenses and profit per project — derived from the ledger" />
      {!data ? <Loading /> : (
        <>
          <div className="grid g2" style={{ marginBottom: 12 }}>
            <Card title="Sales vs expenses"><BarsChart isMonth={false} x="project" data={data.rows} series={[{ key: 'sales', label: 'Sales' }, { key: 'collections', label: 'Collections', color: '#16a34a' }, { key: 'expenses', label: 'Expenses', color: '#ef4444' }]} /></Card>
            <Card title="Gross profit by project"><BarsChart isMonth={false} x="project" data={data.rows} series={[{ key: 'profit', label: 'Gross profit', color: '#8b5cf6' }]} /></Card>
          </div>
          <Card flush><table className="t"><thead><tr><th>Project</th><th className="num">Sales</th><th className="num">Collections</th><th className="num">Receivables</th><th className="num">Expenses</th><th className="num">Gross profit</th><th className="num">Cash position</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.project}><td className="cell-main">{r.project}</td><td className="num mono">{money(r.sales)}</td><td className="num mono">{money(r.collections)}</td><td className="num mono">{money(r.receivables)}</td><td className="num mono">{money(r.expenses)}</td><td className={`num mono ${r.profit < 0 ? 'neg' : 'pos'}`}>{money(r.profit)}</td><td className={`num mono ${r.cash < 0 ? 'neg' : ''}`}>{money(r.cash)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td>{['sales', 'collections', 'receivables', 'expenses', 'profit', 'cash'].map((k) => <td key={k} className="num mono">{money(data.totals[k])}</td>)}</tr></tfoot></table></Card>
        </>
      )}
    </div>
  );
}

function UpdateForm({ project, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', progress: '', kind: 'Progress', update_date: new Date().toLocaleDateString('en-CA', { timeZone: getRegion().config.timezone }), videos: [] });
  const [files, setFiles] = useState([]);
  const [video, setVideo] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (k !== 'progress') fd.append(k, k === 'videos' ? JSON.stringify(v) : v); });
      files.forEach((x) => fd.append('files', x));
      await api.upload(`/api/projects/${project}/updates`, fd);
      toast('Update published to customers', 'ok'); onSaved();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <FormModal title="Publish development update" size="lg" initial={f} onClose={onClose} submitLabel="Publish update"
      fields={[{ name: 'title', label: 'Title', required: true, full: true }, { name: 'kind', label: 'Type', type: 'select', options: ['Progress', 'Announcement', 'Report'], allowEmpty: false }, { name: 'update_date', label: 'Date', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea' }]}
      onSave={async (form) => { Object.assign(f, form); await submit(); }}
      extra={<div className="stack"><FileUploader accept="image/*,video/*,application/pdf" onFiles={(x) => setFiles((p) => [...p, ...x])} label="Add images, videos or progress reports (PDF)" hint={files.length ? `${files.length} file(s) selected: ${files.map((x) => x.name).join(', ')}` : undefined} />
        <Field label="Video link (YouTube / URL)"><div className="row"><input className="input" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://…" /><button type="button" className="btn" onClick={() => { if (/^https?:\/\//i.test(video)) { f.videos = [...f.videos, video]; setVideo(''); toast('Video link added', 'ok'); } }}>Add</button></div></Field></div>} />
  );
}

export function ProjectWorkspace() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data: ws, error, reload } = useFetch(`/api/projects/${id}/workspace`);
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'overview');
  const [addingUpdate, setAddingUpdate] = useState(false);
  const { users } = useLookups();
  const [editing, setEditing] = useState(false);
  if (error) return <div className="alert err">{error}</div>;
  if (!ws) return <Loading />;
  const p = ws.project, fin = ws.financials;
  const hasSchedule = ws.schedule?.tasks.length > 0;
  const progress = hasSchedule ? ws.schedule.summary.actual_pct : ws.dev_items.length ? Math.round(ws.dev_items.reduce((a, i) => a + i.progress, 0) / ws.dev_items.length) : 0;
  const isConstruction = p.kind === 'construction';
  const canEdit = can('projects', 'edit');
  return (
    <div>
      <BackLink to="/projects">Projects</BackLink>
      <PageHead title={p.name} sub={`${p.code} · ${p.location || ''} · Manager: ${p.manager_name || '—'}`}>
        <StatusBadge status={p.dev_status || 'Planning'} tone="blue" label={p.dev_status} />
        {!p.site_visible && p.site_state !== 'requested' && <button className="btn" onClick={async () => { try { await api.post(`/api/listings/projects/${p.id}/request`); toast('Sent to the Listing Manager for website approval', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } }}>Request website listing</button>}
        {p.site_state === 'requested' && !p.site_visible && <span className="pill amber">Awaiting Listing Manager</span>}
        {canEdit && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit</button>}
        {!isConstruction && can('properties', 'create') && <Link className="btn primary" to={`/properties/new?project=${p.id}`}>Add unit</Link>}
        {isConstruction && can('sales', 'create') && <Link className="btn primary" to="/sales/new?type=construction">New contract</Link>}
      </PageHead>
      {fin && (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Stat label="Project value" value={money(fin.project_value)} sub={`${fin.units_total} units`} />
          <Stat label="Sales" value={money(fin.total_sales)} sub={`${fin.units_sold} sold · ${fin.units_available} available · ${fin.units_reserved} reserved`} />
          <Stat label="Collections" value={money(fin.collections)} tone="pos" sub={`Receivables ${money(fin.receivables)}`} />
          <Stat label="Expenses" value={money(fin.expenses)} tone="neg" sub={`Outstanding dev. cost ${money(fin.outstanding_development_cost)}`} />
          <Stat label="Gross profit" value={money(fin.gross_profit)} tone={fin.gross_profit >= 0 ? 'pos' : 'neg'} sub="Sales − expenses" />
          <Stat label="Cash position" value={money(fin.cash_position)} sub="Collections − paid expenses" />
          <Stat label="Units sold" value={`${fin.units_sold} / ${fin.units_total}`} />
          <Stat label="Development" value={`${progress}%`} />
        </div>
      )}
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Information' }, ...(isConstruction ? [{ key: 'contracts', label: 'Contracts', count: ws.contracts.length }] : [{ key: 'units', label: 'Units', count: ws.units.length }]), { key: 'schedule', label: 'Schedule', count: ws.schedule?.tasks.length || undefined }, ...(fin ? [{ key: 'customers', label: 'Customers', count: ws.customers.length }, { key: 'money', label: 'Receipts & expenses' }, { key: 'vendors', label: 'Vendors', count: ws.vendors.length }] : []), { key: 'dev', label: 'Checklist & updates' }, { key: 'docs', label: 'Documents', count: ws.documents.length }]} />
        <div className="card-b">
          {tab === 'overview' && (<div className="grid g2"><KV items={[['Code', p.code], ['Location', p.location], ['Developer', p.developer], ['Land area', p.total_land_area ? `${p.total_land_area} ${p.land_unit}` : null], ['Total units', p.total_units], ['Total value', money(p.total_value)]]} />
            <KV items={[['Status', p.dev_status], ['Manager', p.manager_name], ['Start', date(p.start_date)], ['Expected completion', date(p.expected_completion)]]} />
            <div style={{ gridColumn: '1/-1' }}>{p.description}</div></div>)}
          {tab === 'contracts' && (ws.contracts.length ? <table className="t"><thead><tr><th>Contract</th><th>Customer</th><th>Plot</th><th className="num">Value</th><th className="num">Paid</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>{ws.contracts.map((c) => <tr key={c.id}><td><Link to={`/sales/${c.id}`}>{c.sale_no}</Link><div className="cell-sub">{c.title}</div></td><td><Link to={`/contacts/${c.contact_id}`}>{c.customer}</Link></td><td>{c.plot || '—'}</td><td className="num mono">{money(c.net_price)}</td><td className="num mono">{money(c.paid_amount)}</td><td className="num mono">{money(c.net_price - c.paid_amount)}</td>
              <td className="right nowrap"><Link className="btn sm" to={`/sales/${c.id}?tab=schedule`}>Build schedule</Link></td></tr>)}</tbody></table> : <Empty>No contracts yet. <Link to="/sales/new?type=construction">Create a construction contract</Link>.</Empty>)}
          {tab === 'schedule' && <ScheduleManager projectId={p.id} contracts={ws.contracts.map((c) => ({ id: c.id, customer: c.customer, title: c.title, sale_no: c.sale_no }))} defaultScope={sp.get('scope') || 'project'} />}
          {tab === 'units' && (ws.units.length ? <table className="t"><thead><tr><th>Block</th><th>Plot</th><th>Type</th><th>Area</th><th className="num">Price</th><th>Status</th><th>Customer</th></tr></thead>
            <tbody>{ws.units.map((u) => <tr key={u.id}><td>{u.block}</td><td><Link to={`/properties/${u.id}`}>{u.plot_no || u.title}</Link></td><td>{u.property_type}</td><td>{u.area_size} {u.unit}</td><td className="num mono">{money(u.net_price)}</td><td><StatusBadge status={u.status} /></td><td>{u.customer || '—'}</td></tr>)}</tbody></table> : <Empty>No units yet.</Empty>)}
          {tab === 'customers' && fin && <table className="t"><thead><tr><th>Customer</th><th>Unit</th><th>Sale</th><th className="num">Net value</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>{ws.customers.map((c) => <tr key={c.sale_no}><td><Link to={`/contacts/${c.id}`}>{c.full_name}</Link></td><td>{c.title}</td><td>{c.sale_no}</td><td className="num mono">{money(c.net_price)}</td><td className="num mono">{money(c.paid_amount)}</td><td className="num mono">{money(c.net_price - c.paid_amount)}</td></tr>)}</tbody></table>}
          {tab === 'money' && fin && (<div className="stack"><div className="grid g2"><Card title="Expense breakdown"><DonutChart data={fin.expense_breakdown.map((e) => ({ name: e.account, value: e.amount }))} /></Card>
            <Card title="Recent receipts" flush><table className="t"><tbody>{ws.receipts.slice(0, 8).map((r) => <tr key={r.id}><td><Link to={`/receipts/${r.id}`}>{r.receipt_no}</Link></td><td>{date(r.date)}</td><td>{r.full_name}</td><td className="num mono">{money(r.amount)}</td></tr>)}</tbody></table></Card></div>
            <Card title="Expenses" flush><table className="t"><thead><tr><th>Voucher</th><th>Date</th><th>Account</th><th>Vendor</th><th>Description</th><th className="num">Amount</th><th>Status</th></tr></thead><tbody>{ws.expenses.map((e) => <tr key={e.id}><td><Link to={`/expenses/${e.id}`}>{e.voucher_no}</Link></td><td>{date(e.date)}</td><td>{e.account}</td><td>{e.vendor || '—'}</td><td>{e.description}</td><td className="num mono">{money(e.amount)}</td><td><StatusBadge status={e.status} /></td></tr>)}</tbody></table></Card></div>)}
          {tab === 'vendors' && fin && (ws.vendors.length ? <table className="t"><thead><tr><th>Vendor</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Payable</th></tr></thead><tbody>{ws.vendors.map((v) => <tr key={v.id}><td><Link to={`/vendors/${v.id}`}>{v.name}</Link></td><td className="num mono">{money(v.billed)}</td><td className="num mono">{money(v.paid)}</td><td className="num mono">{money(v.billed - v.paid)}</td></tr>)}</tbody></table> : <Empty>No vendor billing on this project.</Empty>)}
          {tab === 'dev' && (
            <div className="stack">
              <div className="row between wrap"><div className="muted">Completion % is calculated from the Schedule tab (each activity's start and due dates) — it is never typed in. Use updates to share photos, videos, reports and announcements with customers.</div>
                {canEdit && <button className="btn sm primary" onClick={() => setAddingUpdate(true)}>Publish update</button>}</div>
              <div className="section-title">Updates published to customers</div>
              {!ws.dev_updates.length ? <Empty>No updates yet.</Empty> : ws.dev_updates.map((u) => (
                <div key={u.id} className="card" style={{ padding: 14 }}>
                  <div className="row between"><div><b>{u.title}</b> <span className="pill blue">{u.kind}</span></div><span className="muted">{date(u.update_date)}</span></div>
                  {u.description && <p style={{ margin: '6px 0' }}>{u.description}</p>}
                  <div className="gallery">{u.media.filter((m) => m.kind === 'image').map((m) => <img key={m.id} src={fileUrl(m.path)} alt={m.caption || u.title} />)}</div>
                  {u.media.filter((m) => m.kind !== 'image').map((m) => <div key={m.id}><a href={fileUrl(m.path)} target="_blank" rel="noreferrer">{m.kind === 'video' ? '▶ ' : '📄 '}{m.caption}</a></div>)}
                  {u.videos.map((v) => <div key={v}><a href={v} target="_blank" rel="noreferrer">▶ {v}</a></div>)}
                  {can('projects', 'delete') && <button className="btn sm ghost danger" style={{ marginTop: 6 }} onClick={async () => { await api.del(`/api/updates/${u.id}`); reload(); }}>Delete update</button>}
                </div>
              ))}
            </div>
          )}
          {tab === 'docs' && <DocumentsPanel entityType="project" entityId={p.id} canEdit={canEdit} categories={['Contract', 'Architectural Drawing', 'Construction Drawing', 'Site Plan', 'Allotment Letter', 'Agreement', 'Payment Proof', 'Other']} portalToggle />}
        </div>
      </Card>
      {addingUpdate && <UpdateForm project={p.id} onClose={() => setAddingUpdate(false)} onSaved={() => { setAddingUpdate(false); reload(); }} />}
      {editing && <FormModal title="Edit project" fields={projectFields(users)} initial={p} onClose={() => setEditing(false)} onSave={async (f) => { await api.put(`/api/projects/${p.id}`, f); setEditing(false); reload(); toast('Project saved', 'ok'); }} />}
    </div>
  );
}

export function DevUpdates() {
  const { data } = useFetch('/api/dev-updates');
  return (
    <div>
      <PageHead title="Development updates" sub="Everything published to customers across all projects. Publish new updates from a project's Development tab." />
      {!data ? <Loading /> : !data.length ? <Empty>No updates yet.</Empty> : data.map((u) => (
        <Card key={u.id} title={<span><Link to={`/projects/${u.project_id}`}>{u.project_name}</Link> — {u.title}</span>} actions={<span className="muted">{date(u.update_date)}</span>}>
          {u.description}{u.progress != null && <div style={{ marginTop: 8 }}><ProgressBar value={u.progress} /></div>}
          <div className="gallery" style={{ marginTop: 8 }}>{u.media.filter((m) => m.kind === 'image').map((m) => <img key={m.id} src={fileUrl(m.path)} alt="" />)}</div>
        </Card>
      ))}
    </div>
  );
}
