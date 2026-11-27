import { useState } from 'react';
import PropertyStatusCheck from '../components/PropertyStatusCheck.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, CurrencyInput, PageHead, Select, StatusBadge, Stat } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { money } from '../format.js';

const STATUSES = ['draft', 'available', 'featured', 'reserved', 'sold', 'on_hold', 'cancelled'];
const PRESETS = { featured: ['Featured properties', 'featured'], draft: ['Draft properties', 'draft'], sold: ['Sold properties', 'sold'], reserved: ['Reserved properties', 'reserved'] };

export const WebsiteBadge = ({ state }) => <StatusBadge status={state} tone={{ featured: 'blue', published: 'green', reserved: 'amber', sold: 'purple', hidden: 'grey' }[state]} label={{ hidden: 'Website: hidden', published: 'Website: live', featured: 'Website: featured', reserved: 'Website: reserved', sold: 'Website: sold' }[state] || state} />;

export function useWorkflow(reload) {
  const toast = useToast();
  return async (id, action, msg) => {
    try { const p = await api.post(`/api/properties/${id}/${action}`); toast(msg || 'Updated', 'ok'); reload?.(p); return p; } catch (e) { toast(e.message, 'err'); return null; }
  };
}

export function PropertyActions({ p, reload, compact }) {
  const { can } = useAuth();
  const wf = useWorkflow(reload);
  const Btn = ({ action, label, msg, cls = '' }) => <button className={compact ? '' : `btn sm ${cls}`} onClick={() => wf(p.id, action, msg)}>{label}</button>;
  const approve = can('properties', 'approve'), edit = can('properties', 'edit');
  const items = [];
  if (p.status === 'sold') return null;
  if (edit && p.review_state === 'draft' && !approve) items.push(<Btn key="r" action="submit-review" label="Submit to Listing Manager" msg="Sent to the Listing Manager for approval" />);
  if (edit && p.review_state === 'draft' && approve) items.push(<Btn key="r" action="submit-review" label="Submit for review" msg="Submitted for review" />);
  if (approve && p.review_state === 'review') items.push(<Btn key="a" action="approve" label="Approve" msg="Approved" cls="success" />);
  if (approve && !p.published) items.push(<Btn key="p" action="publish" label="Publish" msg="Published to website" cls="primary" />);
  if (approve && p.published && p.status === 'available') items.push(<Btn key="f" action="feature" label="Feature on website" msg="Featured on website" cls="primary" />);
  if (approve && p.status === 'featured') items.push(<Btn key="u" action="unfeature" label="Unfeature" msg="Removed from featured" />);
  if (approve && p.published) items.push(<Btn key="h" action="unpublish" label="Unpublish" msg="Hidden from website" />);
  if (edit && ['available', 'featured', 'draft'].includes(p.status)) items.push(<Btn key="o" action="hold" label="Put on hold" msg="On hold" />);
  if (edit && ['on_hold', 'reserved', 'cancelled'].includes(p.status)) items.push(<Btn key="rel" action="release" label={p.status === 'cancelled' ? 'Restore' : 'Release'} msg="Released" />);
  if (approve && p.status !== 'cancelled') items.push(<Btn key="x" action="archive" label="Archive" msg="Archived" cls="danger" />);
  return <>{items}</>;
}

