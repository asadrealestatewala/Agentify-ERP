// The part of the AI page about calls made with Agentify's OWN keys (Gemini, Azure): cost per feature and workspace in dollars
// and rupees, the price list, limits and credits, the dollar rate, and the provider connections. Keys are written here and never shown again.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, StatusBadge, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, useCan } from './AdminShell.jsx';
import { IconMessageCircle, IconPhoto, IconMovie, IconMicrophone, IconBook2, IconWorldSearch, IconLanguage, IconPencil, IconChevronDown, IconSparkles, IconBuildingCommunity } from '@tabler/icons-react';
import { FoldCard, Dot } from './Fold.jsx';
import AiVoiceLab, { FfmpegStatus } from './AiVoiceLab.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const usd = (v) => (v == null ? '—' : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);
const rs = (v, cur) => (v == null ? '—' : `${cur} ${Math.round(v).toLocaleString()}`);
const ago = (iso) => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`; };
const SRC = { default: 'estimate', average: '3-month average', override: 'set by you' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, alignItems: 'start' };

const FEATURE_LOOK = {
  ask_assistant: { Icon: IconMessageCircle, bg: '#0e7c6b', one: 'question answered', many: 'questions answered' },
  creative_post: { Icon: IconPhoto, bg: '#2f7fd1', one: 'post image made', many: 'post images made' },
  creative_video: { Icon: IconMovie, bg: '#d9622b', one: 'video made', many: 'videos made' },
  video_voice_en: { Icon: IconMicrophone, bg: '#12906f', one: 'English voice-over made', many: 'English voice-overs made' },
  video_voice_ur: { Icon: IconMicrophone, bg: '#0b6b5c', one: 'Urdu voice-over made', many: 'Urdu voice-overs made' },
  brand_story: { Icon: IconBook2, bg: '#6a5acd', one: 'brand story written', many: 'brand stories written' },
  website_analysis: { Icon: IconWorldSearch, bg: '#3b8ea5', one: 'website checked', many: 'websites checked' },
  translation: { Icon: IconLanguage, bg: '#8a5fc4', one: 'translation done', many: 'translations done' },
  content_draft: { Icon: IconPencil, bg: '#c9822b', one: 'post draft written', many: 'post drafts written' },
};

function CostSummary({ o, cur }) {
  const [open, setOpen] = useState(null);
  const month = new Date().toLocaleString('en', { month: 'long' });
  return (
    <Card>
      <div style={{ fontWeight: 600 }}>AI cost in {month}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: '#0e7c6b', lineHeight: 1.2 }}>{rs(o.month.spent_pkr, cur)}</div>
      <div className="muted" style={{ marginBottom: 12 }}>All workspaces together on Agentify's own keys, so far this month. Tap a row for details.</div>
      <div style={{ border: '1px solid var(--line, #e3e7e5)', borderRadius: 12, overflow: 'hidden' }}>
        {o.features.map((f, i) => {
          const L = FEATURE_LOOK[f.key] || { Icon: IconMessageCircle, bg: '#0e7c6b', one: 'use', many: 'uses' };
          const isOpen = open === f.key;
          return (
            <div key={f.key} style={{ borderTop: i ? '1px solid var(--line, #e3e7e5)' : 'none' }}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.key)} style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', cursor: 'pointer' }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: L.bg, color: '#fff', display: 'grid', placeItems: 'center', flex: 'none', opacity: f.enabled ? 1 : 0.5 }}><L.Icon size={22} stroke={1.75} aria-hidden="true" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{f.label}{!f.enabled && <span className="pill red" style={{ marginLeft: 8 }}>Off</span>}</div>
                  <div className="muted">{f.uses ? `${n0(f.uses)} ${f.uses === 1 ? L.one : L.many}` : 'Not used yet'}</div>
                </span>
                <IconChevronDown size={18} aria-hidden="true" style={{ transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && <div className="muted" style={{ padding: '0 14px 14px 72px', fontSize: 13, lineHeight: 1.6 }}>
                Cost: <b>{rs(f.pkr, cur)}</b> ({usd(f.usd)}) · {f.uses ? `about ${rs(f.pkr / f.uses, cur)} per use` : 'no cost yet'}<br />
                {f.characters ? `${n0(f.characters)} letters spoken` : f.tokens_in || f.tokens_out ? `${n0(f.tokens_in)} read / ${n0(f.tokens_out)} written (tokens)` : 'Charged per use, not by text size'}
              </div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Rate({ o, can, reload }) {
  const toast = useToast();
  const [manual, setManual] = useState(o.rate.source === 'manual' ? o.rate.rate : '');
  const put = async (body, msg) => { try { await api.put(`${A}/ai/fx`, body); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const refresh = async () => { try { await api.post(`${A}/ai/fx/refresh`, {}); toast('Live rate refreshed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <FoldCard title={`Dollar rate (USD to ${o.display_currency})`} summary={`1 USD = ${o.rate.rate} ${o.display_currency} (${o.rate.source === 'manual' ? 'set by you' : 'live rate'})`} tone="info">
      <p className="muted" style={{ marginTop: 0 }}>1 USD = <b>{o.rate.rate}</b> {o.display_currency} · {o.rate.source === 'live' ? 'live rate' : o.rate.source === 'manual' ? 'set by you' : 'built-in estimate (no live rate yet)'}{o.rate.updated_at ? ` · updated ${new Date(o.rate.updated_at).toLocaleString()}` : ''}. Google and Azure bill in US dollars; the rupee figure is only for your reading.</p>
      {can && <div style={grid}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={o.rate.live_enabled} onChange={(e) => put({ live: e.target.checked }, e.target.checked ? 'Live rate on' : 'Live rate off')} /> Use the live rate</label>
        <Field label="Manual rate" hint="Used when the live rate is off or unavailable. Empty clears it."><input className="input" type="number" min={0} step="any" value={manual} onChange={(e) => setManual(e.target.value)} /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={() => put({ manual_rate: manual }, 'Manual rate saved')}>Save rate</button><button className="btn info" onClick={refresh}>Refresh live rate</button></div>
      </div>}
    </FoldCard>
  );
}

function Limits({ o, can, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ budget_usd_month: o.month.budget_usd ?? '', video_budget_usd_month: o.month.video_budget_usd ?? '', platform_daily_limit: o.limits.platform_daily_limit ?? '', default_monthly_credits: o.limits.default_monthly_credits ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { await api.put(`${A}/ai/controls`, f); toast('Limits saved'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const pct = o.month.budget_usd ? Math.min(100, Math.round((o.month.spent_usd / o.month.budget_usd) * 100)) : null;
  return (
    <FoldCard title="Budget and limits (Agentify's own key)" summary={o.month.budget_usd == null ? <Dot tone="warn">No monthly budget set</Dot> : `Budget ${usd(o.month.budget_usd)} a month, ${usd(o.month.spent_usd)} used`} tone={o.month.budget_usd == null ? 'warn' : 'ok'} defaultOpen={o.month.budget_usd == null}>
      <p className="muted" style={{ marginTop: 0 }}>{o.month.budget_usd == null ? <b>No monthly budget is set, so nothing stops spending yet. Enter one below.</b> : <>This month: {rs(o.month.spent_pkr, o.display_currency)} of {rs(o.month.budget_usd * o.rate.rate, o.display_currency)} ({usd(o.month.spent_usd)} of {usd(o.month.budget_usd)}, {pct}% used). When it is reached, AI stops for everyone until the 1st; the rest of the app keeps working.</>} The master switch and feature switches are in the card further down.</p>
      {can ? (
        <div style={grid}>
          <Field label="Monthly AI budget (USD)" hint={`${f.budget_usd_month !== '' && Number(f.budget_usd_month) >= 0 ? `About ${rs(Number(f.budget_usd_month) * o.rate.rate, o.display_currency)} at today's rate. ` : ''}The safety brake. Google's own alerts do not stop spending; this does.`}><input className="input" type="number" min={0} step="any" value={f.budget_usd_month} onChange={set('budget_usd_month')} /></Field>
          <Field label="Monthly video budget (USD)" hint={`${f.video_budget_usd_month !== '' && Number(f.video_budget_usd_month) >= 0 ? `About ${rs(Number(f.video_budget_usd_month) * o.rate.rate, o.display_currency)}. ` : ''}Video is the costly part. Empty means no separate video cap.`}><input className="input" type="number" min={0} step="any" value={f.video_budget_usd_month} onChange={set('video_budget_usd_month')} /></Field>
          <Field label="Daily uses per workspace" hint={`Empty uses the default (${o.limits.platform_daily_limit_effective}). One use = one AI call.`}><input className="input" type="number" min={0} value={f.platform_daily_limit} onChange={set('platform_daily_limit')} /></Field>
          <Field label="Default monthly credits per workspace" hint="Creative Studio credits. Empty means no limit yet."><input className="input" type="number" min={0} value={f.default_monthly_credits} onChange={set('default_monthly_credits')} /></Field>
          <div><button className="btn primary" onClick={save}>Save limits</button></div>
        </div>) : <p className="muted">Your role cannot change these.</p>}
    </FoldCard>
  );
}

