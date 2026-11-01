import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { InstallmentTable, SaleLedgerSummary } from '../components/SaleBits.jsx';
import { DocumentsPanel, ImageUploader } from '../components/Uploaders.jsx';
import { BackLink, Card, Empty, KV, Loading, PageHead, ProgressBar, StatusBadge, Tabs } from '../components/ui.jsx';
import { useAuth, useFetch } from '../context.jsx';
import { date, money } from '../format.js';
import { PropertyActions, WebsiteBadge } from './Properties.jsx';
import RegionFields from '../components/RegionFields.jsx';
import NavigateButton from '../components/NavigateButton.jsx';
import PortalsCard from '../components/PortalsCard.jsx';
import { VisitsPanel } from '../components/Visits.jsx';

const KIND_OPTS = [['cover', 'Cover image'], ['gallery', 'Gallery'], ['siteplan', 'Site plan'], ['map', 'Map'], ['dev', 'Development picture'], ['document', 'Document (PDF)']];
const FEATURE_LABEL = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', floors: 'Floors', kitchen: 'Kitchens', garage: 'Garage', lawn: 'Lawn', drawing_room: 'Drawing room', dining_room: 'Dining room', corner: 'Corner', park_facing: 'Park facing', main_road: 'Main road', boulevard: 'Boulevard', possession: 'Possession', development_status: 'Development status' };
const yes = (v) => (v === true ? 'Yes' : v === false ? 'No' : v);