export default function Properties({ preset }) {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const { projects, list } = useLookups();
  const initialStatus = preset ? PRESETS[preset][1] : sp.get('status') || '';
  const t = useTable('/api/properties', { sort: 'created', filters: { status: initialStatus } });
  const [selStatus, setSelStatus] = useState(initialStatus);
  const [del, setDel] = useState(null);
  const { hidden, remove } = useUndoDelete('properties');
  const status = preset ? PRESETS[preset][1] : selStatus;
  const sum = useFetch('/api/properties/summary');
  const [title] = [preset ? PRESETS[preset][0] : 'Property inventory'];

  const cols = [
    { key: 'cover', label: '', width: 54, render: (r) => (r.cover ? <img src={fileUrl(r.cover)} alt="" style={{ width: 44, height: 34, objectFit: 'cover', borderRadius: 5 }} /> : <div style={{ width: 44, height: 34, borderRadius: 5, background: 'var(--grey-bg)', display: 'grid', placeItems: 'center', color: 'var(--faint)' }}><Icon name="image" size={14} /></div>) },
    { key: 'title', label: 'Property', sortKey: 'title', render: (r) => <div><Link to={`/properties/${r.id}`} className="cell-main">{r.title}</Link>{r.is_demo ? <span className="demo-chip">DEMO</span> : null}<div className="cell-sub">{r.code}</div></div> },
    { key: 'project_name', label: 'Project', sortKey: 'project' },
    { key: 'plot', label: 'Block / Plot', render: (r) => [r.block, r.plot_no].filter(Boolean).join(' / ') || '—' },
    { key: 'file_no', label: 'File no.', render: (r) => (r.file_no || r.registration_no ? <div><span className="mono">{r.file_no || '—'}</span>{r.registration_no && <div className="cell-sub">{r.registration_no}</div>}</div> : '—') },
    { key: 'file_status', label: 'File status', render: (r) => (r.file_status ? <StatusBadge status={r.file_status} tone={{ Active: 'green', Inactive: 'grey', Suspended: 'red', Defaulted: 'red', Paused: 'amber' }[r.file_status]} /> : <span className="muted">—</span>) },
    { key: 'property_type', label: 'Type' },
    { key: 'area', label: 'Area', render: (r) => (r.area_size ? `${r.area_size} ${r.unit}` : '—') },
    { key: 'net_price', label: 'Net price', sortKey: 'price', num: true, render: (r) => money(r.net_price) },
    { key: 'status', label: 'Status', sortKey: 'status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'website_state', label: 'Website', render: (r) => <WebsiteBadge state={r.website_state} /> },
    { key: 'customer_name', label: 'Customer', hidden: true, render: (r) => r.customer_name || '—' },
    { key: 'agent_name', label: 'Agent', hidden: true },
    { key: 'city', label: 'City', hidden: true },
  ].filter((c) => !(user.own_scope && c.key === 'customer_name'));

  return (
    <div>
      <PageHead title={title} sub={`${t.total} propert${t.total === 1 ? 'y' : 'ies'}`}>
        {can('properties', 'create') && <Link className="btn primary" to="/properties/new"><Icon name="plus" size={14} />Add property</Link>}
      </PageHead>
      {!preset && <PropertyStatusCheck />}
      {!preset && sum.data && (
        <div className="grid g-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginBottom: 12 }}>
          {sum.data.map((s) => <Stat key={s.status} label={s.status.replace('_', ' ')} value={s.n} sub={money(s.value)} to={undefined} />)}
        </div>
      )}
      <Card flush>
        <div className="toolbar">
          <SearchBar value={t.q} onChange={t.setQ} placeholder="Search title, plot, registration no., file no…" />
          {!preset && <div style={{ width: 150 }}><Select value={selStatus} onChange={(v) => { setSelStatus(v); t.setFilter({ status: v }); }} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))} /></div>}
          <div style={{ width: 170 }}><Select value={t.extra.project_id || ''} onChange={(v) => t.setFilter({ project_id: v })} placeholder="All projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></div>
          <div style={{ width: 150 }}><Select value={t.extra.file_status || ''} onChange={(v) => t.setFilter({ file_status: v })} placeholder="Any file status" options={['Active', 'Inactive', 'Paused', 'Defaulted', 'Suspended']} /></div>
          <div style={{ width: 150 }}><Select value={t.extra.property_type || ''} onChange={(v) => t.setFilter({ property_type: v })} placeholder="All types" options={list('property_type')} /></div>
          <div className="grow" />
          <ExportMenu url="/api/properties" params={t.params} name="properties" module="properties" />
        </div>
        <DataTable {...t.tableProps} hiddenIds={hidden} columns={cols} tableId="properties" onRowClick={(r) => nav(`/properties/${r.id}`)}
          rowActions={(r) => (<>
            <Link to={`/properties/${r.id}`}>Open</Link>
            {can('properties', 'edit') && r.status !== 'sold' && <Link to={`/properties/${r.id}/edit`}>Edit</Link>}
            <PropertyActions p={r} compact reload={() => t.reload()} />
            {can('properties', 'delete') && ['draft', 'cancelled'].includes(r.status) && <button className="danger" onClick={() => setDel(r)}>Delete</button>}
          </>)} />
      </Card>
      {del && <ConfirmDialog danger title="Delete property" message={`Delete “${del.title}”?`} confirmLabel="Delete" onCancel={() => setDel(null)}
        onConfirm={async () => { const row = del; setDel(null); remove(row.id, `“${row.title}” deleted`, () => api.del(`/api/properties/${row.id}`)); }} />}
    </div>
  );
}