function MasterSwitch({ o, can, reload }) {
  const toast = useToast();
  const on = o.master.on, last = o.master.last_change;
  const flip = async () => {
    if (on && !window.confirm('Switch AI off for every workspace now? Features that use AI stop until you switch it back on. The rest of the app keeps working.')) return;
    try { await api.put(`${A}/ai/controls`, { kill_switch: on }); toast(on ? 'AI is switched off for every workspace' : 'AI is on again'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card>
      <div className="row" style={{ gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: '#0e7c6b', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none', opacity: on ? 1 : 0.5 }}><IconSparkles size={22} stroke={1.75} aria-hidden="true" /></span>
          <div>
            <div style={{ fontWeight: 600 }}>All AI, for every workspace <span className={`pill ${on ? 'green' : 'red'}`} style={{ marginLeft: 6 }}>{on ? 'On' : 'Off'}</span></div>
            <div className="muted" style={{ fontSize: 13 }}>Turn off to stop every AI feature at every workspace at once. Everything else in the app keeps working.</div>
            <div className="muted" style={{ fontSize: 12 }}>{last ? `Last change: ${ago(last.at)}${last.by ? ` by ${last.by}` : ''}${last.state ? ` (switched ${last.state})` : ''}` : 'No change recorded yet.'}</div>
          </div>
        </div>
        {can && <label className="row" style={{ gap: 8, flex: 'none' }}><input type="checkbox" role="switch" checked={on} onChange={flip} aria-label="All AI on or off" /> {on ? 'On' : 'Off'}</label>}
      </div>
    </Card>
  );
}

const money = (v) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString());
function PlainPrices({ o }) {
  const rate = o.rate.rate, cur = o.display_currency;
  const P = Object.fromEntries(o.prices.map((p) => [p.key, p.usd]));
  const REEL_S = 8, REEL_CHARS = 600;
  const reel = P.creative_video * REEL_S, voice = (P.video_voice_en / 1000) * REEL_CHARS;
  const rows = [
    ['One question to Ask', P.ask_assistant],
    ['One brand story or post draft', P.brand_story],
    ['One post image', P.creative_post],
    [`One ${REEL_S}-second reel (video only; 16 and 24 seconds cost 2 and 3 times this)`, reel],
    ['The voice-over for one reel, in one language', voice],
    ['One website check', P.website_analysis],
    ['One translation', P.translation],
  ].filter((r) => r[1] != null);
  const when = o.rate.updated_at ? new Date(o.rate.updated_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const src = o.rate.source === 'live' ? `live rate${when ? ` of ${when}` : ''}` : o.rate.source === 'manual' ? `rate set by you${when ? ` on ${when}` : ''}` : 'built-in estimate, not a live rate';
  return (
    <Card>
      <div style={{ fontWeight: 600, fontSize: 16 }}>Price list</div>
      <div className="muted" style={{ marginBottom: 12 }}>What one use of each AI feature costs, on average.</div>
      <div style={{ border: '1px solid var(--line, #e3e7e5)', borderRadius: 12, overflow: 'hidden' }}>
        {rows.map(([label, v], i) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 14px', borderTop: i ? '1px solid var(--line, #e3e7e5)' : 'none' }}><span>{label}</span><b style={{ whiteSpace: 'nowrap' }}>about {cur} {money(v * rate)}</b></div>)}
      </div>
      <div style={{ background: 'rgba(14,124,107,.08)', borderRadius: 10, padding: '10px 14px', margin: '12px 0' }}><b>Example:</b> one {REEL_S}-second reel with its English voice-over costs about <b>{cur} {money((reel + voice) * rate)}</b>.</div>
      <p className="muted" style={{ margin: '0 0 8px' }}><b>Everything else is free:</b> scheduling, editing, downloading and sharing posts, and the rest of the app. Workspaces using their own AI key pay their provider directly.</p>
      <div className="muted" style={{ fontSize: 12 }}>1 US dollar = {cur} {Number(rate).toFixed(2)} ({src}). Prices are averages of the last 3 months once a feature has {10} real uses, otherwise estimates.</div>
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
    <FoldCard title="Price list" summary={`${o.prices.length} features priced`} flush>
      <div className="table-wrap"><table className="t"><thead><tr><th>Feature</th><th>One use</th><th className="num">USD</th><th className="num">{o.display_currency}</th><th>Based on</th>{can && <th />}</tr></thead>
        <tbody>{o.prices.map((p) => <tr key={p.key}><td>{p.label}</td><td>{p.per}</td><td className="num">{usd(p.usd)}</td><td className="num">{(p.usd * o.rate.rate).toFixed(2)}</td><td>{SRC[p.source]}{p.source === 'average' ? ` (${p.sample} uses)` : ''}</td>{can && <td><button className="btn sm" onClick={() => pin(p)}>Set price</button></td>}</tr>)}</tbody></table></div>
      <p className="muted" style={{ fontSize: 13, margin: 12 }}>Prices start as estimates and switch to the average of the last 3 months once a feature has 10 real uses. Check them against Google's and Azure's current pricing.</p>
    </FoldCard>
  );
}

function Workspaces({ o, can, reload }) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const cur = o.display_currency;
  const hidden = o.workspaces.filter((w) => w.status && w.status !== 'active').length;
  const rows = showAll ? o.workspaces : o.workspaces.filter((w) => !w.status || w.status === 'active');
  const act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const topup = (w) => { const v = window.prompt(`Add credits to ${w.name} for this month:`, '100'); if (v) act(() => api.put(`${A}/ai/workspaces/${w.id}/credits`, { add_topup: v }), 'Credits added'); };
  const allowance = (w) => { const v = window.prompt(`Monthly credits for ${w.name}. Leave empty to use the default.`, w.credits.allowance ?? ''); if (v !== null) act(() => api.put(`${A}/ai/workspaces/${w.id}/credits`, { monthly_credits: v }), 'Credits saved'); };
  const limit = (w) => { const v = window.prompt(`Daily uses for ${w.name}. Leave empty to use the default.`, w.own_daily_limit ?? ''); if (v !== null) act(() => api.put(`${A}/ai/workspaces/${w.id}`, { platform_daily_limit: v }), 'Limit saved'); };
  const toggle = (w) => act(() => api.put(`${A}/ai/workspaces/${w.id}`, { ai_enabled: !w.ai_enabled }), w.ai_enabled ? `AI is off for ${w.name}` : `AI is on for ${w.name}`);
  const line = { borderTop: '1px solid var(--line, #e3e7e5)' };
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Each workspace</div>
          <div className="muted" style={{ marginBottom: 12 }}>What each workspace's AI cost this month on Agentify's own key. Turn a workspace off to stop AI there only.</div>
        </div>
        {hidden > 0 && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show cancelled and suspended ({hidden})</label>}
      </div>
      {!rows.length ? <p className="muted" style={{ margin: 0 }}>No workspaces yet.</p> : (
        <div style={{ border: '1px solid var(--line, #e3e7e5)', borderRadius: 12, overflow: 'hidden' }}>
          {rows.map((w, i) => {
            const idle = !w.usd && !w.uses_today;
            return (
              <div key={w.id} style={{ ...(i ? line : {}), display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', opacity: w.ai_enabled ? 1 : 0.7 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: '#0e7c6b', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none', opacity: w.ai_enabled ? 1 : 0.5 }}><IconBuildingCommunity size={22} stroke={1.75} aria-hidden="true" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}{w.status && w.status !== 'active' && <> <StatusBadge status={w.status} /></>}{idle && <span className="pill grey" style={{ marginLeft: 8 }}>Inactive</span>}</div>
                  <div className="muted" style={{ fontSize: 13 }}>Used today: {n0(w.uses_today)} of {n0(w.daily_limit)}{can && <> · <button className="btn sm" onClick={() => limit(w)}>Change limit</button></>}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Credits: {w.credits.left == null ? 'no limit' : `${n0(w.credits.left)} of ${n0(w.credits.allowance)} left`}{can && <> · <button className="btn sm" onClick={() => allowance(w)}>Set</button> <button className="btn sm" onClick={() => topup(w)}>Top up</button></>}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontWeight: 600 }}>{rs(w.pkr, cur)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>this month · {usd(w.usd)}</div>
                </div>
                {can ? <label className="row" style={{ gap: 6, flex: 'none' }}><input type="checkbox" role="switch" checked={w.ai_enabled} onChange={() => toggle(w)} aria-label={`AI on or off for ${w.name}`} /></label> : <span className={`pill ${w.ai_enabled ? 'green' : 'grey'}`}>{w.ai_enabled ? 'On' : 'Off'}</span>}
              </div>
            );
          })}
        </div>
      )}
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
    <FoldCard title="Reported AI answers" summary="Answers people flagged as wrong or unsafe" actions={<label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show handled too</label>}>
      {!rows ? <Loading rows={1} /> : !rows.length ? <p className="muted" style={{ margin: 0 }}>Nothing reported. Results that people flag with the Report button appear here.</p> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Workspace</th><th>Feature</th><th>What was asked</th><th>Result</th><th>Note</th>{can && <th />}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{new Date(r.created_at.replace(' ', 'T') + (r.created_at.includes('Z') ? '' : 'Z')).toLocaleString()}</td><td>{r.tenant_name || '—'}<div className="muted" style={{ fontSize: 12 }}>{r.user_name}</div></td><td>{r.feature}</td><td style={{ maxWidth: 220 }}>{r.prompt || '—'}</td><td style={{ maxWidth: 260 }}>{(r.output || '—').slice(0, 220)}</td><td>{r.note || '—'}</td>
            {can && <td>{r.status === 'open' ? <button className="btn sm success" onClick={() => mark(r, true)}>Mark handled</button> : <button className="btn sm" onClick={() => mark(r, false)}>Reopen</button>}</td>}</tr>)}</tbody></table></div>)}
    </FoldCard>
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
      // A blob: URL, not a data: URL: the site's Content-Security-Policy allows blob: media but blocks data: media.
      const bin = atob(r.audio); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'audio/mpeg' }));
      const audio = new Audio(url);
      try {
        await new Promise((resolve, reject) => { audio.onerror = () => reject(new Error('The sample could not be played in this browser.')); audio.play().then(resolve, reject); });
      } catch (e) { URL.revokeObjectURL(url); throw e; }
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const save = async () => { try { await api.put(`${A}/ai/voices`, selected); toast('Voices saved'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const ready = o.technical.azure.key_added && o.technical.azure.region;
  return (
    <FoldCard title="Video voices" summary="Pick the English and Urdu voices used in promo videos">
      <p className="muted" style={{ marginTop: 0 }}>{ready ? 'The voice used for video voice-overs. Press Hear it to listen before saving.' : 'Add the Azure key and region in Technical details below first.'}</p>
      <div style={grid}>
        {['English', 'Urdu'].map((lang) => {
          const list = voices?.[lang]?.length ? voices[lang] : [{ name: selected[lang], label: selected[lang] }];
          return (
            <Field key={lang} label={`${lang} voice`}>
              <span className="row" style={{ gap: 8 }}>
                <select className="input" value={selected[lang]} disabled={!can || !ready} onChange={(e) => setSelected({ ...selected, [lang]: e.target.value })}>{list.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}</select>
                <button className="btn sm info" disabled={!ready || busy === lang} onClick={() => hear(lang)}>{busy === lang ? 'Playing…' : 'Hear it'}</button>
              </span>
            </Field>);
        })}
      </div>
      {can && <div style={{ marginTop: 12 }}><button className="btn primary" disabled={!ready} onClick={save}>Save voices</button></div>}
    </FoldCard>
  );
}

/** FreeLLMAPI: an extra AI provider (free tiers behind one address). Key, switches per feature, and which workspaces may send their own data. */
function Freellm({ can }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [f, setF] = useState({ key: '', base_url: '' });
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null); // { ws, confirm }
  const load = useCallback(() => api.get(`${A}/ai/freellm`).then((x) => { setV(x); setF((p) => ({ ...p, base_url: x.base_url })); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!v) return null;
  const put = async (body, msg) => { try { const r = await api.put(`${A}/ai/freellm`, body); setV((p) => ({ ...p, ...r })); toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };
  const test = async () => { setBusy(true); try { const r = await api.post(`${A}/ai/freellm/test`, {}); toast(`FreeLLMAPI answered (${r.models} models, ${r.ms} ms)`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the saved FreeLLMAPI key? The .env key (if any) is used instead.')) return; try { await api.del(`${A}/ai/freellm/key`); toast('Key removed'); load(); } catch (e) { toast(e.message, 'err'); } };
  const setWs = async (ws, on, confirm) => { try { await api.put(`${A}/ai/freellm/workspaces/${ws.id}`, { on, confirm }); toast(on ? `Workspace data allowed for ${ws.name}` : `Workspace data blocked for ${ws.name}`); setAsk(null); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <FoldCard title="FreeLLMAPI (extra AI provider)" summary={<Dot tone={v.ready ? 'ok' : 'warn'}>{v.ready ? 'FreeLLMAPI on' : v.enabled ? 'No key yet' : 'FreeLLMAPI off'}</Dot>} tone={v.ready ? 'ok' : 'warn'}>
      <p className="muted" style={{ marginTop: 0 }}>FreeLLMAPI runs on the same server and routes to free AI providers. It never replaces your other engines: it answers help questions that hold no workspace data, and it is the last backup when the other engines fail. Workspace data only goes to it for workspaces you allow below. Free calls cost 0 and show in the usage list as provider freellmapi with the model that answered.</p>
      <p className="muted">Key: {v.key_added ? <span className="pill green">Added {v.key_hint} ({v.key_from === 'env' ? 'from .env' : 'saved here'})</span> : <span className="pill grey">Not added</span>}</p>
      {can && <>
        <div style={grid}>
          <Field label={v.key_added ? 'Replace key (optional)' : 'FreeLLMAPI unified key'} hint="Looks like freellmapi-… . Stored encrypted."><TextInput type="password" value={f.key} onChange={(x) => setF({ ...f, key: x })} autoComplete="off" /></Field>
          <Field label="Address" hint="Default http://localhost:3001/v1"><TextInput value={f.base_url} onChange={(x) => setF({ ...f, base_url: x })} /></Field>
        </div>
        <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          <label><input type="checkbox" checked={v.enabled} onChange={(e) => put({ enabled: e.target.checked }, e.target.checked ? 'FreeLLMAPI switched on' : 'FreeLLMAPI switched off')} /> <b>Use FreeLLMAPI</b></label>
          {Object.entries(v.feature_labels).map(([k, label]) => <label key={k}><input type="checkbox" checked={v.features[k]} onChange={(e) => put({ features: { [k]: e.target.checked } }, `${label}: ${e.target.checked ? 'on' : 'off'}`)} /> {label}</label>)}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn primary" onClick={() => put({ ...(f.key ? { key: f.key } : {}), base_url: f.base_url }, 'FreeLLMAPI settings saved').then(() => setF((p) => ({ ...p, key: '' })))}>Save</button>
          <button className="btn info" disabled={busy} onClick={test}>{busy ? 'Testing…' : 'Test the connection'}</button>
          {v.key_from === 'console' && <button className="btn danger" onClick={remove}>Remove saved key</button>}
        </div>
      </>}
      <div style={{ marginTop: 16 }}>
        <b>Allow workspace data through FreeLLMAPI</b>
        <p className="muted" style={{ margin: '4px 0 8px' }}>{v.warning} Off for every workspace by default. {v.tenants_with_data_on} workspace(s) on now.</p>
        {can && <label style={{ display: 'block', marginBottom: 8 }}><input type="checkbox" checked={v.tenant_data_master_off} onChange={(e) => put({ tenant_data_master_off: e.target.checked }, e.target.checked ? 'Emergency off: no workspace data goes to FreeLLMAPI' : 'Emergency off lifted')} /> <b style={{ color: '#b91c1c' }}>Emergency off for ALL workspaces</b> (overrides every switch below)</label>}
        <div className="table-wrap"><table className="t"><thead><tr><th>Workspace</th><th>Status</th><th>Set by</th><th /></tr></thead><tbody>
          {v.workspaces.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.on ? <span className="pill green">Allowed{v.tenant_data_master_off ? ' (blocked by emergency off)' : ''}</span> : <span className="pill grey">Off</span>}</td><td>{w.on ? `${w.by || ''} ${ago(w.at ? `${w.at.replace(' ', 'T')}Z` : null)}` : ''}</td>
            <td>{can && (w.on ? <button className="btn" onClick={() => setWs(w, false)}>Turn off</button> : <button className="btn" onClick={() => setAsk({ ws: w, confirm: false })}>Turn on…</button>)}</td></tr>)}
        </tbody></table></div>
        {ask && <div className="card" style={{ marginTop: 10, padding: 12, border: '1px solid #b45309' }}>
          <b>Allow {ask.ws.name}'s data through FreeLLMAPI?</b>
          <p style={{ margin: '6px 0' }}>{v.warning}</p>
          <label><input type="checkbox" checked={ask.confirm} onChange={(e) => setAsk({ ...ask, confirm: e.target.checked })} /> I confirm this workspace has agreed.</label>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn primary" disabled={!ask.confirm} onClick={() => setWs(ask.ws, true, true)}>Allow</button><button className="btn" onClick={() => setAsk(null)}>Cancel</button></div>
        </div>}
      </div>
    </FoldCard>
  );
}

const ENGINE_LABEL = { groq: 'Groq', horde: 'Stable Horde', gemini: 'Gemini' };
/** Groq: fast chat, picture understanding and speech-to-text for Ask; plus the order Ask tries its engines in. */
function Groq({ t, can, reload }) {
  const toast = useToast();
  const g = t.groq;
  const [f, setF] = useState({ key: '', chat_model: g.chat_model === g.defaults.chat ? '' : g.chat_model, vision_model: g.vision_model === g.defaults.vision ? '' : g.vision_model, stt_model: g.stt_model === g.defaults.stt ? '' : g.stt_model });
  const [order, setOrder] = useState(t.ask_order);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState(null); // result of a one-engine test
  const [probing, setProbing] = useState('');
  const tryEngine = async (e) => { setProbing(e); setProbe(null); try { setProbe(await api.post(`${A}/ai/ask-engine/test`, { engine: e })); reload(); } catch (err) { toast(err.message, 'err'); } finally { setProbing(''); } };
  const save = async () => { try { await api.put(`${A}/ai/groq`, { chat_model: f.chat_model, vision_model: f.vision_model, stt_model: f.stt_model, provider_order: order, ...(f.key ? { key: f.key } : {}) }); toast('Groq settings saved'); setF({ ...f, key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const test = async () => { setBusy(true); try { const r = await api.post(`${A}/ai/groq/test`, {}); toast(`Groq connected (${r.models} models available)`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the Groq key? Ask voice and picture questions stop until a key is added again.')) return; try { await api.del(`${A}/ai/groq/key`); toast('Groq key removed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const move = (i, d) => { const o = [...order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  const on = { groq: g.key_added && g.enabled, horde: t.stablehorde.key_added && t.stablehorde.enabled, gemini: t.stablehorde.gemini_enabled && t.gemini.added };
  const sw = { groq: g.enabled, horde: t.stablehorde.enabled, gemini: t.stablehorde.gemini_enabled };
  const flip = async (body, msg) => { try { await api.put(`${A}/ai/ask-engines`, body); toast(msg); reload(); } catch (err) { toast(err.message, 'err'); } };
  return (
    <FoldCard title="Groq and Ask engines" summary={g.key_added ? <Dot tone={g.enabled ? 'ok' : 'warn'}>{g.enabled ? 'Groq connected' : 'Groq off'}</Dot> : <Dot tone="warn">Groq key not added</Dot>} tone={g.key_added && g.enabled ? 'ok' : 'warn'}>
      <p className="muted" style={{ marginTop: 0 }}>Groq key: {g.key_added ? <span className="pill green">Added {g.key_hint}</span> : <span className="pill grey">Not added</span>}. Groq runs Ask chat answers, questions about a picture people attach, and speech-to-text for the microphone (so voice works in the Android app too). Free Groq accounts have rate limits: when Groq says it is busy, Ask moves to the next engine. Questions are scrubbed of emails, numbers, keys and names before they are sent; a picture cannot be scrubbed, so tell people not to attach client data.</p>
      {can && <div style={grid}>
        <Field label={g.key_added ? 'Replace Groq key (optional)' : 'Groq API key'} hint="Starts with gsk_ . Stored encrypted."><TextInput type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} autoComplete="off" /></Field>
        <Field label="Chat model (optional)" hint={`Default ${g.defaults.chat}`}><TextInput value={f.chat_model} onChange={(v) => setF({ ...f, chat_model: v })} /></Field>
        <Field label="Picture model (optional)" hint={`Default ${g.defaults.vision}`}><TextInput value={f.vision_model} onChange={(v) => setF({ ...f, vision_model: v })} /></Field>
        <Field label="Speech model (optional)" hint={`Default ${g.defaults.stt}`}><TextInput value={f.stt_model} onChange={(v) => setF({ ...f, stt_model: v })} /></Field>
      </div>}
      <div style={{ marginTop: 12 }}>
        <b>Ask engine order</b>
        <p className="muted" style={{ margin: '2px 0 8px' }}>Ask tries the top engine first and moves down when one fails. An engine whose Enabled box is unticked is never called, not even as a backup, until you tick it again.</p>
        {order.map((e, i) => <div key={e} className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span style={{ width: 20 }}>{i + 1}.</span><span style={{ minWidth: 110 }}>{ENGINE_LABEL[e]}</span>{on[e] ? <span className="pill green">on</span> : <span className="pill grey">off</span>}
          {can && <><label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!sw[e]} onChange={(x) => flip({ [e]: x.target.checked }, `${ENGINE_LABEL[e]} switched ${x.target.checked ? 'on' : 'off'}`)} aria-label={`Switch ${ENGINE_LABEL[e]} on or off`} /> Enabled</label><button className="btn sm" onClick={() => flip({ only: e }, `Only ${ENGINE_LABEL[e]} is on now`)}>Use only this engine</button><button className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${ENGINE_LABEL[e]} up`}>Up</button><button className="btn sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${ENGINE_LABEL[e]} down`}>Down</button><button className="btn sm" disabled={!!probing} onClick={() => tryEngine(e)} aria-label={`Test ${ENGINE_LABEL[e]} alone`}>{probing === e ? 'Testing…' : 'Test this engine'}</button></>}
        </div>)}
        {probe && <div style={{ marginTop: 8, padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }}>
          <b>{probe.name} alone</b> · {probe.ok ? <span className="pill green">worked</span> : <span className="pill grey">did not work</span>}{probe.ms != null ? ` · ${(probe.ms / 1000).toFixed(1)} s` : ''}{probe.model ? ` · model ${probe.model}` : ''}
          <div className="muted" style={{ fontSize: 12 }}>Question sent: "{probe.question}". Only this engine was asked; nothing fell back to another one.</div>
          {probe.note && <div style={{ color: '#b45309', fontSize: 12 }}>{probe.note}</div>}
          {probe.error && <div style={{ color: '#b45309', marginTop: 4 }}>{probe.error}</div>}
          {probe.answer && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{probe.answer}</div>}
        </div>}
      </div>
      <div style={{ marginTop: 12 }}>
        <b>Who has been answering Ask (last {t.ask_activity.days} days)</b>
        {t.ask_activity.last ? <p className="muted" style={{ margin: '2px 0 6px' }}>Latest call: <b>{ENGINE_LABEL[{ stablehorde: 'horde' }[t.ask_activity.last.provider] || t.ask_activity.last.provider] || t.ask_activity.last.provider}</b>{t.ask_activity.last.model ? ` (${t.ask_activity.last.model})` : ''} · {t.ask_activity.last.ok ? 'answered' : 'failed'} · {new Date(t.ask_activity.last.at).toLocaleString()}</p> : <p className="muted" style={{ margin: '2px 0 6px' }}>No AI answers yet.</p>}
        {Object.entries(t.ask_activity.last_errors || {}).filter(([, v]) => v).map(([k, v]) => <p key={k} className="muted" style={{ margin: '2px 0', color: '#b45309' }}>Last {ENGINE_LABEL[k] || k} problem ({new Date(v.at).toLocaleString()}): {v.message}</p>)}
        {!g.key_added && <p className="muted" style={{ margin: '2px 0', color: '#b45309' }}>Groq is skipped because no Groq key is saved yet.</p>}
        {g.key_added && !g.enabled && <p className="muted" style={{ margin: '2px 0', color: '#b45309' }}>Groq is skipped because it is switched off in the engine list.</p>}
        {t.ask_activity.by_engine.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Engine</th><th>Used for</th><th className="num">Answered</th><th className="num">Failed</th><th>Last</th></tr></thead><tbody>{t.ask_activity.by_engine.map((r) => <tr key={`${r.provider}${r.purpose}`}><td>{ENGINE_LABEL[{ stablehorde: 'horde' }[r.provider] || r.provider] || r.provider}</td><td>{{ ask_assistant: 'Chat', ask_image: 'Pictures', ask_voice: 'Voice' }[r.purpose] || r.purpose}</td><td className="num">{r.ok}</td><td className="num">{r.failed}</td><td>{new Date(r.last_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
      </div>
      {can && <div className="row" style={{ gap: 8, marginTop: 12 }}><button className="btn primary" onClick={save}>Save Groq and order</button>{g.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn info" disabled={!g.key_added || busy} onClick={test}>{busy ? 'Testing…' : 'Test the connection'}</button></div>}
    </FoldCard>
  );
}

/** Stable Horde: community AI that Ask can use first or as a backup. Key stored encrypted, never shown again. */
function Horde({ t, can, reload }) {
  const toast = useToast();
  const h = t.stablehorde;
  const [f, setF] = useState({ key: '', models: h.models.join(', '), trusted_only: h.trusted_only });
  const [busy, setBusy] = useState(false);
  const save = async () => { try { await api.put(`${A}/ai/horde`, { models: f.models, trusted_only: f.trusted_only, ...(f.key ? { key: f.key } : {}) }); toast('Stable Horde settings saved'); setF({ ...f, key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const test = async () => { setBusy(true); try { const r = await api.post(`${A}/ai/horde/test`, {}); toast(`Stable Horde connected${r.username ? ` as ${r.username}` : ''}${r.kudos != null ? ` · ${Math.round(r.kudos)} kudos` : ''}`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('Remove the Stable Horde key? Ask falls back to Gemini only.')) return; try { await api.del(`${A}/ai/horde/key`); toast('Stable Horde key removed'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <FoldCard title="Stable Horde (community AI for Ask)" summary={h.key_added ? <Dot tone={h.enabled ? 'ok' : 'warn'}>{h.enabled ? 'Connected' : 'Switched off'}</Dot> : <Dot>Optional, key not added</Dot>}>
      <p className="muted" style={{ marginTop: 0 }}>Key: {h.key_added ? <span className="pill green">Added {h.key_hint}</span> : <span className="pill grey">Not added</span>}. Stable Horde is one of Ask's engines (see Ask engines above for the order). Gemini is used only while its Enabled box in the engine list above is ticked. If Horde fails and Gemini is off, people see a short busy message. Ask answers from the Agentify guides in the language the person writes in. Stable Horde is run by volunteers: answers can be slow and uneven, and prompts may be seen by workers. Only guide text and the question are sent, with emails, phone numbers, long numbers, keys and the asker's name removed first. Never put client data in Ask.</p>
      {can && <div style={grid}>
        <Field label={h.key_added ? 'Replace Stable Horde key (optional)' : 'Stable Horde API key'} hint="From aihorde.net. Stored encrypted."><TextInput type="password" value={f.key} onChange={(v) => setF({ ...f, key: v })} autoComplete="off" /></Field>
        <Field label="Models (optional)" hint="Up to 5, comma separated. Empty lets the Horde choose."><TextInput value={f.models} onChange={(v) => setF({ ...f, models: v })} /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.trusted_only} onChange={(e) => setF({ ...f, trusted_only: e.target.checked })} /> Use trusted workers only (recommended)</label>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={save}>Save Stable Horde</button>{h.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn info" disabled={!h.key_added || busy} onClick={test}>{busy ? 'Testing…' : 'Test the connection'}</button></div>
      </div>}
    </FoldCard>
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
    <FoldCard title="Technical details" summary={<>Gemini {t.gemini.added ? <Dot>added</Dot> : <Dot tone="warn">not added</Dot>} Azure speech {t.azure.key_added ? <Dot>added</Dot> : <Dot tone="warn">not added</Dot>}</>}>
      <p className="muted" style={{ marginTop: 0 }}>Gemini key: {t.gemini.added ? <span className="pill green">Added {t.gemini.key_hint}</span> : <span className="pill grey">Not added</span>} (add or test it in AI settings below) · Azure Speech key: {t.azure.key_added ? <span className="pill green">Added {t.azure.key_hint}</span> : <span className="pill grey">Not added</span>}{t.azure.region ? ` · region ${t.azure.region}` : ''}. Keys are stored encrypted and are never shown again.</p>
      {can && <div style={grid}>
        <Field label={t.azure.key_added ? 'Replace Azure Speech key (optional)' : 'Azure Speech key'}><TextInput type="password" value={az.key} onChange={(v) => setAz({ ...az, key: v })} autoComplete="off" /></Field>
        <Field label="Azure region" hint="For example uaenorth or eastus"><TextInput value={az.region} onChange={(v) => setAz({ ...az, region: v })} /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={save}>Save Azure details</button>{t.azure.key_added && <button className="btn danger" onClick={remove}>Remove key</button>}<button className="btn info" disabled={!t.azure.key_added || !t.azure.region || testing} onClick={testAzure}>{testing ? 'Testing…' : 'Test the connection'}</button></div>
      </div>}
      <p className="muted"><b>How the cost is counted:</b> the AI company charges by the amount of text the AI reads and writes (tokens), and the voice service by the number of letters it speaks. Agentify records the exact cost each time AI is used, with the rupee rate of that moment, and adds it all up in rupees on this page. Calls made with a workspace's own key are paid by that workspace and are not counted here.</p>
      <div style={{ marginTop: 12 }}><b>Which model does what</b>
        <div className="table-wrap"><table className="t"><thead><tr><th>Purpose</th><th>Engine</th><th>Model</th><th>State</th><th>Last used</th></tr></thead><tbody>{t.model_map.map((m) => <tr key={m.key}><td>{m.purpose}{m.note ? <div className="muted" style={{ fontSize: 11 }}>{m.note}</div> : null}</td><td>{m.engine}</td><td>{m.model}</td><td><span className={`pill ${m.on ? 'green' : 'grey'}`}>{m.on ? 'On' : 'Off'}</span></td><td>{m.last ? <>{new Date(m.last.at).toLocaleString()}<div className="muted" style={{ fontSize: 11 }}>{m.last.ok ? 'worked' : 'failed'}{m.last.model ? ` · ${m.last.model}` : ''}</div></> : <span className="muted">not yet</span>}</td></tr>)}</tbody></table></div>
      </div>
    </FoldCard>
    <Groq t={t} can={can} reload={reload} />
    <Horde t={t} can={can} reload={reload} />
    <Freellm can={can} />
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
      <CostSummary o={o} cur={cur} />
      <MasterSwitch o={o} can={can} reload={load} />
      <div className="cc-stats">
        <Card><div className="cc-k">Agentify-key AI cost this month</div><div className="cc-v">{usd(o.month.spent_usd)}</div><div className="cell-sub">{rs(o.month.spent_pkr, cur)} at {o.rate.rate} {cur} per USD</div></Card>
        <Card><div className="cc-k">Video cost this month</div><div className="cc-v">{usd(o.month.video_spent_usd)}</div><div className="cell-sub">{o.month.video_budget_usd != null ? `of ${usd(o.month.video_budget_usd)} video budget` : 'No video budget set'}</div></Card>
      </div>
      <FoldCard title="Cost this month by feature" summary="Full table of uses and costs" flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>Feature</th><th className="num">Uses</th><th className="num">Read / written</th><th className="num">USD</th><th className="num">{cur}</th><th>Switch</th></tr></thead>
          <tbody>{o.features.map((f) => <tr key={f.key}><td>{f.label}</td><td className="num">{n0(f.uses)}</td><td className="num">{f.characters ? `${n0(f.characters)} letters spoken` : f.tokens_in || f.tokens_out ? `${n0(f.tokens_in)} read / ${n0(f.tokens_out)} written` : '–'}</td><td className="num">{usd(f.usd)}</td><td className="num">{rs(f.pkr, cur).replace(`${cur} `, '')}</td><td>{f.enabled ? 'On' : <span className="pill red">Off</span>}</td></tr>)}</tbody></table></div>
      </FoldCard>
      </>}
      {tab === 'prices' && <>
        <PlainPrices o={o} />
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
