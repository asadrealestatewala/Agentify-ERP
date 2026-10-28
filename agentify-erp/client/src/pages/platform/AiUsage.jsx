// AI usage & credits: Agentify's own Gemini connection, the monthly budget, and who uses AI (workspaces and plans).
// Money figures are estimates from prices the owner enters; nothing is priced by default.
import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, ErrorBox, Field, Loading, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const PURPOSES = { content_draft: 'Social post drafts', workspace_assistant: 'Workspace data assistant', property_writer: 'Property writer', website_builder: 'Website builder AI', promo_video: 'Promo video scripts', workspace_ai: 'Other workspace AI' };
const OWNER = { platform: 'Agentify key', tenant: 'Workspace key' };

function Settings({ s, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ api_key: '', model: s.model || '', budget_month: s.budget_month ?? '', price_in_per_m: s.price_in_per_m ?? '', price_out_per_m: s.price_out_per_m ?? '', currency: s.currency || 'USD', draft_daily_cap: s.draft_daily_cap });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => { setBusy(true); setErr(''); try { await api.put(`${A}/ai/settings`, { ...f, api_key: f.api_key || undefined }); toast('AI settings saved'); setF({ ...f, api_key: '' }); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the Gemini key? AI drafts stop until a key is added again.')) return; try { await api.del(`${A}/ai/settings/key`); toast('Key removed'); reload(); } catch (e) { setErr(e.message); } };
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <Card title="AI settings (Gemini)">
      <ErrorBox error={err} />
      <p className="muted" style={{ marginTop: 0 }}>{s.connected ? <><span className="pill green">Connected</span> key ending {s.key_hint}. </> : <><span className="pill grey">Not connected</span> </>}Create a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>. It is tested when saved, stored encrypted and never shown again. Google has no balance lookup, so credits left = the monthly budget below minus the estimated spend recorded here.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
        <Field label={s.connected ? 'Replace API key (optional)' : 'API key'}><TextInput type="password" value={f.api_key} onChange={set('api_key')} placeholder="AIza…" autoComplete="off" /></Field>
        <Field label="Model" hint="Leave empty for the default"><TextInput value={f.model} onChange={set('model')} /></Field>
        <Field label="Money label" hint="For example USD"><TextInput value={f.currency} onChange={set('currency')} maxLength={6} /></Field>
        <Field label="Monthly AI budget" hint="Drafts stop when the estimate reaches it"><input className="input" type="number" min={0} step="any" value={f.budget_month} onChange={(e) => set('budget_month')(e.target.value)} /></Field>
        <Field label="Input price per 1M tokens" hint="Copy from Google's current pricing page"><input className="input" type="number" min={0} step="any" value={f.price_in_per_m} onChange={(e) => set('price_in_per_m')(e.target.value)} /></Field>
        <Field label="Output price per 1M tokens" hint="Thinking tokens count as output"><input className="input" type="number" min={0} step="any" value={f.price_out_per_m} onChange={(e) => set('price_out_per_m')(e.target.value)} /></Field>
        <Field label="AI post drafts per day" hint="Placeholder limit; 0 switches drafts off"><input className="input" type="number" min={0} value={f.draft_daily_cap} onChange={(e) => set('draft_daily_cap')(e.target.value)} /></Field>
      </div>
      <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} onClick={save}>Save settings</button>{s.connected && <button className="btn" onClick={remove}>Remove key</button>}</div>
    </Card>
  );
}

function Table({ title, rows, cols, empty }) {
  return (
    <Card title={title}>
      {!rows.length ? <p className="muted" style={{ margin: 0 }}>{empty}</p> : (
        <div className="table-wrap"><table className="table"><thead><tr>{cols.map((c) => <th key={c[0]} className={c[2] ? 'num' : ''}>{c[0]}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c[0]} className={c[2] ? 'num' : ''}>{c[1](r)}</td>)}</tr>)}</tbody></table></div>)}
    </Card>
  );
}