/** Unit workspace: everything about one plot / property, cross-linked. */
export default function PropertyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, user } = useAuth();
  const { data: ws, error, reload, setData } = useFetch(`/api/properties/${id}/workspace`);
  const [tab, setTab] = useState('overview');
  if (error) return <div><BackLink to="/properties">Inventory</BackLink><div className="alert err">{error}</div></div>;
  if (!ws) return <Loading />;
  const p = ws.property;
  const s = ws.sale;
  const cover = p.media.find((m) => m.kind === 'cover') || p.media.find((m) => !/\.pdf$/i.test(m.path));
  const feats = Object.entries(p.features || {}).filter(([, v]) => v !== '' && v !== false && v != null);
  return (
    <div>
      <BackLink to="/properties">Inventory</BackLink>
      <PageHead title={<span>{p.title}{p.is_demo ? <span className="demo-chip">DEMO</span> : null}</span>} sub={`${p.code} · ${p.project_name || 'No project'}${p.block ? ` · Block ${p.block}` : ''}${p.plot_no ? ` · Plot ${p.plot_no}` : ''}`}>
        {can('properties', 'edit') && p.status !== 'sold' && <Link className="btn" to={`/properties/${p.id}/edit`}><Icon name="edit" size={14} />Edit</Link>}
        {can('sales', 'create') && ['available', 'featured', 'reserved'].includes(p.status) && <Link className="btn primary" to={`/sales/new?property=${p.id}`}>Sell this property</Link>}
        <PropertyActions p={p} reload={() => reload()} />
      </PageHead>
      <div className="row wrap" style={{ marginBottom: 12 }}><StatusBadge status={p.status} /><span className="pill grey">Review: {p.review_state}</span><WebsiteBadge state={p.website_state} /></div>
      {p.review_note && p.review_state === 'draft' && <div className="alert err" style={{ marginBottom: 12 }}><b>Sent back by the Listing Manager:</b> {p.review_note}</div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)', alignItems: 'start' }}>
        <div className="stack">
          <RegionFields entity="property" id={p.id} />
          <PortalsCard propertyId={p.id} published={!!p.published} />
          <Card flush>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Unit information' }, ...(s ? [{ key: 'sale', label: 'Customer & sale' }, { key: 'ledger', label: 'Ledger' }] : []), { key: 'media', label: 'Images & videos', count: p.media.length }, { key: 'docs', label: 'Documents', count: ws.documents.length }, ...(can('crm', 'view') ? [{ key: 'visits', label: 'Visits' }] : [])]} />
            <div className="card-b">
              {tab === 'overview' && (
                <div className="stack">
                  <div className="grid g2">
                    <KV items={[['Purpose', p.purpose], ['Type', p.property_type], ['Project', p.project ? <Link to={`/projects/${p.project.id}`}>{p.project.name}</Link> : null], ['Block / sector', [p.block, p.sector].filter(Boolean).join(' / ')], ['Plot number', p.plot_no], ['File number', p.file_no], ['Registration number', p.registration_no], ['File status', p.file_status ? <StatusBadge status={p.file_status} tone={{ Active: 'green', Inactive: 'grey', Suspended: 'red', Defaulted: 'red', Paused: 'amber' }[p.file_status]} /> : null], ['File notes', p.file_notes], ['City', p.city], ['Location', p.location], ['Address', p.address], ['GPS', p.lat && p.lng ? `${p.lat}, ${p.lng}` : null]]} />
                    <KV items={[['Area', p.area_size ? `${p.area_size} ${p.unit}` : null], ['Total price', money(p.total_price)], ['Price per unit', p.price_per_unit ? money(p.price_per_unit) : null], ['Discount', money(p.discount)], ['Net price', <b>{money(p.net_price)}</b>], ['Installments', yes(!!p.installment_available)], ['Ready for possession', yes(!!p.ready_possession)], ['Agent', p.agent_name]]} />
                  </div>
                  {p.lat && p.lng && <div><NavigateButton lat={p.lat} lng={p.lng} label={p.title}>Navigate to this property</NavigateButton></div>}
                  {feats.length > 0 && <div><div className="section-title" style={{ marginTop: 0 }}>Features</div><div className="row wrap">{feats.map(([k, v]) => <span key={k} className="tag">{FEATURE_LABEL[k] || k}{v === true ? '' : `: ${v}`}</span>)}</div></div>}
                  {p.amenities.length > 0 && <div><div className="section-title" style={{ marginTop: 0 }}>Amenities</div><div className="row wrap">{p.amenities.map((a) => <span key={a} className="tag">{a}</span>)}</div></div>}
                  {(p.short_desc || p.description) && <div><div className="section-title" style={{ marginTop: 0 }}>Description</div><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.description || p.short_desc}</p></div>}
                  {p.videos.length > 0 && <div><div className="section-title" style={{ marginTop: 0 }}>Videos</div>{p.videos.map((v) => <div key={v}><a href={v} target="_blank" rel="noreferrer">{v}</a></div>)}</div>}
                </div>
              )}
              {tab === 'sale' && s && (
                <div className="stack">
                  <div className="grid g2">
                    <KV items={[['Customer', ws.customer ? <Link to={`/contacts/${ws.customer.id}`}>{ws.customer.full_name}</Link> : null], ['Phone', ws.customer?.phone], ['Sales agent', s.agent_name], ['Sale', <Link to={`/sales/${s.id}`}>{s.sale_no}</Link>], ['Sale date', date(s.sale_date)]]} />
                    <KV items={[['Sale price', money(s.sale_price)], ['Discount', money(s.discount)], ['Net sale value', money(s.net_price)], ['Booking', money(s.booking_amount)], ['First due', date(s.first_due)], ['Final due', date(s.final_due)]]} />
                  </div>
                  <SaleLedgerSummary s={s} />
                </div>
              )}
              {tab === 'ledger' && s && (<div className="stack"><InstallmentTable rows={s.installments} />
                {ws.receipts && <Card title="Receipts for this unit" flush><table className="t"><tbody>{ws.receipts.map((r) => <tr key={r.id}><td><Link to={`/receipts/${r.id}`}>{r.receipt_no}</Link></td><td>{date(r.date)}</td><td>{r.payment_type}</td><td>{r.method}</td><td className="num mono">{money(r.amount)}</td><td><StatusBadge status={r.status} /></td></tr>)}</tbody></table></Card>}</div>)}
              {tab === 'media' && <ImageUploader base={`/api/properties/${p.id}`} media={p.media} onChange={(m) => setData({ ...ws, property: { ...p, media: m } })} kinds={KIND_OPTS} readOnly={!can('properties', 'edit')} />}
              {tab === 'visits' && <VisitsPanel propertyId={p.id} />}
              {tab === 'docs' && <DocumentsPanel entityType="property" entityId={p.id} canEdit={can('properties', 'edit')} categories={['Contract', 'Architectural Drawing', 'Construction Drawing', 'Site Plan', 'Allotment Letter', 'Agreement', 'Payment Proof', 'Other']} portalToggle />}
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card flush>{cover ? <img src={`/uploads/${cover.path}`} alt={p.title} style={{ width: '100%', display: 'block', borderRadius: 8, maxHeight: 260, objectFit: 'cover' }} /> : <div className="empty"><Icon name="image" size={26} /><div>No cover image</div></div>}</Card>
          <Card title="At a glance">
            <KV items={[['Net price', <b>{money(p.net_price)}</b>], ['Status', <StatusBadge status={p.status} />], ['Website', <WebsiteBadge state={p.website_state} />], s && !user.own_scope ? ['Paid', money(s.paid_amount)] : null, s && !user.own_scope ? ['Balance', money(s.outstanding)] : null, ['Development', p.dev_status || p.features?.development_status]]} />
          </Card>
          {ws.project && <Card title="Project"><Link to={`/projects/${ws.project.id}`} className="bold">{ws.project.name}</Link><div className="muted">{ws.project.code}</div></Card>}
        </div>
      </div>
    </div>
  );
}
