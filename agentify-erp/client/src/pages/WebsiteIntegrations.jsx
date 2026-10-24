// Settings > Website Integrations: connect a website, a plugin or an automation tool to the CRM. Each connection has its own
// key (shown once) and its own permissions; this page also shows its health, hosted forms and event deliveries.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Select, Tabs, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const PLATFORMS = [
  { key: 'wordpress', label: 'WordPress', method: 'The "Agentify Connect" plugin', scopes: ['leads:write', 'listings:read', 'projects:read', 'agents:read', 'webhooks:manage'],
    note: 'The plugin is not released yet. Until it is, a WordPress developer can connect this site with the key and the API reference.' },
  { key: 'custom', label: 'Custom website', method: 'Server API, or the hosted form', scopes: ['leads:write', 'listings:read', 'projects:read'], note: 'Your developer sends leads from the website\'s server with the key. For a plain contact form without a developer, use a hosted form (next step).' },
  { key: 'webflow', label: 'Webflow', method: 'Hosted form (embed block)', scopes: ['leads:write'], note: 'Add the hosted form to an Embed block. It has not been tested on Webflow yet.' },
  { key: 'wix', label: 'Wix', method: 'Hosted form (embed block)', scopes: ['leads:write'], note: 'Add the hosted form to an Embed or HTML block. It has not been tested on Wix yet.' },
  { key: 'squarespace', label: 'Squarespace', method: 'Hosted form (code block)', scopes: ['leads:write'], note: 'Add the hosted form to a Code block. It has not been tested on Squarespace yet.' },
  { key: 'zapier', label: 'Zapier or another tool', method: 'Events and the API', scopes: ['leads:write', 'webhooks:manage'], note: 'Subscribe to events with the API. A ready-made Zapier app is not published yet.' },
];
const when = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');
const copy = async (text, toast) => { try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); } catch { toast('Select the text and copy it', 'err'); } };

function CodeBox({ text, toast }) {
  return (
    <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
      <textarea className="input mono" readOnly rows={Math.min(8, text.split('\n').length + 1)} value={text} style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <button className="btn sm" onClick={() => copy(text, toast)}>Copy</button>
    </div>
  );
}

