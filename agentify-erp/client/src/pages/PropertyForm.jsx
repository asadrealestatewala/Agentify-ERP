import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { FileUploader, ImageUploader } from '../components/Uploaders.jsx';
import { BackLink, Card, Check, ChipSelect, CurrencyInput, Field, Loading, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { money, getRegion } from '../format.js';
import PinPicker from '../components/PinPicker.jsx';
import ListingAiWriter from '../components/ListingAiWriter.jsx';

const PK_UNITS = ['Marla', 'Kanal', 'Sq Ft', 'Sq Yards', 'Sq Meter'];
const UNIT_LABEL = { sqft: 'Sq Ft', sqm: 'Sq M', acre: 'Acre', hectare: 'Hectare', marla: 'Marla', kanal: 'Kanal' };
/** Area units offered for the workspace's region (Pakistan keeps its original list). */
const regionUnits = () => { const c = getRegion().config; return c.region === 'PK' ? PK_UNITS : (c.area_units || ['sqft']).map((u) => UNIT_LABEL[u] || u); };
const HOUSE_TYPES = ['Ready Homes', 'Houses', 'Apartments'];
const PLOT_TYPES = ['Plots', 'Files'];
const BEDS = ['Studio', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '10+'];
const BATHS = ['1', '2', '3', '4', '5', '6', '6+'];
const DEV_STATUS = ['Developed', 'Under development', 'Undeveloped'];
const KIND_OPTS = [['cover', 'Cover image'], ['gallery', 'Gallery'], ['siteplan', 'Site plan'], ['map', 'Map'], ['dev', 'Development picture'], ['document', 'Document (PDF)']];

function Section({ icon, title, hint, children }) {
  return (
    <div className="pf-section">
      <div className="pf-title"><span className="ic"><Icon name={icon} size={18} /></span><div><h3>{title}</h3><p>{hint}</p></div></div>
      <div className="stack" style={{ gap: 16 }}>{children}</div>
    </div>
  );
}

// built when needed: the region is applied after this module loads
const emptyForm = () => ({ purpose: 'Sell', unit: getRegion().config.region === 'PK' ? 'Marla' : (UNIT_LABEL[getRegion().config.default_area_unit] || regionUnits()[0]), features: {}, amenities: [], videos: [], total_price: '', discount: 0, installment_available: false, ready_possession: false, city: '' });

export default function PropertyForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { list, projects, users, agents } = useLookups();
  const existing = useFetch(editing ? `/api/properties/${id}` : null);
  const [sp] = useSearchParams();
  const [f, setF] = useState(() => ({ ...emptyForm(), project_id: Number(sp.get('project')) || undefined }));
  const [media, setMedia] = useState([]);
  const [pending, setPending] = useState([]); // files queued before the property exists
  const [pendKind, setPendKind] = useState('cover');
  const [video, setVideo] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [aiMode, setAiMode] = useState(null); // AI writer drawer: 'titles' | 'description' | 'rewrite'
  const [sel, setSel] = useState(null); // last text selection in the title or description fields, for "Rewrite selection"
  const [aiUndo, setAiUndo] = useState(null); // { field, value } before the last AI change
  const [baseline, setBaseline] = useState(null);
  const typedCoords = useRef(false); // true once the person typed (or the record already holds) coordinates: automatic search then never overwrites them
  const geoSeq = useRef(0);
  const [geo, setGeo] = useState({ busy: false, msg: '', kind: '', options: [] });

  useEffect(() => {
    if (existing.data) { const loaded = { ...emptyForm(), ...existing.data, features: existing.data.features || {}, amenities: existing.data.amenities || [], videos: existing.data.videos || [] }; setF(loaded); setBaseline(JSON.stringify(loaded)); setMedia(existing.data.media || []); if (loaded.lat && loaded.lng) typedCoords.current = true; }
  }, [existing.data]);
  // unsaved changes: warn before the tab closes or the person leaves with Cancel
  useEffect(() => { if (!editing) setBaseline(JSON.stringify(f)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = baseline !== null && JSON.stringify(f) !== baseline;
  useEffect(() => {
    if (!dirty || busy) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, busy]);
  const LIMIT = { title: 140, short_desc: 200, description: 20000 };
  const trackSel = (field) => (e) => {
    const { selectionStart: start, selectionEnd: end, value } = e.target;
    setSel(end > start ? { field, start, end, text: value.slice(start, end) } : null);
  };
  /** Apply AI text to the form only. Returns false when the selected text changed since it was sent. */
  const applyAi = (field, value, how) => {
    const cur = String(f[field] ?? '');
    let next = value;
    if (how === 'append') next = cur ? `${cur.trimEnd()}\n\n${value}` : value;
    if (how === 'selection') {
      if (!sel || sel.field !== field || cur.slice(sel.start, sel.end) !== sel.text) { toast('That text has changed since you selected it. Select it again and rewrite.', 'err'); return false; }
      next = cur.slice(0, sel.start) + value + cur.slice(sel.end);
      setSel(null);
    }
    setAiUndo({ field, value: cur });
    set(field, next.slice(0, LIMIT[field]));
    return true;
  };

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setCoord = (k, v) => { typedCoords.current = true; setGeo((g) => (g.msg ? { ...g, msg: '', options: [] } : g)); set(k, v); };
  // Looks the typed place up on the map, most specific text first (address, location, area, city). Automatic searches (while typing, after a pause)
  // only fill coordinates the person has not typed; the Find on map button always replaces them.
  const geoParts = [f.address, f.location, f.area_name, f.city].map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2);
  const geoKey = geoParts.join('|');
  const lastGeoKey = useRef('');
  const findOnMap = async (auto) => {
    if (!geoParts.length) { if (!auto) setGeo({ busy: false, msg: 'Type a location or address first.', kind: 'err', options: [] }); return; }
    if (auto && typedCoords.current) return;
    lastGeoKey.current = geoKey;
    const seq = ++geoSeq.current;
    setGeo({ busy: true, msg: '', kind: '', options: [] });
    try {
      const { results, approximate } = await api.get(`/api/properties/geocode?${geoParts.map((x) => `p=${encodeURIComponent(x)}`).join('&')}`);
      if (seq !== geoSeq.current) return;
      if (auto && typedCoords.current) { setGeo({ busy: false, msg: '', kind: '', options: [] }); return; }
      if (!results.length) { setGeo({ busy: false, msg: 'No place found for that text. Try a nearby landmark or a different spelling, or enter the latitude and longitude by hand.', kind: 'err', options: [] }); return; }
      const top = results[0];
      setF((x) => ({ ...x, lat: top.lat, lng: top.lng }));
      setGeo({ busy: false, msg: `${approximate ? 'Only the wider area was found, so the pin is approximate. Zoom in and tap the map or drag the pin to the exact street. ' : ''}Coordinates filled from the map: ${top.label}. Tap the map or drag the pin to make it exact.`, kind: approximate ? 'warn' : 'ok', options: results.slice(1) });
    } catch (e) {
      if (seq === geoSeq.current) setGeo({ busy: false, msg: e.message || 'The map search is not available right now. Enter the latitude and longitude by hand.', kind: 'err', options: [] });
    }
  };
  useEffect(() => {
    if (!geoKey || typedCoords.current || geoKey === lastGeoKey.current) return undefined;
    const t = setTimeout(() => findOnMap(true), 800);
    return () => clearTimeout(t);
  }, [geoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const feat = (k, v) => setF((x) => ({ ...x, features: { ...x.features, [k]: v } }));
  const pk = getRegion().config.region === 'PK';
  const groupOf = (label) => getRegion().config.property_types?.find((t) => t.label === label)?.group;
  const isHouse = pk ? HOUSE_TYPES.includes(f.property_type) : ['Houses', 'Apartments'].includes(groupOf(f.property_type));
  const isPlot = pk ? PLOT_TYPES.includes(f.property_type) : groupOf(f.property_type) === 'Land';
  const net = Math.max(0, (Number(f.total_price) || 0) - (Number(f.discount) || 0));
  const ppu = Number(f.area_size) > 0 && Number(f.total_price) ? Math.round(Number(f.total_price) / Number(f.area_size)) : null;
  const imgCount = media.filter((m) => !/\.pdf$/i.test(m.path)).length + pending.length;
  const quality = useMemo(() => ({ amen: Math.min(100, Math.round(((f.amenities?.length || 0) / 5) * 100)), imgs: Math.min(100, Math.round((imgCount / 5) * 100)) }), [f.amenities, imgCount]);
  const locked = editing && existing.data?.status === 'sold';

  const validate = () => {
    const e = {};
    if (!f.title?.trim()) e.title = 'Title is required';
    if (!f.property_type) e.property_type = 'Select a property type';
    if (!f.project_id) e.project_id = 'Every unit must belong to a project';
    if (!f.total_price) e.total_price = 'Enter the total price';
    if (Number(f.discount) > Number(f.total_price)) e.discount = 'Discount cannot exceed the price';
    if (f.lat && Math.abs(f.lat) > 90) e.lat = 'Latitude must be within ±90';
    if (f.lng && Math.abs(f.lng) > 180) e.lng = 'Longitude must be within ±180';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const uploadPending = async (pid) => {
    for (const kind of [...new Set(pending.map((p) => p.kind))]) {
      const fd = new FormData(); fd.append('kind', kind);
      pending.filter((p) => p.kind === kind).forEach((p) => fd.append('files', p.file));
      await api.upload(`/api/properties/${pid}/media`, fd);
    }
  };

  const save = async (after) => {
    if (!validate()) { toast('Please fix the highlighted fields', 'err'); window.scrollTo?.(0, 0); document.getElementById('content')?.scrollTo({ top: 0 }); return; }
    setBusy(true);
    try {
      const body = { ...f, total_price: Number(f.total_price) || 0, discount: Number(f.discount) || 0, area_size: f.area_size === '' ? null : f.area_size };
      delete body.media; delete body.id; delete body.code; delete body.status;
      const saved = editing ? await api.put(`/api/properties/${id}`, body) : await api.post('/api/properties', body);
      if (pending.length) await uploadPending(saved.id);
      if (after === 'publish') await api.post(`/api/properties/${saved.id}/publish`);
      if (after === 'feature') { await api.post(`/api/properties/${saved.id}/publish`).catch(() => {}); await api.post(`/api/properties/${saved.id}/feature`); }
      toast(after === 'publish' ? 'Saved and published to website' : after === 'feature' ? 'Saved and featured' : 'Property saved', 'ok');
      nav(`/properties/${saved.id}`);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (editing && !existing.data) return existing.error ? <div className="alert err">{existing.error}</div> : <Loading />;
  const err = (k) => errors[k];

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto' }}>
      <BackLink to={editing ? `/properties/${id}` : '/properties'}>{editing ? 'Back to property' : 'Inventory'}</BackLink>
      <div className="page-head"><div className="grow"><h1>{editing ? `Edit ${existing.data.code}` : 'Add property'}</h1><div className="sub-title">{editing ? <StatusBadge status={existing.data.status} /> : 'New listings are saved as drafts until published.'}</div></div></div>
      {locked && <div className="alert warn" style={{ marginBottom: 12 }}>This property is sold — price fields are locked because the sale record holds them.</div>}
      <div className="card">
        <Section icon="map" title="Location & purpose" hint="Where is the property and what is it for?">
          <Field label="Select purpose"><ChipSelect value={f.purpose} onChange={(v) => set('purpose', v || 'Sell')} options={['Sell', 'Rent']} /></Field>
          <Field label="Property type" required error={err('property_type')}><ChipSelect value={f.property_type} onChange={(v) => set('property_type', v)} options={list('property_type')} /></Field>
          <div className="form-grid">
            <Field label="Project" required error={err('project_id')}><Select value={f.project_id} onChange={(v) => set('project_id', v ? Number(v) : null)} options={projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            {pk && <Field label="Block"><input className="input" value={f.block ?? ''} onChange={(e) => set('block', e.target.value)} /></Field>}
            {pk && <Field label="Sector"><input className="input" value={f.sector ?? ''} onChange={(e) => set('sector', e.target.value)} /></Field>}
            <Field label="Plot / unit number"><input className="input" value={f.plot_no ?? ''} onChange={(e) => set('plot_no', e.target.value)} placeholder="e.g. 2B" /></Field>
            {pk && <Field label="File number"><input className="input" value={f.file_no ?? ''} onChange={(e) => set('file_no', e.target.value)} placeholder="e.g. FL-12B" /></Field>}
            <Field label="Registration number"><input className="input" value={f.registration_no ?? ''} onChange={(e) => set('registration_no', e.target.value)} placeholder="e.g. REG-2026-0412" /></Field>
            {pk && <Field label="File status" hint="Is the file against this plot still running?"><Select value={f.file_status ?? ''} onChange={(v) => set('file_status', v)} placeholder="Not set" options={['Active', 'Inactive', 'Paused', 'Defaulted', 'Suspended']} /></Field>}
            {pk && <Field label="File notes"><input className="input" value={f.file_notes ?? ''} onChange={(e) => set('file_notes', e.target.value)} placeholder="e.g. Suspended by the authority until NOC" /></Field>}
            <Field label="City"><input className="input" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="Area / society"><input className="input" value={f.area_name ?? ''} onChange={(e) => set('area_name', e.target.value)} /></Field>
            <Field label="Location" className="full"><input className="input" value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Search or type a location" /></Field>
            <Field label="Address" className="full"><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="GPS latitude" error={err('lat')}><input className="input" type="number" step="any" value={f.lat ?? ''} onChange={(e) => setCoord('lat', e.target.value)} placeholder="31.4504" /></Field>
            <Field label="GPS longitude" error={err('lng')}><input className="input" type="number" step="any" value={f.lng ?? ''} onChange={(e) => setCoord('lng', e.target.value)} placeholder="73.1350" /></Field>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' }}>
            <button type="button" className="btn" disabled={geo.busy} onClick={() => findOnMap(false)}><Icon name="map" size={14} /> {geo.busy ? 'Finding…' : 'Find on map'}</button>
            <span className="muted" style={{ fontSize: 13 }}>Fills latitude and longitude from City, Area, Location and Address as you type. You can still change them.</span>
          </div>
          {geo.msg && <div className={`alert ${geo.kind === 'err' ? 'err' : geo.kind === 'warn' ? 'warn' : 'ok'}`} role="status" style={{ marginBottom: 10 }}>{geo.msg}</div>}
          {geo.options.length > 0 && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>Other matches: {geo.options.map((o, i) => <button key={i} type="button" className="btn sm ghost" style={{ margin: '2px 4px' }} onClick={() => { setF((x) => ({ ...x, lat: o.lat, lng: o.lng })); setGeo((g) => ({ ...g, msg: `Coordinates set to: ${o.label}.`, options: [] })); }}>{o.label.split(',').slice(0, 3).join(',')}</button>)}</div>}
          <PinPicker lat={f.lat} lng={f.lng} onChange={(la, ln) => { typedCoords.current = true; setGeo((g) => (g.msg ? { ...g, msg: '', options: [] } : g)); setF((x) => ({ ...x, lat: la, lng: ln })); }} />
        </Section>

        <Section icon="dollar" title="Price & area" hint="Size, price and payment options">
          <div className="form-grid">
            <Field label="Area size"><input className="input" type="number" min="0" step="any" value={f.area_size ?? ''} onChange={(e) => set('area_size', e.target.value)} /></Field>
            <Field label="Unit"><Select allowEmpty={false} value={f.unit} onChange={(v) => set('unit', v)} options={regionUnits()} /></Field>
            <Field label="Total price" required error={err('total_price')}><CurrencyInput value={f.total_price} onChange={(v) => set('total_price', v)} disabled={locked} /></Field>
            <Field label="Price per unit" hint="Calculated"><CurrencyInput value={ppu ?? ''} onChange={() => {}} disabled /></Field>
            <Field label="Discount" error={err('discount')}><CurrencyInput value={f.discount} onChange={(v) => set('discount', v === '' ? 0 : v)} disabled={locked} /></Field>
            <Field label="Net price" hint="Total − discount"><CurrencyInput value={net} onChange={() => {}} disabled /></Field>
          </div>
          <div className="row between" style={{ padding: '4px 0' }}><div><b>Installment available</b><div className="muted">Enable if the listing can be bought on installments</div></div><Toggle value={f.installment_available} onChange={(v) => set('installment_available', v)} /></div>
          <div className="row between" style={{ padding: '4px 0' }}><div><b>Ready for possession</b><div className="muted">Enable if the listing is ready for possession</div></div><Toggle value={f.ready_possession} onChange={(v) => set('ready_possession', v)} /></div>
        </Section>

        <Section icon="home" title="Features & amenities" hint="Details buyers search for">
          {isHouse && (<>
            <Field label="Bedrooms"><ChipSelect value={f.features.bedrooms != null ? String(f.features.bedrooms) : ''} onChange={(v) => feat('bedrooms', v)} options={BEDS} /></Field>
            <Field label="Bathrooms"><ChipSelect value={f.features.bathrooms != null ? String(f.features.bathrooms) : ''} onChange={(v) => feat('bathrooms', v)} options={BATHS} /></Field>
            <div className="form-grid">
              <Field label="Floors"><input className="input" type="number" min="0" value={f.features.floors ?? ''} onChange={(e) => feat('floors', e.target.value)} /></Field>
              <Field label="Kitchens"><input className="input" type="number" min="0" value={f.features.kitchen ?? ''} onChange={(e) => feat('kitchen', e.target.value)} /></Field>
            </div>
            <div className="row wrap" style={{ gap: 20 }}>{[['garage', 'Garage'], ['lawn', 'Lawn'], ['drawing_room', 'Drawing room'], ['dining_room', 'Dining room']].map(([k, l]) => <Check key={k} checked={f.features[k]} onChange={(v) => feat(k, v)}>{l}</Check>)}</div>
          </>)}
          {isPlot && (<>
            <div className="row wrap" style={{ gap: 20 }}>{[['corner', 'Corner'], ['park_facing', 'Park facing'], ['main_road', 'Main road'], ['boulevard', 'Boulevard']].map(([k, l]) => <Check key={k} checked={f.features[k]} onChange={(v) => feat(k, v)}>{l}</Check>)}</div>
            <div className="form-grid">
              <Field label="Possession"><input className="input" value={f.features.possession ?? ''} onChange={(e) => feat('possession', e.target.value)} placeholder="Immediate / 2027" /></Field>
              <Field label="Development status"><Select value={f.features.development_status} onChange={(v) => feat('development_status', v)} options={DEV_STATUS} /></Field>
            </div>
          </>)}
          {!isHouse && !isPlot && <div className="muted">Choose a property type to see its specific features.</div>}
          <Field label="Amenities"><ChipSelect multi value={f.amenities} onChange={(v) => set('amenities', v)} options={list('amenity')} /></Field>
          <div className="quality"><div className="row"><Icon name="check" /><div><b>Quality tip</b><div className="muted">Add at least 5 amenities</div></div></div><b style={{ color: quality.amen >= 100 ? 'var(--green)' : 'var(--red)' }}>{quality.amen}%</b></div>
        </Section>

        <Section icon="note" title="Ad information" hint="Title and description shown to buyers">
          <div className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setAiMode('titles')}><Icon name="bolt" size={14} /> Suggest titles</button>
            <button type="button" className="btn sm" onClick={() => setAiMode('description')}><Icon name="bolt" size={14} /> Draft descriptions</button>
            <button type="button" className="btn sm" disabled={!sel} title={sel ? undefined : 'Select text in the title or a description first'} onMouseDown={(e) => e.preventDefault()} onClick={() => setAiMode('rewrite')}><Icon name="bolt" size={14} /> Rewrite selection</button>
            {aiUndo && <button type="button" className="btn sm ghost" onClick={() => { set(aiUndo.field, aiUndo.value); setAiUndo(null); }}>Undo AI change</button>}
            <span className="muted">AI suggestions change this form only. Save to keep them; review and publishing stay as they are.</span>
          </div>
          <Field label="Property title" required error={err('title')}><input className="input" dir="auto" onSelect={trackSel('title')} value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="e.g. 10 Marla corner plot in Expert Residency" maxLength={140} /></Field>
          <Field label="Short description"><input className="input" dir="auto" onSelect={trackSel('short_desc')} value={f.short_desc ?? ''} onChange={(e) => set('short_desc', e.target.value)} maxLength={200} /></Field>
          <Field label="Full description"><textarea className="textarea" dir="auto" onSelect={trackSel('description')} rows={6} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Describe the property, its features, area, surroundings…" /></Field>
        </Section>

        <Section icon="image" title="Images & videos" hint="Photos, plans and videos. The cover is shown first.">
          {editing ? (
            <ImageUploader base={`/api/properties/${id}`} media={media} onChange={setMedia} kinds={KIND_OPTS} defaultKind="gallery" />
          ) : (
            <div>
              <div className="row" style={{ marginBottom: 8 }}><span className="muted">Upload as</span><select className="select" style={{ width: 190 }} value={pendKind} onChange={(e) => setPendKind(e.target.value)}>{KIND_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <FileUploader accept="image/*,video/*,application/pdf" onFiles={(files) => setPending((p) => [...p, ...files.map((file) => ({ file, kind: pendKind, url: URL.createObjectURL(file), key: Math.random() }))])} label="Drag photos or videos here, or click to browse" hint="Files upload when you save the property." />
              <div className="thumbs">{pending.map((p) => <div className="thumb" key={p.key}>{p.file.type.startsWith('video') ? <video src={p.url} muted /> : p.file.type === 'application/pdf' ? <div className="center-box" style={{ padding: 20 }}><Icon name="file" size={26} /></div> : <img src={p.url} alt="" />}<span className="cv">{p.kind}</span><button type="button" className="x" aria-label="Remove" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>×</button></div>)}</div>
            </div>
          )}
          <div className="quality"><div className="row"><Icon name="image" /><div><b>Quality tip</b><div className="muted">Add at least 5 images</div></div></div><b style={{ color: quality.imgs >= 100 ? 'var(--green)' : 'var(--red)' }}>{quality.imgs}%</b></div>
          <Field label="Videos (YouTube or direct video URL)" hint="Upload on YouTube and paste the link, or paste a direct .mp4 URL">
            <div className="row"><input className="input" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
              <button type="button" className="btn" onClick={() => { const v = video.trim(); if (!/^https?:\/\//i.test(v)) return toast('Enter a valid http(s) URL', 'err'); set('videos', [...(f.videos || []), v]); setVideo(''); }}>Add video</button></div>
            {(f.videos || []).map((v) => <div key={v} className="row between" style={{ marginTop: 6 }}><a href={v} target="_blank" rel="noreferrer" className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 480 }}>{v}</a><button type="button" className="btn sm ghost danger" onClick={() => set('videos', f.videos.filter((x) => x !== v))}>Remove</button></div>)}
          </Field>
        </Section>

        <Section icon="phone" title="Contact information" hint="Shown on the website listing">
          <div className="form-grid">
            <Field label="Property agent"><Select value={f.agent_id} onChange={(v) => set('agent_id', v ? Number(v) : null)} options={[...agents, ...users.filter((u) => u.role !== 'Sales Agent' && ['Sales Manager', 'Admin'].includes(u.role))].map((a) => ({ value: a.id, label: a.name }))} /></Field>
            <Field label="Email"><input className="input" type="email" value={f.contact_email ?? ''} onChange={(e) => set('contact_email', e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={f.contact_phone ?? ''} onChange={(e) => set('contact_phone', e.target.value)} /></Field>
            <Field label="WhatsApp"><input className="input" value={f.contact_whatsapp ?? ''} onChange={(e) => set('contact_whatsapp', e.target.value)} /></Field>
          </div>
        </Section>

        <Section icon="globe" title="Website publishing" hint="ERP is the source of truth — the website reads from here">
          <div className="alert info">Draft → hidden on website · Available → published · Featured → featured · Reserved → shown as reserved · Sold → sold / hidden. Use the buttons below to change state.</div>
          {editing && <div className="row wrap">Current: <StatusBadge status={existing.data.status} /> <span className="pill grey">{existing.data.review_state}</span> <span className={`pill ${existing.data.published ? 'green' : 'grey'}`}>{existing.data.published ? 'Live on website' : 'Not on website'}</span></div>}
        </Section>
        <div className="sticky-bar">
          <Link className="btn" to={editing ? `/properties/${id}` : '/properties'} onClick={(e) => { if (dirty && !window.confirm('Leave without saving your changes?')) e.preventDefault(); }}>Cancel</Link>
          <button className="btn" disabled={busy || locked && false} onClick={() => save()}>{editing ? 'Save changes' : 'Save draft'}</button>
          {can('properties', 'approve') && <button className="btn primary" disabled={busy} onClick={() => save('publish')}>Save & publish</button>}
          {can('properties', 'approve') && <button className="btn success" disabled={busy} onClick={() => save('feature')}>Save & feature</button>}
        </div>
      </div>
      {aiMode && <ListingAiWriter mode={aiMode} form={aiForm(f)} propertyId={editing ? Number(id) : null} selection={sel} current={{ title: f.title, short_desc: f.short_desc, description: f.description }}
        onApply={applyAi} onClose={() => setAiMode(null)} />}
    </div>
  );
}

/** The listing facts the AI writer may use from the unsaved form (no contacts, agent, file numbers or coordinates). */
const aiForm = (f) => Object.fromEntries(['title', 'purpose', 'property_type', 'project_id', 'block', 'sector', 'city', 'area_name', 'location', 'area_size', 'unit', 'total_price', 'discount',
  'installment_available', 'ready_possession', 'features', 'amenities', 'dev_status', 'short_desc', 'description'].map((k) => [k, f[k]]).filter(([, v]) => v !== undefined));
