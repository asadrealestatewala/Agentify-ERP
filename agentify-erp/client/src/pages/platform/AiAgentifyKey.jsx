// The part of the AI page about calls made with Agentify's OWN keys (Gemini, Azure): cost per feature and workspace in dollars
// and rupees, the price list, limits and credits, the dollar rate, and the provider connections. Keys are written here and never shown again.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, StatusBadge, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, useCan } from './AdminShell.jsx';
import AiVoiceLab, { FfmpegStatus } from './AiVoiceLab.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const usd = (v) => (v == null ? '—' : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);
const rs = (v, cur) => (v == null ? '—' : `${cur} ${Math.round(v).toLocaleString()}`);
const SRC = { default: 'estimate', average: '3-month average', override: 'set by you' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, alignItems: 'start' };

function Rate({ o, can, reload }) {
  const toast = useToast();
  const [manual, setManual] = useState(o.rate.source === 'manual' ? o.rate.rate : '');
  const put = async (body, msg) => { try { await api.put(`${A}/ai/fx`, body); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const refresh = async () => { try { await api.post(`${A}/ai/fx/refresh`, {}); toast('Live rate refreshed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title={`Dollar rate (USD to ${o.display_currency})`}>
      <p className="muted" style={{ marginTop: 0 }}>1 USD = <b>{o.rate.rate}</b> {o.display_currency} · {o.rate.source === 'live' ? 'live rate' : o.rate.source === 'manual' ? 'set by you' : 'built-in estimate (no live rate yet)'}{o.rate.updated_at ? ` · updated ${new Date(o.rate.updated_at).toLocaleString()}` : ''}. Google and Azure bill in US dollars; the rupee figure is only for your reading.</p>
      {can && <div style={grid}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={o.rate.live_enabled} onChange={(e) => put({ live: e.target.checked }, e.target.checked ? 'Live rate on' : 'Live rate off')} /> Use the live rate</label>
        <Field label="Manual rate" hint="Used when the live rate is off or unavailable. Empty clears it."><input className="input" type="number" min={0} step="any" value={manual} onChange={(e) => setManual(e.target.value)} /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={() => put({ manual_rate: manual }, 'Manual rate saved')}>Save rate</button><button className="btn" onClick={refresh}>Refresh live rate</button></div>
      </div>}
    </Card>
  );
}

function Limits({ o, can, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ budget_usd_month: o.month.budget_usd ?? '', video_budget_usd_month: o.month.video_budget_usd ?? '', platform_daily_limit: o.limits.platform_daily_limit ?? '', default_monthly_credits: o.limits.default_monthly_credits ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { await api.put(`${A}/ai/controls`, f); toast('Limits saved'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const pct = o.month.budget_usd ? Math.min(100, Math.round((o.month.spent_usd / o.month.budget_usd) * 100)) : null;
  return (
    <Card title="Budget and limits (Agentify's own key)">
      <p className="muted" style={{ marginTop: 0 }}>{o.month.budget_usd == null ? <b>No monthly budget is set, so nothing stops spending yet. Enter one below.</b> : <>This month: {usd(o.month.spent_usd)} of {usd(o.month.budget_usd)} ({pct}% used). When it is reached, AI stops for everyone until the 1st; the rest of the app keeps working.</>} The master switch and feature switches are in the card further down.</p>
      {can ? (
        <div style={grid}>
          <Field label="Monthly AI budget (USD)" hint="The safety brake. Google's own alerts do not stop spending; this does."><input className="input" type="number" min={0} step="any" value={f.budget_usd_month} onChange={set('budget_usd_month')} /></Field>
          <Field label="Monthly video budget (USD)" hint="Video is the costly part. Empty means no separate video cap."><input className="input" type="number" min={0} step="any" value={f.video_budget_usd_month} onChange={set('video_budget_usd_month')} /></Field>
          <Field label="Daily uses per workspace" hint={`Empty uses the default (${o.limits.platform_daily_limit_effective}). One use = one AI call.`}><input className="input" type="number" min={0} value={f.platform_daily_limit} onChange={set('platform_daily_limit')} /></Field>
          <Field label="Default monthly credits per workspace" hint="Creative Studio credits. Empty means no limit yet."><input className="input" type="number" min={0} value={f.default_monthly_credits} onChange={set('default_monthly_credits')} /></Field>
          <div><button className="btn primary" onClick={save}>Save limits</button></div>
        </div>) : <p className="muted">Your role cannot change these.</p>}
    </Card>
  );
}

function Prices({ o, can, reload }) {
  const toast = useToast();
  const pin = async (p) => {
    const v = window.prompt(`Price in US dollars for ${p.per}. Leave empty to go back to the automatic price.`, p.source === 'override' ? p.usd : '');
    if (v === null) return;
    try { await api.put(`${A}/ai/prices/${p.key}`, { usd: v }); toast('Price saved'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Price list" flush>
      <div className="table-wrap"><table className="t"><thead><tr><th>Feature</th><th>One use</th><th className="num">USD</th><th className="num">{o.display_currency}</th><th>Based on</th>{can && <th />}</tr></thead>
        <tbody>{o.prices.map((p) => <tr key={p.key}><td>{p.label}</td><td>{p.per}</td><td className="num">{usd(p.usd)}</td><td className="num">{(p.usd * o.rate.rate).toFixed(2)}</td><td>{SRC[p.source]}{p.source === 'average' ? ` (${p.sample} uses)` : ''}</td>{can && <td><button className="btn sm" onClick={() => pin(p)}>Set price</button></td>}</tr>)}</tbody></table></div>
      <p className="muted" style={{ fontSize: 13, margin: 12 }}>Prices start as estimates and switch to the average of the last 3 months once a feature has 10 real uses. Check them against Google's and Azure's current pricing.</p>
    </Card>
  );
}

function Workspaces({ o, can, reload }) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const hidden = o.workspaces.filter((w) => w.status && w.status !== 'active').length;
  const rows = showAll ? o.workspaces : o.workspaces.filter((w) => !w.status || w.status === 'active');
  const act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const topup = (w) => { const v = window.prompt(`Add credits to ${w.name} for this month:`, '100'); if (v) act(() => api.put(`${A}/ai/workspaces/${w.id}/credits`, { add_topup: v }), 'Credits added'); };
  const allowance = (w) => { const v = window.prompt(`Monthly credits for ${w.name}. Leave empty to use the default.`, w.credits.allowance ?? ''); if (v !== null) act(() => api.put(`${A}/ai/workspaces/${w.id}/credits`, { monthly_credits: v }), 'Credits saved'); };
  const limit = (w) => { const v = window.prompt(`Daily uses for ${w.name}. Leave empty to use the default.`, w.own_daily_limit ?? ''); if (v !== null) act(() => api.put(`${A}/ai/workspaces/${w.id}`, { platform_daily_limit: v }), 'Limit saved'); };
  return (
    <Card title="Workspaces (Agentify's own key)" flush actions={hidden > 0 && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show cancelled and suspended ({hidden})</label>}>
      <div className="table-wrap"><table className="t"><thead><tr><th>Workspace</th><th className="num">Cost this month</th><th className="num">Uses today</th><th className="num">Credits left</th><th>AI</th></tr></thead>
        <tbody>{rows.map((w) => (
          <tr key={w.id}><td>{w.name} <span className="muted">{w.slug}</span>{w.status && w.status !== 'active' && <> <StatusBadge status={w.status} /></>}</td><td className="num">{usd(w.usd)} <span className="muted">· {rs(w.pkr, o.display_currency)}</span></td>
            <td className="num"><span className="cell-act">{n0(w.uses_today)} / {n0(w.daily_limit)} {can && <button className="btn sm" onClick={() => limit(w)}>Change</button>}</span></td>
            <td className="num"><span className="cell-act">{w.credits.left == null ? 'No limit' : `${n0(w.credits.left)} of ${n0(w.credits.allowance)}`} {can && <><button className="btn sm" onClick={() => allowance(w)}>Set</button><button className="btn sm" onClick={() => topup(w)}>Top up</button></>}</span></td>
            <td>{can ? <button className={`btn sm ${w.ai_enabled ? '' : 'danger'}`} onClick={() => act(() => api.put(`${A}/ai/workspaces/${w.id}`, { ai_enabled: !w.ai_enabled }), `${w.name}: saved`)}>{w.ai_enabled ? 'On' : 'Off'}</button> : (w.ai_enabled ? 'On' : 'Off')}</td></tr>))}</tbody></table></div>
    </Card>
  );
}

function Reports({ can }) {
  const toast = useToast();
  const [all, setAll] = useState(false); const [rows, setRows] = useState(null);
  const load = useCallback(() => api.get(`${A}/ai/reports${all ? '?handled=1' : ''}`).then(setRows).catch(() => setRows([])), [all]);
  useEffect(() => { load(); }, [load]);
  const mark = async (r, handled) => { try { await api.put(`${A}/ai/reports/${r.id}`, { handled }); toast(handled ? 'Marked as handled' : 'Reopened'); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Reported AI answers" actions={<label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show handled too</label>}>
      {!rows ? <Loading rows={1} /> : !rows.length ? <p className="muted" style={{ margin: 0 }}>Nothing reported. Results that people flag with the Report button appear here.</p> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Workspace</th><th>Feature</th><th>What was asked</th><th>Result</th><th>Note</th>{can && <th />}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{new Date(r.created_at.replace(' ', 'T') + (r.created_at.includes('Z') ? '' : 'Z')).toLocaleString()}</td><td>{r.tenant_name || '—'}<div className="muted" style={{ fontSize: 12 }}>{r.user_name}</div></td><td>{r.feature}</td><td style={{ maxWidth: 220 }}>{r.prompt || '—'}</td><td style={{ maxWidth: 260 }}>{(r.output || '—').slice(0, 220)}</td><td>{r.note || '—'}</td>
            {can && <td>{r.status === 'open' ? <button className="btn sm" onClick={() => mark(r, true)}>Mark handled</button> : <button className="btn sm" onClick={() => mark(r, false)}>Reopen</button>}</td>}</tr>)}</tbody></table></div>)}
    </Card>
  );
}

/** English and Urdu voice for video voice-overs, with a Hear it preview. The list of voices comes from Azure (Test the connection loads it). */
function Voices({ o, can, voices, selected, setSelected, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const hear = async (lang) => {
    setBusy(lang);
    try {
      const r = await api.post(`${A}/ai/voices/preview`, { lang, voice: selected[lang] });
      if (!r?.audio) throw new Error('The server did not send any audio. Check the Azure key and region, then try again.');
      const audio = new Audio(`data:${r.mime || 'audio/mpeg'};base64,${r.audio}`);
      await new Promise((resolve, reject) => { audio.onerror = () => reject(new Error('The sample could not be played in this browser.')); audio.play().then(resolve, reject); });
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const save = async () => { try { await api.put(`${A}/ai/voices`, selected); toast('Voices saved'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const ready = o.technical.azure.key_added && o.technical.azure.region;
  return (
    <Card title="Video voices">
      <p className="muted" style={{ marginTop: 0 }}>{ready ? 'The voice used for video voice-overs. Press Hear it to listen before saving.' : 'Add the Azure key and region in Technical details below first.'}</p>
      <div style={grid}>
        {['English', 'Urdu'].map((lang) => {
          const list = voices?.[lang]?.length ? voices[lang] : [{ name: selected[lang], label: selected[lang] }];
          return (
            <Field key={lang} label={`${lang} voice`}>
              <span className="row" style={{ gap: 8 }}>
                <select className="input" value={selected[lang]} disabled={!can || !ready} onChange={(e) => setSelected({ ...selected, [lang]: e.target.value })}>{list.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}</select>
                <button className="btn sm" disabled={!ready || busy === lang} onClick={() => hear(lang)}>{busy === lang ? 'Playing…' : 'Hear it'}</button>
              </span>
            </Field>);
        })}
      </div>
      {can && <div style={{ marginTop: 12 }}><button className="btn primary" disabled={!ready} onClick={save}>Save voices</button></div>}
    </Card>
  );
}

const ENGINE_LABEL = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini' };
/** Groq: fast chat, picture understanding and speech-to-text for Ask; plus the order Ask tries its engines in. */
function Groq({ t, can, reload }) {
  const toast = useToast();
  const g = t.groq;
  const [f, setF] = useState({ key: '', enabled: g.enabled, chat_model: g.chat_model === g.defaults.chat ? '' : g.chat_model, vision_model: g.vision_model === g.defaults.vision ? '' : g.vision_model, stt_model: g.stt_model === g.defaults.stt ? '' : g.stt_model });
  const [order, setOrder] = useState(t.ask_order);
  const [busy, setBusy] = useState(false);
  const save = async () => { try { await api.put(`${A}/ai/groq`, { enabled: f.enabled, chat_model: f.chat_model, vision_model: f.vision_model, stt_model: f.stt_model, provider_order: order, ...(f.key ? { key: f.key } : {}) }); toast('Groq settings saved'); setF({ ...f, key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const test = async () => { setBusy(true); try { const r = await api.post(`${A}/ai/groq/test`, {}); toast(`Groq connected (${r.models} models available)`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the Groq key? Ask voice and picture questions stop until a key is added again.')) return; try { await api.del(`${A}/ai/groq/key`); toast('Groq key removed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const move = (i, d) => { const o = [...order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  const on = { groq: g.key_added && g.enabled, horde: t.stablehorde.key_added, gemini: t.stablehorde.gemini_enabled && t.gemini.added };
  return (
    <Card title="Groq and Ask engines">
      <p className="muted" style={{ marginTop: 0 }}>Groq key: {g.key_added ? <span className="pill green">Added {g.key_hint}</span> : <span className="pill grey">Not added</span>}. Groq runs Ask chat answers, questions about a picture people attach, and speech-to-text for the microphone (so voice works in the Android app too). Free Groq accounts have rate limits: when Groq says it is busy, Ask moves to the next engine. Questions are scrubbed of emails, numbers, keys and names before they are sent; a picture cannot be scrubbed, so tell people not to attach client data.</p>
      {can && <div style={grid}>
        <Field label={g.key_added ? 'Replace Groq key (optional)' : 'Groq API key'} hint="Starts with gsk_ . Stored encrypted."><TextInput type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} autoComplete="off" /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Use Groq in Ask (chat, pictures, voice)</label>
        <Field label="Chat model (optional)" hint={`Default ${g.defaults.chat}`}><TextInput value={f.chat_model} onChange={(v) => setF({ ...f, chat_model: v })} /></Field>
        <Field label="Picture model (optional)" hint={`Default ${g.defaults.vision}`}><TextInput value={f.vision_model} onChange={(v) => setF({ ...f, vision_model: v })} /></Field>
        <Field label="Speech model (optional)" hint={`Default ${g.defaults.stt}`}><TextInput value={f.stt_model} onChange={(v) => setF({ ...f, stt_model: v })} /></Field>
      </div>}
      <div style={{ marginTop: 12 }}>
        <b>Ask engine order</b>
        <p className="muted" style={{ margin: '2px 0 8px' }}>Ask tries the top engine first and moves down when one is off, has no key or fails.</p>
        {order.map((e, i) => <div key={e} className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span style={{ width: 20 }}>{i + 1}.</span><span style={{ minWidth: 110 }}>{ENGINE_LABEL[e]}</span>{on[e] ? <span className="pill green">on</span> : <span className="pill grey">off</span>}
          {can && <><button className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${ENGINE_LABEL[e]} up`}>Up</button><button className="btn sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${ENGINE_LABEL[e]} down`}>Down</button></>}
        </div>)}
      </div>
      {can && <div className="row" style={{ gap: 8, marginTop: 12 }}><button className="btn primary" onClick={save}>Save Groq and order</button>{g.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn" disabled={!g.key_added || busy} onClick={test}>{busy ? 'Testing…' : 'Test the connection'}</button></div>}
    </Card>
  );
}

/** Stable Horde: community AI that Ask can use first or as a backup. Key stored encrypted, never shown again. */
function Horde({ t, can, reload }) {
  const toast = useToast();
  const h = t.stablehorde;
  const [f, setF] = useState({ key: '', models: h.models.join(', '), trusted_only: h.trusted_only, gemini_enabled: h.gemini_enabled });
  const [busy, setBusy] = useState(false);
  const save = async () => { try { await api.put(`${A}/ai/horde`, { models: f.models, trusted_only: f.trusted_only, gemini_enabled: f.gemini_enabled, ...(f.key ? { key: f.key } : {}) }); toast('Stable Horde settings saved'); setF({ ...f, key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const test = async () => { setBusy(true); try { const r = await api.post(`${A}/ai/horde/test`, {}); toast(`Stable Horde connected${r.username ? ` as ${r.username}` : ''}${r.kudos != null ? ` · ${Math.round(r.kudos)} kudos` : ''}`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the Stable Horde key? Ask falls back to Gemini only.')) return; try { await api.del(`${A}/ai/horde/key`); toast('Stable Horde key removed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Stable Horde (community AI for Ask)">
      <p className="muted" style={{ marginTop: 0 }}>Key: {h.key_added ? <span className="pill green">Added {h.key_hint}</span> : <span className="pill grey">Not added</span>}. Stable Horde is one of Ask's engines (see Ask engines above for the order). Gemini is used only if you tick "Allow Gemini for Ask" below. If Horde fails and Gemini is off, people see a short busy message. Ask answers from the Agentify guides in the language the person writes in. Stable Horde is run by volunteers: answers can be slow and uneven, and prompts may be seen by workers. Only guide text and the question are sent, with emails, phone numbers, long numbers, keys and the asker's name removed first. Never put client data in Ask.</p>
      {can && <div style={grid}>
        <Field label={h.key_added ? 'Replace Stable Horde key (optional)' : 'Stable Horde API key'} hint="From aihorde.net. Stored encrypted."><TextInput type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} autoComplete="off" /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.gemini_enabled} onChange={(e) => setF({ ...f, gemini_enabled: e.target.checked })} /> Allow Gemini for Ask (off by default; while off, Gemini is never used by Ask)</label>
        <Field label="Models (optional)" hint="Up to 5, comma separated. Empty lets the Horde choose."><TextInput value={f.models} onChange={(v) => setF({ ...f, models: v })} /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.trusted_only} onChange={(e) => setF({ ...f, trusted_only: e.target.checked })} /> Use trusted workers only (recommended)</label>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={save}>Save Stable Horde</button>{h.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn" disabled={!h.key_added || busy} onClick={test}>{busy ? 'Testing…' : 'Test the connection'}</button></div>
      </div>}
    </Card>
  );
}

function Technical({ o, can, reload, voices, onTested }) {
  const toast = useToast();
  const t = o.technical;
  const [az, setAz] = useState({ key: '', region: t.azure.region || '' });
  const save = async () => { try { await api.put(`${A}/ai/azure`, { region: az.region, ...(az.key ? { key: az.key } : {}) }); toast('Azure details saved'); setAz({ ...az, key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const [testing, setTesting] = useState(false);
  const testAzure = async () => { setTesting(true); try { const r = await api.post(`${A}/ai/azure/test`, {}); onTested(r.voices); toast(`Azure connected: ${r.voices.English.length} English and ${r.voices.Urdu.length} Urdu voices found`); } catch (e) { toast(e.message, 'err'); } finally { setTesting(false); } };
  const remove = async () => { if (!window.confirm('Remove the Azure key? Video voices stop until a key is added again.')) return; try { await api.del(`${A}/ai/azure/key`); toast('Azure key removed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
    <Card title="Technical details">
      <p className="muted" style={{ marginTop: 0 }}>Gemini key: {t.gemini.added ? <span className="pill green">Added {t.gemini.key_hint}</span> : <span className="pill grey">Not added</span>} (add or test it in AI settings below) · Azure Speech key: {t.azure.key_added ? <span className="pill green">Added {t.azure.key_hint}</span> : <span className="pill grey">Not added</span>}{t.azure.region ? ` · region ${t.azure.region}` : ''}. Keys are stored encrypted and are never shown again.</p>
      {can && <div style={grid}>
        <Field label={t.azure.key_added ? 'Replace Azure Speech key (optional)' : 'Azure Speech key'}><TextInput type="password" value={az.key} onChange={(v) => setAz({ ...az, key: v })} autoComplete="off" /></Field>
        <Field label="Azure region" hint="For example uaenorth or eastus"><TextInput value={az.region} onChange={(v) => setAz({ ...az, region: v })} /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={save}>Save Azure details</button>{t.azure.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn" disabled={!t.azure.key_added || !t.azure.region || testing} onClick={testAzure}>{testing ? 'Testing…' : 'Test the connection'}</button></div>
      </div>}
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="t"><thead><tr><th>Feature</th><th>Model or service</th></tr></thead><tbody>{t.models.map((m) => <tr key={m.key}><td>{m.label}</td><td>{m.model}</td></tr>)}</tbody></table></div>
    </Card>
    <Groq t={t} can={can} reload={reload} />
    <Horde t={t} can={can} reload={reload} />
    </>
  );
}

export default function AiAgentifyKey({ tab = 'overview' }) {
  const can = useCan()('integrations.manage');
  const [o, setO] = useState(null); const [err, setErr] = useState('');
  const [voices, setVoices] = useState(null); const [selected, setSelected] = useState({ English: '', Urdu: '' });
  useEffect(() => { api.get(`${A}/ai/voices`).then((v) => setSelected(v.selected)).catch(() => {}); }, []);
  useEffect(() => { if (o?.technical.azure.key_added && o.technical.azure.region && !voices) api.post(`${A}/ai/azure/test`, {}).then((r) => setVoices(r.voices)).catch(() => {}); }, [o, voices]);
  const load = useCallback(() => api.get(`${A}/ai/overview`).then((x) => { setO(x); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !o) return <ErrorBox error={err} />;
  if (!o) return <Loading rows={3} />;
  const cur = o.display_currency;
  return (
    <>
      {tab === 'overview' && <>
      <div className="cc-stats">
        <Card><div className="cc-k">Agentify-key AI cost this month</div><div className="cc-v">{usd(o.month.spent_usd)}</div><div className="cell-sub">{rs(o.month.spent_pkr, cur)} at {o.rate.rate} {cur} per USD</div></Card>
        <Card><div className="cc-k">Video cost this month</div><div className="cc-v">{usd(o.month.video_spent_usd)}</div><div className="cell-sub">{o.month.video_budget_usd != null ? `of ${usd(o.month.video_budget_usd)} video budget` : 'No video budget set'}</div></Card>
      </div>
      <Card title="Cost this month by feature" flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>Feature</th><th className="num">Uses</th><th className="num">USD</th><th className="num">{cur}</th><th>Switch</th></tr></thead>
          <tbody>{o.features.map((f) => <tr key={f.key}><td>{f.label}</td><td className="num">{n0(f.uses)}</td><td className="num">{usd(f.usd)}</td><td className="num">{rs(f.pkr, cur).replace(`${cur} `, '')}</td><td>{f.enabled ? 'On' : <span className="pill red">Off</span>}</td></tr>)}</tbody></table></div>
      </Card>
      </>}
      {tab === 'prices' && <>
        <Prices o={o} can={can} reload={load} />
        <Rate o={o} can={can} reload={load} />
      </>}
      {tab === 'workspaces' && <Workspaces o={o} can={can} reload={load} />}
      {tab === 'limits' && <Limits o={o} can={can} reload={load} />}
      {tab === 'usage' && <Reports can={can} />}
      {tab === 'keys' && <>
        <Voices o={o} can={can} voices={voices} selected={selected} setSelected={setSelected} reload={load} />
        <FfmpegStatus ffmpeg={o.ffmpeg} />
        <AiVoiceLab can={can} />
        <Technical o={o} can={can} reload={load} voices={voices} onTested={setVoices} />
      </>}
    </>
  );
}
