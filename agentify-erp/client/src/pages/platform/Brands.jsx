// Brands: groups of workspaces that share a logo and colours. Nothing else is shared; every workspace keeps its own data,
// staff, clients, fees and accounts. Add a workspace to a brand from the brand page or from the workspace's own page.
import { useCallback, useEffect, useState } from 'react';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();

/** Shrink a chosen logo to a small PNG/WebP so it fits comfortably in the brand record. */
function shrinkLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Use a PNG, JPG or WebP image'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('The file could not be read'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be opened'));
      img.onload = () => {
        const scale = Math.min(1, 400 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL('image/webp', 0.9);
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
        out.length <= 150000 ? resolve(out) : reject(new Error('The logo is still too large after shrinking. Use a simpler image.'));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

const Swatch = ({ c }) => (c ? <span title={c} style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid var(--line, #d1d5db)', verticalAlign: 'middle' }} /> : <span className="muted">—</span>);

function ColourField({ label, value, onChange, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="row" style={{ gap: 8 }}>
        <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#0e7c6b'} onChange={(e) => onChange(e.target.value)} style={{ width: 40, height: 34, padding: 0, border: 0, background: 'none' }} />
        <TextInput value={value || ''} onChange={onChange} placeholder="#0e7c6b" maxLength={7} />
        {value && <button type="button" className="btn sm" onClick={() => onChange('')}>Clear</button>}
      </div>
    </Field>
  );
}

function Editor({ brand, canEdit, onClose, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ name: brand?.name || '', owner_email: brand?.owner_email || '', primary_color: brand?.primary_color || '', accent_color: brand?.accent_color || '', logo: brand?.logo || null });
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const loadDetail = useCallback(() => (brand ? api.get(`${A}/brands/${brand.id}`).then(setDetail).catch((e) => setErr(e.message)) : null), [brand]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const out = brand ? await api.put(`${A}/brands/${brand.id}`, f) : { sync: [], brand: await api.post(`${A}/brands`, f) };
      const failed = (out.sync || []).filter((s) => !s.ok).length;
      toast(brand ? `Brand saved${out.sync?.length ? ` and applied to ${out.sync.length - failed} workspace${out.sync.length - failed === 1 ? '' : 's'}` : ''}${failed ? `; ${failed} could not be updated` : ''}` : 'Brand created. Add workspaces to it next.');
      reload(); if (brand) loadDetail(); else onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const logo = async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { set('logo')(await shrinkLogo(file)); setErr(''); } catch (x) { setErr(x.message); } };
  const setMain = async (tenantId) => { try { await api.put(`${A}/brands/${brand.id}/main`, { tenant_id: tenantId }); loadDetail(); reload(); } catch (e) { toast(e.message, 'err'); } };
  const remove = async (tenantId) => { try { await api.put(`${A}/workspaces/${tenantId}/brand`, { brand_id: null }); toast('Workspace removed from the brand'); loadDetail(); reload(); } catch (e) { toast(e.message, 'err'); } };
  const del = async () => { try { await api.del(`${A}/brands/${brand.id}`); toast('Brand deleted. Its workspaces keep the logo and colour last applied and can change them again.'); reload(); onClose(); } catch (e) { toast(e.message, 'err'); } };
  const ro = !canEdit;
  const roll = detail?.rollup;
  return (
    <Modal title={brand ? brand.name : 'Add a brand'} size="lg" onClose={onClose}
      footer={<>{brand && canEdit && <button className="btn danger" onClick={() => setConfirm(true)} style={{ marginRight: 'auto' }}>Delete brand</button>}<button className="btn" onClick={onClose}>Close</button>{canEdit && <button className="btn primary" disabled={busy} onClick={save}>{brand ? 'Save and apply' : 'Create brand'}</button>}</>}>
      <ErrorBox error={err} />
      <div className="pa-grid2" style={{ marginBottom: 12 }}>
        <Field label="Brand name" required><TextInput value={f.name} onChange={set('name')} disabled={ro} /></Field>
        <Field label="Owner email" hint="The person who runs these workspaces (for your reference)"><TextInput value={f.owner_email} onChange={set('owner_email')} disabled={ro} placeholder="owner@company.com" /></Field>
        <ColourField label="Primary colour" value={f.primary_color} onChange={ro ? () => {} : set('primary_color')} hint="Used as the workspace colour in every member. Must be dark enough for white text." />
        <ColourField label="Accent colour" value={f.accent_color} onChange={ro ? () => {} : set('accent_color')} hint="Kept with the brand for later use; not shown in the app yet." />
        <Field label="Logo" hint="PNG, JPG or WebP. Shown at the top left of every member workspace.">
          <div className="row" style={{ gap: 10 }}>
            {f.logo ? <img src={f.logo} alt="Brand logo" style={{ height: 40, maxWidth: 140, objectFit: 'contain', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, padding: 4, background: '#fff' }} /> : <span className="muted">No logo</span>}
            {!ro && <label className="btn sm"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={logo} style={{ display: 'none' }} />Choose…</label>}
            {!ro && f.logo && <button type="button" className="btn sm" onClick={() => set('logo')(null)}>Remove</button>}
          </div>
        </Field>
      </div>
      {brand && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>Only the logo and primary colour are shared. Fees, billing, staff, clients, deals and accounts stay separate in every workspace, and there is no shared access between them. Saving applies the look to every member straight away.</p>
          {!detail ? <Loading rows={2} /> : (
            <>
              <div className="cc-stats">
                <Card><div className="cc-k">Workspaces</div><div className="cc-v">{n0(roll.workspaces)}</div><div className="cell-sub">{n0(roll.active)} active · {n0(roll.paying)} paying</div></Card>
                <Card><div className="cc-k">Seats</div><div className="cc-v">{n0(roll.seats)}</div><div className="cell-sub">Read-only total</div></Card>
                <Card><div className="cc-k">Contacts / properties</div><div className="cc-v">{n0(roll.contacts)} / {n0(roll.properties)}</div><div className="cell-sub">Counts only; each workspace sees its own</div></Card>
                <Card><div className="cc-k">Sales / receipts</div><div className="cc-v">{n0(roll.sales)} / {n0(roll.receipts)}</div><div className="cell-sub">Counts only</div></Card>
              </div>
              <Card title="Workspaces in this brand" flush>
                {!detail.workspaces.length ? <p className="muted" style={{ margin: 12 }}>None yet. Open a workspace (Workspaces &gt; Company profile) and choose this brand.</p> : (
                  <div className="table-wrap"><table className="table"><thead><tr><th>Workspace</th><th>Owner</th><th>Status</th><th>Main</th>{canEdit && <th />}</tr></thead><tbody>
                    {detail.workspaces.map((w) => (
                      <tr key={w.id}><td>{w.name} <span className="muted">{w.slug}</span></td><td>{w.owner_email || '—'}</td><td>{w.status}</td>
                        <td>{w.main ? <span className="pill green">Main</span> : canEdit ? <button className="btn sm" onClick={() => setMain(w.id)}>Make main</button> : '—'}</td>
                        {canEdit && <td className="right"><button className="btn sm" onClick={() => remove(w.id)}>Remove</button></td>}</tr>))}
                  </tbody></table></div>)}
              </Card>
            </>)}
        </>)}
      {confirm && <ConfirmDialog title="Delete this brand?" message="Its workspaces become independent. They keep the logo and colour last applied and can change them again. Nothing else is touched." confirmLabel="Delete brand" danger onConfirm={del} onCancel={() => setConfirm(false)} />}
    </Modal>
  );
}

export default function BrandsPage() {
  const can = useCan();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`${A}/brands`).then((x) => { setRows(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const canEdit = can('workspaces.edit');
  return (
    <>
      <PageTitle title="Brands" sub="Groups of workspaces that share a logo and colours. Each workspace keeps its own data, staff, clients, fees and accounts.">
        {canEdit && <button className="btn primary" onClick={() => setOpen('new')}>Add a brand</button>}
      </PageTitle>
      <ErrorBox error={err} />
      {!rows ? (!err && <Loading />) : !rows.length ? <Empty title="No brands yet" hint="Add a brand when one owner runs several branches or franchise offices that should look the same." /> : (
        <Card flush><div className="table-wrap"><table className="table"><thead><tr><th>Brand</th><th>Owner</th><th>Colours</th><th className="num">Workspaces</th><th>Main workspace</th><th /></tr></thead><tbody>
          {rows.map((b) => (
            <tr key={b.id}><td><b>{b.name}</b></td><td>{b.owner_email || '—'}</td><td><Swatch c={b.primary_color} /> <Swatch c={b.accent_color} /></td>
              <td className="num">{b.workspaces.length}</td><td>{b.workspaces.find((w) => w.main)?.name || '—'}</td>
              <td className="right"><button className="btn sm" onClick={() => setOpen(b)}>{canEdit ? 'Open' : 'View'}</button></td></tr>))}
        </tbody></table></div></Card>)}
      {open && <Editor brand={open === 'new' ? null : open} canEdit={canEdit} onClose={() => setOpen(null)} reload={load} />}
    </>
  );
}
