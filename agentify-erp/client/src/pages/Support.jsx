// Help & Support: the workspace side of the support desk. A person raises a ticket, follows the conversation and attaches
// small files. Everything on this page can be read in English or in the country's own language (Urdu, Arabic, French),
// and the page turns right-to-left for Urdu and Arabic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Empty, Field, Loading, Modal, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTimeUtc } from '../format.js';
import { CATEGORIES, PRIORITIES, LANG_NAMES, ATTACH_LIMITS, st, langDir } from '../../../shared/supportDesk.js';

const KEY = 'erp_support_lang';
const TONE = { open: 'blue', pending: 'amber', solved: 'green', closed: '' };
const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** Read a chosen file as a data URL, checking size and type in the browser first (the server checks again). */
const readFile = (file, L) => new Promise((resolve, reject) => {
  if (!ATTACH_LIMITS.types.includes(file.type)) return reject(new Error(L('file_type')));
  if (file.size > ATTACH_LIMITS.bytes) return reject(new Error(L('file_big')));
  const r = new FileReader();
  r.onerror = () => reject(new Error('That file could not be read'));
  r.onload = () => resolve({ name: file.name, data: r.result });
  r.readAsDataURL(file);
});

function FilePicker({ files, setFiles, L }) {
  const toast = useToast();
  const input = useRef(null);
  const add = async (e) => {
    const picked = [...(e.target.files || [])];
    if (input.current) input.current.value = '';
    if (files.length + picked.length > ATTACH_LIMITS.files) return toast(L('file_many'), 'err');
    for (const f of picked) {
      try { const out = await readFile(f, L); setFiles((cur) => (cur.length >= ATTACH_LIMITS.files ? cur : [...cur, out])); }
      catch (err) { toast(err.message, 'err'); }
    }
  };
  return (
    <Field label={L('attach')} hint={L('attach_hint')}>
      <input ref={input} className="input" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={add} />
      {!!files.length && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{files.map((f, i) => (
        <li key={`${f.name}:${i}`}>{f.name} <button type="button" className="btn sm ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></li>
      ))}</ul>}
    </Field>
  );
}

function NewTicket({ cfg, lang, L, onClose, onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ subject: '', category: 'question', priority: 'normal', body: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    setBusy(true);
    try {
      const t = await api.post('/api/support/tickets', { ...f, lang, files });
      toast(st(lang, 'created', { no: t.no }), 'ok');
      onCreated(t.id);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const disabled = busy || f.subject.trim().length < 3 || f.body.trim().length < 10;
  return (
    <Modal title={L('new')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{L('cancel')}</button><button className="btn primary" disabled={disabled} onClick={send}>{busy ? L('sending') : L('send')}</button></>}>
      <div dir={langDir(lang)}>
        <Field label={L('subject')} required><input className="input" autoFocus maxLength={140} value={f.subject} onChange={set('subject')} /></Field>
        <Field label={L('category')}><select className="input" value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{st(lang, `cat.${c}`)}</option>)}</select></Field>
        <Field label={L('priority')} hint={f.priority === 'urgent' ? L('pri.urgent_hint') : undefined}><select className="input" value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{st(lang, `pri.${p}`)}</option>)}</select></Field>
        <Field label={L('message')} required hint={L('message_hint')}><textarea className="input" rows={6} maxLength={6000} value={f.body} onChange={set('body')} /></Field>
        <FilePicker files={files} setFiles={setFiles} L={L} />
        <p className="muted">{L('secure')}</p>
        {cfg?.languages?.length > 1 && <p className="muted">{L('lang')}: {LANG_NAMES[lang]}</p>}
      </div>
    </Modal>
  );
}