export default function AiUsagePage() {
  const can = useCan();
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api.get(`${A}/ai/usage`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const { month: m, settings: s } = d;
  const cur = s.currency;
  const est = (v) => (v == null ? '—' : `${cur} ${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);
  const tok = (r) => n0(r.input_tokens + r.output_tokens);
  const days = [...new Set(d.daily.map((x) => x.day))].map((day) => ({ day: day.slice(5), platform: d.daily.find((x) => x.day === day && x.key_owner === 'platform')?.tokens || 0, tenant: d.daily.find((x) => x.day === day && x.key_owner === 'tenant')?.tokens || 0 }));
  const pct = m.budget && m.spent != null ? Math.min(100, Math.round((m.spent / m.budget) * 100)) : null;
  return (
    <>
      <PageTitle title="AI usage & credits" sub="What Agentify's Gemini key is used for, credits used and left this month, and which workspaces and plans use AI." />
      <div className="cc-stats">
        <Card><div className="cc-k">Credits used this month</div><div className="cc-v">{est(m.spent)}</div><div className="cell-sub">{n0(m.input_tokens + m.output_tokens)} tokens · {n0(m.calls)} calls</div></Card>
        <Card><div className="cc-k">Credits left this month</div><div className="cc-v">{est(m.left)}</div><div className="cell-sub">{m.budget != null ? `of a ${cur} ${m.budget} budget${pct != null ? ` (${pct}% used)` : ''}` : 'Set a monthly budget below'}</div></Card>
        <Card><div className="cc-k">Gemini</div><div className="cc-v">{s.connected ? 'Connected' : 'Not connected'}</div><div className="cell-sub">{s.connected ? s.model : 'Add a key below'}</div></Card>
        <Card><div className="cc-k">Workspace-key AI (30 days)</div><div className="cc-v">{n0((d.owners.tenant?.input_tokens || 0) + (d.owners.tenant?.output_tokens || 0))} tokens</div><div className="cell-sub">Paid by workspaces, not Agentify</div></Card>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{d.notes.estimate} {d.notes.tenant_keys}</p>
      {days.length > 0 && <Card title="Tokens per day (last 30 days)"><div style={{ height: 220 }}><ResponsiveContainer><BarChart data={days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
        <Bar dataKey="platform" name="Agentify key" stackId="a" fill="#0e7c6b" /><Bar dataKey="tenant" name="Workspace keys" stackId="a" fill="#94a3b8" /></BarChart></ResponsiveContainer></div></Card>}
      <Table title="By workspace (last 30 days)" rows={d.by_tenant} empty="No AI calls recorded yet."
        cols={[['Workspace', (r) => r.name ? <>{r.name} <span className="muted">{r.slug}</span></> : 'Agentify itself'], ['Plan', (r) => r.current_plan || '—'], ['Key', (r) => OWNER[r.key_owner]], ['Calls', (r) => n0(r.calls), 1], ['Tokens', tok, 1], ['Est. cost', (r) => est(r.est_cost), 1]]} />
      <Table title="By subscription plan (last 30 days)" rows={d.by_plan} empty="No AI calls recorded yet."
        cols={[['Plan', (r) => r.plan], ['Key', (r) => OWNER[r.key_owner]], ['Workspaces', (r) => n0(r.tenants), 1], ['Calls', (r) => n0(r.calls), 1], ['Tokens', tok, 1], ['Est. cost', (r) => est(r.est_cost), 1]]} />
      <Table title="By use (last 30 days)" rows={d.by_purpose} empty="No AI calls recorded yet."
        cols={[['Use', (r) => PURPOSES[r.purpose] || r.purpose], ['Key', (r) => OWNER[r.key_owner]], ['Calls', (r) => n0(r.calls), 1], ['Tokens', tok, 1], ['Est. cost', (r) => est(r.est_cost), 1]]} />
      {can('integrations.manage') ? <Settings s={s} reload={load} /> : <Card title="AI settings"><p className="muted" style={{ margin: 0 }}>Your role cannot change the AI connection or budget.</p></Card>}
    </>
  );
}