function Wizard({ meta, onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState('platform');
  const [f, setF] = useState({ platform: 'custom', name: '', scopes: [], lead_source: 'Website', stage_id: '', agent_id: '', require_privacy_consent: false, listings: 'all', project_ids: [] });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const [test, setTest] = useState(null);
  const [saved, setSaved] = useState(false);
  const plat = PLATFORMS.find((p) => p.key === f.platform);
  const pick = (key) => { const p = PLATFORMS.find((x) => x.key === key); setF({ ...f, platform: key, scopes: p.scopes, name: f.name || p.label }); setStep('details'); };
  const toggle = (k) => setF({ ...f, scopes: f.scopes.includes(k) ? f.scopes.filter((x) => x !== k) : [...f.scopes, k] });
  const create = async () => {
    setBusy(true);
    try {
      const config = { lead_source: f.lead_source, listings: f.listings, require_privacy_consent: f.require_privacy_consent };
      if (f.stage_id) config.stage_id = Number(f.stage_id);
      if (f.agent_id) config.agent_id = Number(f.agent_id);
      if (f.listings === 'projects') config.project_ids = f.project_ids;
      setMade(await api.post('/api/website-integrations/connections', { name: f.name, platform: f.platform, scopes: f.scopes, config }));
      setStep('key');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const sendTest = async () => { setBusy(true); try { setTest(await api.post(`/api/website-integrations/connections/${made.connection.id}/test-lead`)); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const base = window.location.origin;
  const curl = made ? `curl -X POST ${base}/api/v1/leads \\\n  -H "Authorization: Bearer ${made.key}" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Test Visitor","email":"test@example.com","message":"Hello","test":true}'` : '';
  const finish = () => { onDone(); onClose(); };

  return (
    <Modal title="Connect a website" size="lg" onClose={step === 'key' && !saved ? () => toast('Copy the key first. It is shown only once.', 'err') : (made ? finish : onClose)}
      footer={step === 'details' ? <><button className="btn" onClick={() => setStep('platform')}>Back</button><button className="btn primary" disabled={!f.name.trim() || !f.scopes.length} onClick={() => setStep('leads')}>Next</button></>
        : step === 'leads' ? <><button className="btn" onClick={() => setStep('details')}>Back</button><button className="btn primary" disabled={busy || (f.listings === 'projects' && !f.project_ids.length)} onClick={create}>{busy ? 'Creating…' : 'Create connection'}</button></>
          : step === 'key' ? <button className="btn primary" disabled={!saved} onClick={() => setStep('test')}>Next: send a test</button>
            : step === 'test' ? <button className="btn primary" onClick={finish}>Done</button> : null}>
      {step === 'platform' && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>What are you connecting? You will get a key that only works for this connection, so you can switch it off without affecting anything else.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {PLATFORMS.map((p) => (
              <button key={p.key} className="card" style={{ textAlign: 'left', padding: 12, cursor: 'pointer' }} onClick={() => pick(p.key)}>
                <b>{p.label}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{p.method}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 'details' && (
        <div className="stack">
          <div className="alert info">{plat.note}</div>
          <Field label="Name" hint="For you, for example Main website"><input className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div><b>What may it do?</b>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {meta.scopes.map((s) => (
                <label key={s.key} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={f.scopes.includes(s.key)} onChange={() => toggle(s.key)} style={{ marginTop: 3 }} /><span>{s.label}<div className="muted mono" style={{ fontSize: 11.5 }}>{s.key}</div></span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      {step === 'leads' && (
        <div className="stack">
          <div className="form-grid">
            <Field label="Lead source label" hint="Shown on every lead from this website"><input className="input" value={f.lead_source} maxLength={60} onChange={(e) => setF({ ...f, lead_source: e.target.value })} /></Field>
            <Field label="Start leads in stage" hint="Leave empty for the first stage"><Select value={f.stage_id} onChange={(v) => setF({ ...f, stage_id: v })} options={meta.stages.map((s) => ({ value: s.id, label: s.name }))} placeholder="First stage" /></Field>
            <Field label="Give new leads to" hint="Leave empty to share them between sales agents"><Select value={f.agent_id} onChange={(v) => setF({ ...f, agent_id: v })} options={meta.agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="Share between agents" /></Field>
            <Field label="Listings this website may show">
              <Select allowEmpty={false} value={f.listings} onChange={(v) => setF({ ...f, listings: v })} options={[{ value: 'all', label: 'All published listings' }, { value: 'featured', label: 'Featured listings only' }, { value: 'projects', label: 'Only chosen projects' }]} />
            </Field>
          </div>
          {f.listings === 'projects' && (
            <div className="row wrap" style={{ gap: 12 }}>{meta.projects.map((p) => (
              <label key={p.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.project_ids.includes(p.id)} onChange={() => setF({ ...f, project_ids: f.project_ids.includes(p.id) ? f.project_ids.filter((x) => x !== p.id) : [...f.project_ids, p.id] })} />{p.name}</label>
            ))}{!meta.projects.length && <span className="muted">No project is shown on the website yet.</span>}</div>
          )}
          <div className="row between"><span>Only accept leads when the visitor accepted the privacy notice<div className="muted" style={{ fontSize: 12 }}>The website must send consent.privacy = true</div></span><Toggle value={f.require_privacy_consent} onChange={(v) => setF({ ...f, require_privacy_consent: v })} /></div>
        </div>
      )}
      {step === 'key' && made && (
        <div className="stack">
          <div className="alert warn"><b>Copy the key now.</b> It is shown only once and cannot be read again. If you lose it, rotate it to get a new one.</div>
          <Field label="Key for this connection"><div className="row" style={{ gap: 6 }}><input className="input mono" readOnly value={made.key} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copy(made.key, toast)}>Copy</button></div></Field>
          <p className="muted" style={{ margin: 0 }}>Keep it on the website's server, never in a web page. Try it from a terminal:</p>
          <CodeBox text={curl} toast={toast} />
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved the key somewhere safe</label>
        </div>
      )}
      {step === 'test' && made && (
        <div className="stack">
          <p style={{ margin: 0 }}>Send a test lead through this connection to see what your team will see. It is marked as test data.</p>
          {!test && <div><button className="btn primary" disabled={busy} onClick={sendTest}>{busy ? 'Sending…' : 'Send a test lead'}</button></div>}
          {test && (
            <div className="alert ok">
              Test lead landed in the CRM: <b>{test.lead.full_name}</b> · source <b>{test.lead.lead_source}</b> · stage <b>{test.lead.stage || '—'}</b> · agent <b>{test.lead.agent || 'not assigned'}</b>.
              {' '}<Link to={test.lead.link}>Open the lead</Link>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Overview({ c, can, reload, onKey }) {
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [ask, setAsk] = useState(null);
  const load = useCallback(() => api.get(`/api/website-integrations/connections/${c.id}/events`).then(setEvents).catch(() => setEvents([])), [c.id]);
  useEffect(() => { load(); }, [load]);
  const live = c.status === 'active';
  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`pill ${live ? 'green' : 'grey'}`}>{live ? 'Active' : 'Disconnected'}</span>
        {c.last_error && c.last_error_at > (c.last_success_at || '') && <span className="pill red">Last call failed</span>}
        {c.rotating_until && <span className="pill amber">Old key works until {when(c.rotating_until)}</span>}
        <span className="muted">Key ends in <span className="mono">{c.key_hint}</span> · created {when(c.created_at)}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>Last successful call</div><b>{when(c.last_success_at)}</b></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Last used</div><b>{when(c.last_used_at)}</b></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Leads received</div><b>{c.leads}</b></div>
      </div>
      {c.last_error && <div className="alert warn">Last error ({when(c.last_error_at)}): {c.last_error}</div>}
      <div className="muted" style={{ fontSize: 12.5 }}>May do: {c.scopes.join(', ')}</div>
      {live && can && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={async () => { try { const r = await api.post(`/api/website-integrations/connections/${c.id}/test-lead`); toast(`Test lead created: ${r.lead.full_name}`, 'ok'); load(); reload(); } catch (e) { toast(e.message, 'err'); } }}>Send a test lead</button>
          <button className="btn sm" onClick={() => setAsk('rotate')}>Rotate key</button>
          <button className="btn sm danger" onClick={() => setAsk('revoke')}>Disconnect</button>
        </div>
      )}
      <h4 style={{ margin: '8px 0 0' }}>Recent activity</h4>
      {!events ? <Loading /> : !events.length ? <div className="muted">Nothing yet.</div> : (
        <div className="stack" style={{ gap: 4 }}>{events.map((e, i) => <div key={i} className="row" style={{ gap: 8, fontSize: 13 }}><span className="muted mono" style={{ minWidth: 118 }}>{when(e.created_at)}</span><span className={`pill ${e.outcome === 'success' ? 'green' : 'red'}`}>{e.event}</span><span className="muted">{e.detail}</span></div>)}</div>
      )}
      {ask === 'rotate' && <ConfirmDialog title="Rotate this key?" message="You get a new key now. The old key keeps working for 24 hours so you can update the website first, then it stops." confirmLabel="Rotate key" onCancel={() => setAsk(null)} onConfirm={async () => { try { const r = await api.post(`/api/website-integrations/connections/${c.id}/rotate`); setAsk(null); reload(); onKey(r); } catch (e) { toast(e.message, 'err'); } }} />}
      {ask === 'revoke' && <ConfirmDialog danger title="Disconnect this website?" message="Its key stops working at once and its hosted forms are switched off. Leads it already sent stay in the CRM." confirmLabel="Disconnect" onCancel={() => setAsk(null)} onConfirm={async () => { try { await api.del(`/api/website-integrations/connections/${c.id}`); setAsk(null); reload(); toast('Disconnected', 'ok'); } catch (e) { toast(e.message, 'err'); } }} />}
    </div>
  );
}

function Forms({ c, can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get(`/api/website-integrations/connections/${c.id}/forms`).then(setRows).catch(() => setRows([])), [c.id]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    const body = { name: edit.name, title: edit.title, button: edit.button, consent_text: edit.consent_text, origins: String(edit.origins || '').split(/[\s,]+/).filter(Boolean) };
    try { if (edit.id) await api.put(`/api/website-integrations/connections/${c.id}/forms/${edit.id}`, body); else await api.post(`/api/website-integrations/connections/${c.id}/forms`, body); setEdit(null); load(); toast('Form saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const canSend = c.scopes.includes('leads:write');
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>A hosted form is a ready-made enquiry form you paste into any website. It needs no key and no code. Only the websites you list can show it.</p>
      {!canSend && <div className="alert warn">This connection may not send leads, so its forms cannot work. Create a connection with the leads permission.</div>}
      {c.status === 'active' && can && canSend && <div><button className="btn primary sm" onClick={() => setEdit({ name: '', title: '', button: '', consent_text: '', origins: '' })}>New hosted form</button></div>}
      {!rows ? <Loading /> : !rows.length ? <Empty title="No hosted forms yet" /> : rows.map((f) => (
        <div key={f.id} className="card" style={{ padding: 12 }}>
          <div className="row between"><div><b>{f.name}</b><div className="muted" style={{ fontSize: 12 }}>Shown on: {f.origins.length ? f.origins.join(', ') : 'no website yet (add one to embed it)'} · last used {when(f.last_used_at)}</div></div>
            {can && <div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => setEdit({ ...f, origins: f.origins.join('\n') })}>Edit</button><button className="btn sm danger" onClick={async () => { if (!window.confirm('Switch this form off? Websites showing it will stop working.')) return; await api.del(`/api/website-integrations/connections/${c.id}/forms/${f.id}`); load(); }}>Switch off</button></div>}
          </div>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 12 }}>Paste into your website (one of the two):</div>
            <CodeBox text={f.snippets.script} toast={toast} />
            <CodeBox text={f.snippets.iframe} toast={toast} />
          </div>
        </div>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Edit hosted form' : 'New hosted form'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.name.trim()} onClick={save}>Save form</button></>}>
          <div className="stack">
            <Field label="Name" hint="For you, for example Contact page; it is also the form name on each lead"><input className="input" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Heading"><input className="input" value={edit.title || ''} maxLength={120} placeholder="Contact us" onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Button text"><input className="input" value={edit.button || ''} maxLength={40} placeholder="Send enquiry" onChange={(e) => setEdit({ ...edit, button: e.target.value })} /></Field>
            <Field label="Websites that may show this form" hint="One address per line, for example https://www.example.com"><textarea className="textarea" rows={3} value={edit.origins} onChange={(e) => setEdit({ ...edit, origins: e.target.value })} /></Field>
            <Field label="Consent sentence (optional)" hint="Adds a required checkbox. The sentence is stored with each lead, with the time"><textarea className="textarea" rows={2} maxLength={600} value={edit.consent_text || ''} onChange={(e) => setEdit({ ...edit, consent_text: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Hooks({ c, can }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const load = useCallback(() => api.get(`/api/website-integrations/connections/${c.id}/webhooks`).then(setD).catch(() => setD({ events: {}, subscriptions: [], deliveries: [] })), [c.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const tone = { delivered: 'green', pending: 'amber', failed: 'red', cancelled: 'grey' };
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>The website subscribes to events with <span className="mono">POST /api/v1/webhooks</span> (this connection needs the “Subscribe to events” permission). Every event is signed so the website can check it came from here.</p>
      <h4 style={{ margin: 0 }}>Subscriptions</h4>
      {!d.subscriptions.length ? <div className="muted">None yet.</div> : d.subscriptions.map((s) => (
        <div key={s.id} className="row between" style={{ gap: 8 }}>
          <div className="grow"><span className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{s.url}</span><div className="muted" style={{ fontSize: 12 }}>{s.events.join(', ')} · last success {when(s.last_success_at)}{s.last_error ? ` · last error: ${s.last_error}` : ''}</div></div>
          {can && <button className="btn sm danger" onClick={async () => { await api.del(`/api/website-integrations/connections/${c.id}/webhooks/${s.id}`); load(); }}>Remove</button>}
        </div>
      ))}
      <h4 style={{ margin: '8px 0 0' }}>Recent deliveries</h4>
      {!d.deliveries.length ? <div className="muted">No events sent yet.</div> : d.deliveries.map((x) => (
        <div key={x.id} className="row between" style={{ gap: 8, fontSize: 13 }}>
          <div className="grow"><span className={`pill ${tone[x.status] || 'grey'}`}>{x.status}</span> <b>{x.event}</b> <span className="muted">{when(x.created_at)} · {x.attempts} attempt(s){x.last_error ? ` · ${x.last_error}` : ''}{x.status === 'pending' && x.next_attempt_at ? ` · next try ${when(x.next_attempt_at)}` : ''}</span></div>
          {x.status === 'failed' && can && <button className="btn sm" onClick={async () => { try { const r = await api.post(`/api/website-integrations/connections/${c.id}/deliveries/${x.id}/retry`); toast(r.ok ? 'Delivered' : 'Still failing', r.ok ? 'ok' : 'err'); load(); } catch (e) { toast(e.message, 'err'); } }}>Retry</button>}
        </div>
      ))}
    </div>
  );
}

function Details({ c, can, reload, onKey, onClose }) {
  const [tab, setTab] = useState('overview');
  return (
    <Modal title={c.name} size="lg" onClose={onClose}>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Health' }, { key: 'forms', label: 'Hosted forms' }, { key: 'hooks', label: 'Events' }]} />
      <div style={{ marginTop: 12 }}>
        {tab === 'overview' && <Overview c={c} can={can} reload={reload} onKey={onKey} />}
        {tab === 'forms' && <Forms c={c} can={can} />}
        {tab === 'hooks' && <Hooks c={c} can={can} />}
      </div>
    </Modal>
  );
}

export default function WebsiteIntegrations() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [open, setOpen] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const load = useCallback(() => api.get('/api/website-integrations/connections').then(setRows).catch((e) => { toast(e.message, 'err'); setRows([]); }), [toast]);
  useEffect(() => { load(); api.get('/api/website-integrations/meta').then(setMeta).catch(() => {}); }, [load]);
  const canEdit = can('website', 'edit');
  const current = open ? rows?.find((r) => r.id === open) : null;
  return (
    <div>
      <PageHead title="Website integrations" sub="Connect your website, a plugin or an automation tool to the CRM. Each connection has its own key and permissions.">
        {canEdit && meta && <button className="btn primary" onClick={() => setWizard(true)}>Connect a website</button>}
      </PageHead>
      <div className="stack">
        {!rows ? <Loading /> : !rows.length ? (
          <Card><Empty title="No website is connected yet" sub="Connect a website to receive its enquiries as leads and to share your listings with it." />
            {canEdit && meta && <div style={{ textAlign: 'center' }}><button className="btn primary" onClick={() => setWizard(true)}>Connect a website</button></div>}</Card>
        ) : rows.map((c) => (
          <Card key={c.id}>
            <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b>{c.name}</b> <span className="pill blue">{c.platform}</span> <span className={`pill ${c.status === 'active' ? 'green' : 'grey'}`}>{c.status === 'active' ? 'Active' : 'Disconnected'}</span>
                {c.status === 'active' && c.last_error && c.last_error_at > (c.last_success_at || '') && <> <span className="pill red">Needs attention</span></>}
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c.leads} lead(s) · last successful call {when(c.last_success_at)} · {c.scopes.length} permission(s)</div>
              </div>
              <button className="btn" onClick={() => setOpen(c.id)}>Open</button>
            </div>
          </Card>
        ))}
        <Card title="For developers">
          <div className="muted">Endpoints, examples and the event signature are in the developer guide at <span className="mono">docs/website-integrations/developer-guide.md</span> and the machine-readable <span className="mono">docs/website-integrations/openapi-v1.yaml</span> in the project. The older single-key API is still available under <Link to="/settings/system">System settings</Link>.</div>
        </Card>
      </div>
      {wizard && meta && <Wizard meta={meta} onClose={() => setWizard(false)} onDone={load} />}
      {current && <Details c={current} can={canEdit} reload={load} onKey={setNewKey} onClose={() => setOpen(null)} />}
      {newKey && (
        <Modal title="New key" onClose={() => setNewKey(null)} footer={<button className="btn primary" onClick={() => setNewKey(null)}>I have saved it</button>}>
          <div className="stack"><div className="alert warn"><b>Copy the key now.</b> It cannot be shown again. The old key works for 24 hours.</div>
            <div className="row" style={{ gap: 6 }}><input className="input mono" readOnly value={newKey.key} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copy(newKey.key, toast)}>Copy</button></div></div>
        </Modal>
      )}
    </div>
  );
}