function Conversation({ id, lang, L, onBack, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setD(await api.get(`/api/support/tickets/${id}`)); } catch (e) { setErr(e.message); } };
  useEffect(() => { setD(null); setErr(''); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  const reply = async () => {
    setBusy(true);
    try { setD(await api.post(`/api/support/tickets/${id}/reply`, { body, files })); setBody(''); setFiles([]); onChanged(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const mark = async (status) => {
    try { setD(await api.post(`/api/support/tickets/${id}/status`, { status })); onChanged(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (err) return <Card><Empty icon="file" title={err} action={<button className="btn" onClick={onBack}>{L('back')}</button>} /></Card>;
  if (!d) return <Card><Loading rows={4} /></Card>;
  const t = d.ticket;
  const closed = t.status === 'closed';
  return (
    <div dir={langDir(lang)}>
      <Card title={`${t.no} · ${t.subject}`} actions={<button className="btn sm" onClick={onBack}>{L('back')}</button>}>
        <p className="muted">
          <StatusBadge tone={TONE[t.status]} label={st(lang, `st.${t.status}`)} /> · {st(lang, `cat.${t.category}`)} · {st(lang, `pri.${t.priority}`)} · {dateTimeUtc(t.created_at)}
          {!t.first_response_at && !closed ? ` · ${st(lang, 'reply_by', { when: dateTimeUtc(t.sla.first_due) })}` : ''}
        </p>
        {d.messages.map((m) => (
          <div key={m.id} className="card" style={{ marginBottom: 10, borderInlineStartWidth: 3, borderInlineStartStyle: 'solid', borderInlineStartColor: m.author_type === 'staff' ? 'var(--primary, #0e7c6b)' : 'transparent' }}>
            <div className="card-b">
              <div className="muted" style={{ fontSize: 12 }}><b>{m.author_type === 'staff' ? L('team') : (m.author_name || L('you'))}</b> · {dateTimeUtc(m.created_at)}</div>
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{m.body}</p>
              {!!m.files.length && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{m.files.map((f) => (
                <li key={f.id}><a href={`/api/support/tickets/${t.id}/files/${f.id}`}>{f.name}</a> <span className="muted">({kb(f.size)})</span></li>
              ))}</ul>}
            </div>
          </div>
        ))}
      </Card>
      <Card title={L('reply_send')}>
        {closed ? <p className="muted">{st(lang, 'st.closed')}</p> : <>
          <Field label={L('message')}><textarea className="input" rows={4} maxLength={6000} placeholder={L('reply_ph')} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <FilePicker files={files} setFiles={setFiles} L={L} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy || body.trim().length < 2} onClick={reply}>{busy ? L('sending') : L('reply_send')}</button>
            {t.status !== 'solved' ? <button className="btn" onClick={() => mark('solved')}>{L('mark_solved')}</button> : <button className="btn" onClick={() => mark('open')}>{L('reopen')}</button>}
          </div>
          <p className="muted">{L('secure')}</p>
        </>}
      </Card>
    </div>
  );
}

export default function Support() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [cfg, setCfg] = useState(null);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; } });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const sel = params.get('t');
  const L = useMemo(() => (key, p) => st(lang, key, p), [lang]);
  const load = async (s = status) => { try { setRows(await api.get('/api/support/tickets', s ? { status: s } : undefined)); } catch (e) { setErr(e.message); } };
  useEffect(() => { api.get('/api/support/config').then((c) => { setCfg(c); setLang((cur) => (c.languages.includes(cur) ? cur : 'en')); }).catch(() => setCfg({ languages: ['en'] })); }, []);
  useEffect(() => { load(status); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);
  const choose = (l) => { setLang(l); try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } };
  const show = (id) => { const p = new URLSearchParams(params); if (id) p.set('t', String(id)); else p.delete('t'); setParams(p, { replace: true }); };

  if (sel) return <><PageHead title={L('title')} /><Conversation id={sel} lang={lang} L={L} onBack={() => { show(null); load(); }} onChanged={() => load()} /></>;
  return (
    <>
      <PageHead title={L('title')} sub={L('sub')}>
        <button className="btn primary" data-tour="support-new" onClick={() => setOpen(true)}>{L('new')}</button>
      </PageHead>
      <div dir={langDir(lang)}>
        <Card>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {(cfg?.languages?.length > 1) && (
              <label className="muted" style={{ fontSize: 13 }} data-tour="support-language">{L('lang')}:{' '}
                <select className="input" style={{ width: 'auto', display: 'inline-block' }} value={lang} onChange={(e) => choose(e.target.value)}>
                  {cfg.languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
                </select>
              </label>
            )}
            <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={L('all')}>
              <option value="">{L('all')}</option>
              {['open', 'pending', 'solved', 'closed'].map((s) => <option key={s} value={s}>{st(lang, `st.${s}`)}</option>)}
            </select>
            <span className="muted">{user?.isSuper || cfg?.all_tickets ? L('workspace') : L('mine')}</span>
          </div>
        </Card>
        {err && <Card><Empty icon="file" title={err} /></Card>}
        {!rows ? <Card><Loading rows={3} /></Card> : !rows.length ? (
          <Card><Empty icon="chat" title={L('empty_title')} hint={L('empty_hint')} action={<button className="btn primary" onClick={() => setOpen(true)}>{L('new')}</button>} /></Card>
        ) : (
          <Card flush>
            <div className="table-wrap"><table className="table" data-tour="support-list">
              <thead><tr><th>{L('number')}</th><th>{L('subject')}</th><th>{L('priority')}</th><th>{L('requester')}</th><th>{L('updated')}</th></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => show(t.id)}>
                  <td className="mono">{t.no}{t.unread_customer && <span className="tag" style={{ marginInlineStart: 6 }}>1</span>}</td>
                  <td><button className="linklike" onClick={(e) => { e.stopPropagation(); show(t.id); }}>{t.subject}</button><div className="muted" style={{ fontSize: 12 }}><StatusBadge tone={TONE[t.status]} label={st(lang, `st.${t.status}`)} /> {st(lang, `cat.${t.category}`)}</div></td>
                  <td>{st(lang, `pri.${t.priority}`)}</td>
                  <td>{t.requester?.name}</td>
                  <td className="nowrap">{dateTimeUtc(t.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </div>
      {open && <NewTicket cfg={cfg} lang={lang} L={L} onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); load(); show(id); }} />}
    </>
  );
}
