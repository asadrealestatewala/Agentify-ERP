// Console page: which regions workspaces can pick, their feature switches, legal rules awaiting review, and exchange rates.
import { useCallback, useEffect, useState } from 'react';
import { FoldCard } from './Fold.jsx';
import { Card, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

export function RegionsPage() {
  const toast = useToast();
  const can = useCan();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [rules, setRules] = useState(null);
  const [fx, setFx] = useState(null);
  const load = useCallback(() => api.get(`${A}/regions`).then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { try { await fn(); toast(ok); load(); } catch (e) { toast(e.message, 'err'); } };
  const openRules = (code) => api.get(`${A}/regions/${code}/rules`).then((x) => setRules({ code, ...x })).catch((e) => toast(e.message, 'err'));
  const manage = can('regions.manage');
  return (
    <>
      <PageTitle title="Regions" sub="A region becomes available at signup only when it is active. Rules stay marked for legal review until a person signs them off; nothing here is legal advice." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>Region</th><th>Currency</th><th>Status</th><th>Workspaces</th><th>Rules</th><th>Switches</th><th /></tr></thead><tbody>
            {d.regions.map((r) => (
              <tr key={r.code}>
                <td><b>{r.name}</b> <span className="muted">{r.code} · v{r.versions[0]?.version}</span></td>
                <td>{r.currency}</td>
                <td><StatusBadge status={r.status === 'active' ? 'active' : 'pending'} label={r.status} /></td>
                <td>{r.workspaces}</td>
                <td>{r.rules}{r.unreviewed_rules ? <span className="muted"> · {r.unreviewed_rules} to review</span> : ''}</td>
                <td>{Object.entries(r.flags).map(([f, on]) => (
                  <label key={f} className="muted" style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={!!on} disabled={!manage} onChange={(e) => run(() => api.post(`${A}/regions/${r.code}/flags`, { flag: f, enabled: e.target.checked }), 'Saved')} /> {f}
                  </label>))}</td>
                <td className="right nowrap">
                  <button className="btn sm" onClick={() => openRules(r.code)}>Rules</button>{' '}
                  {manage && r.code !== 'PK' && (r.status === 'active'
                    ? <button className="btn sm" disabled={r.workspaces > 0} onClick={() => run(() => api.post(`${A}/regions/${r.code}/status`, { status: 'draft' }), 'Back to draft')}>Make draft</button>
                    : <button className="btn sm primary" onClick={() => run(() => api.post(`${A}/regions/${r.code}/status`, { status: 'active' }), 'Region is now available at signup')}>Activate</button>)}
                </td>
              </tr>))}
          </tbody></table></div></Card>
          <FoldCard id="Regions-Exchange rates" title="Exchange rates" summary="Rates used to show prices in other currencies" defaultOpen  flush>
            {manage && <div style={{ padding: 12 }}><button className="btn sm primary" onClick={() => setFx({ base: 'USD', quote: 'PKR', rate: '' })}>Add rate</button></div>}
            {!d.fx.length ? <Empty title="No exchange rates yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>From</th><th>To</th><th>Rate</th><th>As of</th><th>Source</th></tr></thead><tbody>
              {d.fx.map((x) => <tr key={`${x.base}${x.quote}${x.as_of}`}><td>{x.base}</td><td>{x.quote}</td><td className="mono">{x.rate}</td><td>{x.as_of}</td><td className="muted">{x.source}</td></tr>)}
            </tbody></table></div>}
          </FoldCard>
        </>
      )}
      {rules && (
        <Modal title={`Rules — ${rules.code}`} size="lg" onClose={() => setRules(null)} footer={<button className="btn" onClick={() => setRules(null)}>Close</button>}>
          {!rules.rules.length ? <Empty title="No rules yet" hint="Rules arrive with each region's compliance phase." /> : <div className="table-wrap"><table className="t"><thead><tr><th>Rule</th><th>Version</th><th>Effective</th><th>Value</th><th>Review</th></tr></thead><tbody>
            {rules.rules.map((x) => (
              <tr key={x.id}><td><b>{x.kind}</b> · {x.key}{x.sub_region ? ` (${x.sub_region})` : ''}</td><td>{x.version}</td><td>{x.effective_from}{x.effective_to ? ` → ${x.effective_to}` : ''}</td><td className="mono">{x.value}</td>
                <td>{x.needs_legal_review
                  ? (manage ? <button className="btn sm" onClick={() => run(async () => { await api.post(`${A}/regions/rules/${x.id}/review`); await openRules(rules.code); }, 'Marked as reviewed')}>Mark reviewed</button> : 'Needs review')
                  : <span className="muted">by {x.reviewed_by}</span>}</td></tr>))}
          </tbody></table></div>}
        </Modal>
      )}
      {fx && (
        <Modal title="Add exchange rate" onClose={() => setFx(null)} footer={<><button className="btn" onClick={() => setFx(null)}>Cancel</button>
          <button className="btn primary" onClick={() => run(async () => { await api.post(`${A}/fx`, { ...fx, rate: Number(fx.rate) }); setFx(null); }, 'Saved')}>Save</button></>}>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="From (currency code)"><TextInput value={fx.base} onChange={(v) => setFx({ ...fx, base: v.toUpperCase() })} /></Field>
            <Field label="To (currency code)"><TextInput value={fx.quote} onChange={(v) => setFx({ ...fx, quote: v.toUpperCase() })} /></Field>
          </div>
          <Field label="Rate" hint="How many units of the second currency one unit of the first buys"><TextInput value={fx.rate} onChange={(v) => setFx({ ...fx, rate: v })} /></Field>
        </Modal>
      )}
    </>
  );
}
