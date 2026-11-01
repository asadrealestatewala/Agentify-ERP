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


/** Limits for AI that workspaces run with their own keys: kill switch, monthly cap, feature switches and a limit per workspace. */
function WorkspaceControls({ canEdit }) {
  const toast = useToast();
  const [c, setC] = useState(null); const [err, setErr] = useState('');
  const [g, setG] = useState({ default_daily_limit: '', default_stt_daily_limit: '', monthly_cap: '' });
  const load = useCallback(() => api.get(`${A}/ai/controls`).then((x) => { setC(x); setG({ default_daily_limit: x.default_daily_limit ?? '', default_stt_daily_limit: x.default_stt_daily_limit ?? '', monthly_cap: x.month.cap ?? '' }); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const put = async (url, body, msg) => { try { await api.put(url, body); toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };
  if (err && !c) return <ErrorBox error={err} />;
  if (!c) return <Loading rows={2} />;
  const cur = c.currency;
  const est = (v) => (v == null ? '—' : `${cur} ${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);
  return (
    <>
      <Card title="Workspace AI controls" actions={c.kill_switch ? <span className="pill red">AI is switched off for all workspaces</span> : <span className="pill green">AI is on</span>}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>These apply to AI that workspaces run with their own provider keys (data assistant, property writer, website builder, promo video scripts). Limits are checked before a feature starts. Agentify's own Gemini drafts have their own budget above. Call and meeting transcripts (speech to text) are counted as calls, can be switched off below, and can have their own daily limit.</p>
        {canEdit && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, alignItems: 'end' }}>
            <Field label="Default daily calls per workspace" hint="Empty means no limit. A workspace's own limit below wins."><input className="input" type="number" min={0} value={g.default_daily_limit} onChange={(e) => setG({ ...g, default_daily_limit: e.target.value })} /></Field>
            <Field label="Default daily transcripts per workspace" hint="Call and meeting recordings turned into text. Empty means no separate limit."><input className="input" type="number" min={0} value={g.default_stt_daily_limit} onChange={(e) => setG({ ...g, default_stt_daily_limit: e.target.value })} /></Field>
            <Field label={`Monthly cap on workspace AI (${cur})`} hint={c.prices_set ? 'Estimated from the prices above; AI pauses for everyone when reached' : 'Enter the provider prices first'}><input className="input" type="number" min={0} step="any" value={g.monthly_cap} disabled={!c.prices_set} onChange={(e) => setG({ ...g, monthly_cap: e.target.value })} /></Field>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => put(`${A}/ai/controls`, { default_daily_limit: g.default_daily_limit, default_stt_daily_limit: g.default_stt_daily_limit, ...(c.prices_set ? { monthly_cap: g.monthly_cap } : {}) }, 'Limits saved')}>Save limits</button>
              <button className={`btn ${c.kill_switch ? '' : 'danger'}`} onClick={() => { if (c.kill_switch || window.confirm('Switch AI off for every workspace now? Features that use AI stop until you switch it back on.')) put(`${A}/ai/controls`, { kill_switch: !c.kill_switch }, c.kill_switch ? 'AI is on again' : 'AI is switched off for all workspaces'); }}>{c.kill_switch ? 'Switch AI back on' : 'Kill switch'}</button>
            </div>
          </div>)}
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>This month: {n0(c.month.calls)} calls · {n0(c.month.input_tokens + c.month.output_tokens)} tokens · estimated {est(c.month.spent)}{c.month.cap != null ? ` of a ${cur} ${c.month.cap} cap${c.month.over ? ' (reached, AI is paused)' : ''}` : ''}</p>
      </Card>
      <Table title="Workspace AI by feature (this month)" rows={c.features} empty=""
        cols={[['Feature', (r) => r.label], ['Calls', (r) => n0(r.calls), 1], ['Tokens', (r) => n0(r.input_tokens + r.output_tokens), 1], ['Est. cost', (r) => est(r.est_cost), 1],
          ['Switch', (r) => (canEdit ? <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={r.enabled} onChange={(e) => put(`${A}/ai/controls`, { features: { [r.key]: e.target.checked } }, `${r.label} ${e.target.checked ? 'on' : 'off'}`)} aria-label={`${r.label} on or off`} />{r.enabled ? 'On' : 'Off'}</label> : r.enabled ? 'On' : 'Off')]]} />
      <Card title="Workspace AI by workspace" flush>
        <div className="table-wrap"><table className="table"><thead><tr><th>Workspace</th><th>Plan</th><th className="num">Calls today</th><th className="num">Daily limit</th><th className="num">Daily transcripts</th><th className="num">Calls this month</th><th className="num">Est. cost this month</th><th>AI</th></tr></thead><tbody>
          {c.workspaces.map((w) => <WsRow key={w.id} w={w} canEdit={canEdit} est={est} def={c.default_daily_limit} defStt={c.default_stt_daily_limit} save={(body) => put(`${A}/ai/workspaces/${w.id}`, body, `${w.name}: saved`)} />)}
        </tbody></table></div>
      </Card>
    </>
  );
}
function WsRow({ w, canEdit, est, save, def, defStt }) {
  const [stt, setStt] = useState(w.stt_daily_limit ?? '');
  useEffect(() => { setStt(w.stt_daily_limit ?? ''); }, [w.stt_daily_limit]);
  const sttDirty = String(w.stt_daily_limit ?? '') !== String(stt);
  const [lim, setLim] = useState(w.daily_call_limit ?? '');
  useEffect(() => { setLim(w.daily_call_limit ?? ''); }, [w.daily_call_limit]);
  const dirty = String(w.daily_call_limit ?? '') !== String(lim);
  return (
    <tr><td>{w.name} <span className="muted">{w.slug}</span></td><td>{w.plan}</td><td className="num">{n0(w.calls_today)}</td>
      <td className="num">{canEdit ? <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><input className="input" style={{ width: 90 }} type="number" min={0} value={lim} placeholder={def != null ? `${def} (default)` : 'No limit'} onChange={(e) => setLim(e.target.value)} aria-label={`${w.name} daily call limit`} />{dirty && <button className="btn sm" onClick={() => save({ daily_call_limit: lim })}>Save</button>}</span> : (w.effective_limit ?? 'No limit')}</td>
      <td className="num">{canEdit ? <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><input className="input" style={{ width: 90 }} type="number" min={0} value={stt} placeholder={defStt != null ? `${defStt} (default)` : 'No limit'} onChange={(e) => setStt(e.target.value)} aria-label={`${w.name} daily transcript limit`} />{sttDirty && <button className="btn sm" onClick={() => save({ stt_daily_limit: stt })}>Save</button>}</span> : (w.stt_daily_limit ?? defStt ?? 'No limit')}</td>
      <td className="num">{n0(w.calls_month)}</td><td className="num">{est(w.est_cost_month)}</td>
      <td>{canEdit ? <button className={`btn sm ${w.ai_enabled ? '' : 'danger'}`} onClick={() => save({ ai_enabled: !w.ai_enabled })}>{w.ai_enabled ? 'On' : 'Off'}</button> : (w.ai_enabled ? 'On' : 'Off')}</td></tr>
  );
}

/** AI answers that people in workspaces reported (wrong facts, unsafe, misleading). Review, then mark reviewed or dismissed. */
function FlagsQueue({ canEdit }) {
  const toast = useToast();
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [all, setAll] = useState(false);
  const load = useCallback(() => api.get(`${A}/ai/flags${all ? '' : '?status=open'}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message)), [all]);
  useEffect(() => { load(); }, [load]);
  const act = async (id, status) => {
    const resolution = status === 'open' ? '' : window.prompt(status === 'reviewed' ? 'What was done? (optional)' : 'Why is this dismissed? (optional)', '');
    if (resolution === null) return;
    try { await api.put(`${A}/ai/flags/${id}`, { status, resolution }); toast('Saved'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  if (err) return <ErrorBox error={err} />;
  if (!d) return null;
  return (
    <Card title="Flagged AI answers" actions={<span className={`pill ${d.open ? 'amber' : 'green'}`}>{d.open} open</span>}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Answers that people in workspaces pressed Report on. Only the text they reported, their reason and their workspace are kept.</p>
      <label className="row" style={{ gap: 6, marginBottom: 8 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show reviewed and dismissed too</label>
      {!d.rows.length ? <p className="muted">{all ? 'Nothing has been reported yet.' : 'No open reports.'}</p> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Workspace</th><th>Feature</th><th>Reason</th><th>Reported text</th><th>Status</th><th /></tr></thead><tbody>
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{String(r.created_at).slice(0, 16)}</td>
              <td>{r.workspace || '—'} <span className="muted">{r.slug}</span></td>
              <td>{r.feature_label}</td>
              <td>{r.reason_label}{r.note && <div className="cell-sub">{r.note}</div>}</td>
              <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.output.length > 400 ? `${r.output.slice(0, 400)}…` : r.output}</td>
              <td><span className={`pill ${r.status === 'open' ? 'amber' : r.status === 'reviewed' ? 'green' : 'grey'}`}>{r.status}</span>{r.resolution && <div className="cell-sub">{r.resolution}</div>}</td>
              <td className="right nowrap">{canEdit && (r.status === 'open'
                ? <><button className="btn sm" onClick={() => act(r.id, 'reviewed')}>Reviewed</button> <button className="btn sm" onClick={() => act(r.id, 'dismissed')}>Dismiss</button></>
                : <button className="btn sm" onClick={() => act(r.id, 'open')}>Reopen</button>)}</td>
            </tr>))}
        </tbody></table></div>)}
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
      <WorkspaceControls canEdit={can('integrations.manage')} />
      <FlagsQueue canEdit={can('integrations.manage')} />
      {can('integrations.manage') ? <Settings s={s} reload={load} /> : <Card title="AI settings"><p className="muted" style={{ margin: 0 }}>Your role cannot change the AI connection or budget.</p></Card>}
    </>
  );
}
