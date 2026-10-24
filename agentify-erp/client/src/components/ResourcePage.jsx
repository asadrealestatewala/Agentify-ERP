import { useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable } from './DataTable.jsx';
import Icon from './Icon.jsx';
import { Card, CurrencyInput, ConfirmDialog, Field, Modal, PageHead, Select, TagInput, Toggle } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useLookups, useMeta, useToast, useUndoDelete } from '../context.jsx';
import { checkField } from '../validate.js';

/** Renders one form control from a field spec. */
export function FieldInput({ f, value, onChange, form }) {
  const { list } = useLookups();
  const options = typeof f.options === 'function' ? f.options(form) : f.lookup ? list(f.lookup) : f.options;
  const set = (v) => onChange(f.name, v);
  switch (f.type) {
    case 'textarea': return <textarea className="textarea" value={value ?? ''} onChange={(e) => set(e.target.value)} rows={f.rows || 3} />;
    case 'select': return <Select value={value} onChange={(v) => set(f.number && v !== '' ? Number(v) : v)} options={options || []} placeholder={f.placeholder} allowEmpty={f.allowEmpty !== false} />;
    case 'money': return <CurrencyInput value={value} onChange={set} />;
    case 'bool': return <Toggle value={!!value} onChange={set} label={f.toggleLabel} />;
    case 'tags': return <TagInput value={value || []} onChange={set} />;
    case 'number': return <input className="input" type="number" min={f.min} max={f.max} step={f.step || 'any'} value={value ?? ''} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date': return <input className="input" type="date" value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'color': return <input type="color" value={value || '#2563eb'} onChange={(e) => set(e.target.value)} style={{ width: 60, height: 34, border: '1px solid var(--border-2)', borderRadius: 7, background: 'var(--surface)' }} />;
    case 'activity': return <input className="input" list="activity-library" value={value ?? ''} onChange={(e) => set(e.target.value)} placeholder="e.g. Footing work, Slab work, Scaffolding work, Masonry…" autoFocus />;
    case 'password': return <input className="input" type="password" autoComplete="new-password" value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    default: return <input className="input" type={f.type || 'text'} value={value ?? ''} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
  }
}

/** Standard create/edit modal driven by field specs. */
export function FormModal({ title, fields, initial = {}, onSave, onClose, size = 'lg', submitLabel = 'Save', extra }) {
  const [form, setForm] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    for (const f of fields) if (f.required && (form[f.name] === undefined || form[f.name] === null || form[f.name] === '') && (!f.showIf || f.showIf(form))) return setErr(`${f.label} is required`);
    for (const f of fields) {
      if (f.showIf && !f.showIf(form)) continue;
      const bad = checkField(f.name, form[f.name], { person: !!f.person });
      if (bad) return setErr(`${f.label}: ${bad}`);
    }
    setBusy(true); setErr('');
    try { await onSave(form); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} size={size} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button></>}>
      <form onSubmit={submit} className="stack">
        {err && <div className="alert err">{err}</div>}
        <div className="form-grid">
          {fields.filter((f) => !f.showIf || f.showIf(form)).map((f) => (
            <Field key={f.name} label={f.label} required={f.required} hint={f.hint} className={f.full || f.type === 'textarea' || f.type === 'tags' ? 'full' : ''}>
              <FieldInput f={f} value={form[f.name]} onChange={set} form={form} />
            </Field>
          ))}
        </div>
        {extra}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/**
 * Config-driven master list: search, pagination, create/edit modal, delete.
 * Used for vendors, holidays, lookups, commission rules, custom fields, etc.
 */
export default function ResourcePage({
  title, sub, endpoint, module, columns, fields, defaults = {}, filters = {}, filterUI, rowLink, noun = 'record', createLabel, extraActions,
  rowActions, transformSave, canDeleteRow, exportName, embedded, tableId, onChanged, toForm, sort, dir, limit = 25, emptyText,
}) {
  const { can } = useAuth();
  const toast = useToast();
  const { reload: reloadMeta } = useMeta();
  const t = useTable(endpoint, { sort, dir, filters, limit });
  const { hidden, remove } = useUndoDelete(`res:${endpoint}`, () => reloadMeta());
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const save = async (form) => {
    const body = transformSave ? transformSave(form) : form;
    if (form.id) await api.put(`${endpoint}/${form.id}`, body); else await api.post(endpoint, body);
    toast(`${noun[0].toUpperCase() + noun.slice(1)} saved`, 'ok');
    setEditing(null); t.reload(); onChanged?.(); reloadMeta();
  };
  const cols = columns.map((c) => (c.link && rowLink ? { ...c, render: (r) => <Link to={rowLink(r)} className="cell-main">{c.render ? c.render(r) : r[c.key]}</Link> } : c));
  const body = (
    <Card flush>
      <div className="toolbar">
        <SearchBar value={t.q} onChange={t.setQ} placeholder={`Search ${noun}s…`} />
        {filterUI?.(t)}
        <div className="grow" />
        {exportName && <ExportMenu url={endpoint} params={t.params} name={exportName} module={module} />}
      </div>
      <DataTable {...t.tableProps} hiddenIds={hidden} columns={cols} tableId={tableId} emptyText={emptyText}
        rowActions={(r) => (
          <>
            {rowActions?.(r, t.reload)}
            {can(module, 'edit') && fields && <button onClick={() => setEditing(toForm ? toForm(r) : r)}>Edit</button>}
            {can(module, 'delete') && (!canDeleteRow || canDeleteRow(r)) && <button className="danger" onClick={() => setDeleting(r)}>Delete</button>}
          </>
        )} />
    </Card>
  );
  return (
    <div>
      {!embedded && (
        <PageHead title={title} sub={sub}>
          {extraActions}
          {fields && can(module, 'create') && <button className="btn primary" onClick={() => setEditing({ ...defaults })}><Icon name="plus" size={14} />{createLabel || `Add ${noun}`}</button>}
        </PageHead>
      )}
      {embedded && fields && can(module, 'create') && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}><button className="btn primary sm" onClick={() => setEditing({ ...defaults })}><Icon name="plus" size={13} />{createLabel || `Add ${noun}`}</button></div>}
      {t.error && <div className="alert err" style={{ marginBottom: 10 }}>{t.error}</div>}
      {body}
      {editing && <FormModal title={editing.id ? `Edit ${noun}` : createLabel || `Add ${noun}`} fields={fields} initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog danger title={`Delete ${noun}`} message="This action cannot be undone." confirmLabel="Delete" onCancel={() => setDeleting(null)}
        onConfirm={async () => { const row = deleting; setDeleting(null); remove(row.id, `${noun[0].toUpperCase() + noun.slice(1)} deleted`, () => api.del(`${endpoint}/${row.id}`)); }} />}
    </div>
  );
}
