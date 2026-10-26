import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Stat, Tabs, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date } from '../format.js';

const CATS = ['General', 'Projects', 'Pricing & plans', 'Buying process', 'Construction', 'Company', 'FAQ'];

function EntryModal({ entry, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', category: 'General', content: '', keywords: '', link: '', active: true, ...entry });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { f.id ? await api.put(`/api/site-admin/bot/kb/${f.id}`, f) : await api.post('/api/site-admin/bot/kb', f); toast('Saved — the assistant uses it immediately', 'ok'); onSaved(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={f.id ? 'Edit knowledge' : 'Add knowledge'} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack">
        <Field label="Question or topic" required><input className="input" autoFocus value={f.title} onChange={set('title')} placeholder="e.g. What documents do I need to buy a plot?" /></Field>
        <Field label="Answer the assistant should give" required hint={`${f.content.length} / 2000 characters`}><textarea className="textarea" rows={5} value={f.content} onChange={set('content')} /></Field>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <Field label="Category"><select className="input" value={f.category} onChange={set('category')}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Link shown with the answer" hint="Optional: /site/project/1 or https://…"><input className="input" value={f.link} onChange={set('link')} placeholder="/site/p/contact" /></Field>
        </div>
        <Field label="Extra words people might use" hint="Optional, comma separated: synonyms and spellings (e.g. cnic, papers, registry)"><input className="input" value={f.keywords} onChange={set('keywords')} /></Field>
        <div className="row between"><span>Active</span><Toggle value={!!f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
    </Modal>
  );
}

/** Website Manager: teach the website assistant, review what visitors asked, try it out. */
export default function BotKnowledge() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('kb');
  const kb = useFetch('/api/site-admin/bot/kb');
  const auto = useFetch('/api/site-admin/bot/knowledge');
  const chats = useFetch('/api/site-admin/bot/chats');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [q, setQ] = useState('');
  const [test, setTest] = useState({ busy: false, out: null });
  const canEdit = can('website', 'edit'), canCreate = can('website', 'create');
  if (kb.loading && !kb.data) return <Loading />;
  const stats = chats.data?.stats || {};
  const unanswered = (chats.data?.rows || []).filter((r) => !r.matched);
  const run = async (m) => { if (!m.trim()) return; setTest({ busy: true, out: null }); try { setTest({ busy: false, out: await api.post('/api/site-admin/bot/test', { message: m }) }); } catch (e) { toast(e.message, 'err'); setTest({ busy: false, out: null }); } };
  const refresh = () => { kb.reload(); auto.reload(); chats.reload(); };

  return (
    <div className="stack">
      <PageHead title="Website assistant" sub="Teach the chatbot on your landing page. It already learns from your pages, projects and listings; add anything else here.">
        {canCreate && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={14} />Add knowledge</button>}
      </PageHead>
      <div className="grid cols-4">
        <Stat label="Written answers" value={(kb.data || []).filter((k) => k.active).length} icon="file" />
        <Stat label="Learned from the website" value={auto.data?.total ?? '…'} icon="globe" />
        <Stat label="Conversations" value={stats.sessions ?? 0} sub={`${stats.total ?? 0} messages`} icon="users" />
        <Stat label="Unanswered questions" value={stats.unanswered ?? 0} tone={stats.unanswered ? 'amber' : 'green'} sub={`${stats.leads ?? 0} leads captured`} icon="bolt" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'kb', label: 'Knowledge bank', count: (kb.data || []).length }, { key: 'unanswered', label: 'Unanswered', count: unanswered.length }, { key: 'chats', label: 'Conversations' }, { key: 'auto', label: 'Learned automatically' }, { key: 'test', label: 'Try it' }]} />

      {tab === 'kb' && (
        <Card flush>
          {!(kb.data || []).length ? <Empty icon="file" title="No written answers yet" hint="Add the questions customers ask most: documents needed, payment plans, possession dates, site visits…" /> : (
            <table className="t"><thead><tr><th>Question / topic</th><th>Category</th><th>Answer</th><th>Status</th><th /></tr></thead>
              <tbody>{kb.data.map((k) => (
                <tr key={k.id}><td className="cell-main">{k.title}</td><td>{k.category}</td><td className="muted" style={{ maxWidth: 380 }}>{k.content.slice(0, 120)}{k.content.length > 120 ? '…' : ''}</td>
                  <td><span className={`pill ${k.active ? 'green' : 'grey'}`}>{k.active ? 'Active' : 'Off'}</span></td>
                  <td className="nowrap">{canEdit && <button className="btn sm" onClick={() => setEdit(k)}>Edit</button>} {can('website', 'delete') && <button className="btn sm ghost danger" onClick={() => setDel(k)}>Delete</button>}</td></tr>))}</tbody></table>
          )}
        </Card>
      )}

      {tab === 'unanswered' && (
        <Card title="Questions the assistant could not answer">
          {!unanswered.length ? <Empty icon="check" title="Nothing unanswered" hint="Questions visitors ask that the assistant could not answer will appear here." /> : unanswered.map((r) => (
            <div key={r.id} className="row between wrap" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div><b>“{r.message}”</b><div className="cell-sub">{date(r.created_at)}{r.contact_name ? ` · left details as ${r.contact_name}` : ''}</div></div>
              <div className="row" style={{ gap: 6 }}>
                {canCreate && <button className="btn sm primary" onClick={() => setEdit({ title: r.message, content: '', _resolve: r.id })}>Add answer</button>}
                {can('website', 'delete') && <button className="btn sm ghost" onClick={async () => { await api.del(`/api/site-admin/bot/chats/${r.id}`); chats.reload(); }}>Dismiss</button>}
              </div>
            </div>))}
        </Card>
      )}

      {tab === 'chats' && (
        <Card title="Recent conversations" flush>
          {!(chats.data?.rows || []).length ? <Empty icon="users" title="No conversations yet" /> : (
            <table className="t"><thead><tr><th>When</th><th>Visitor asked</th><th>Assistant said</th><th /></tr></thead>
              <tbody>{chats.data.rows.map((r) => <tr key={r.id}><td className="nowrap muted">{date(r.created_at)}</td><td>{r.message}</td><td className="muted" style={{ maxWidth: 420 }}>{(r.answer || '').slice(0, 130)}{(r.answer || '').length > 130 ? '…' : ''}</td><td>{r.matched ? <span className="pill green">Answered</span> : <span className="pill amber">Missed</span>}{r.contact_id ? <> <a className="pill blue" href={`/contacts/${r.contact_id}`}>Lead</a></> : null}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}

      {tab === 'auto' && (
        <Card title="What the assistant learns from the website by itself">
          <p className="muted">These come straight from the website and system, so they stay current without any work: change a page, add a listing or approve a project and the assistant knows.</p>
          {(auto.data?.sources || []).map((s) => <div key={s.source} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}><b>{s.source}</b> <span className="pill grey">{s.count}</span><div className="cell-sub">{s.sample.join(' · ')}{s.count > s.sample.length ? ' …' : ''}</div></div>)}
        </Card>
      )}

      {tab === 'test' && (
        <Card title="Try the assistant">
          <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(q); }}><input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask something a customer would ask…" /><button className="btn primary" disabled={test.busy}>Ask</button></form>
          {test.out && <div className="stack" style={{ marginTop: 14 }}>
            <div className="card" style={{ padding: 12 }}><b>Answer</b><p style={{ margin: '6px 0 0' }}>{test.out.answer}</p></div>
            <div className="row wrap" style={{ gap: 8 }}><span className={`pill ${test.out.matched ? 'green' : 'amber'}`}>{test.out.matched ? 'Answered' : 'Not answered'}</span><span className="pill grey">Source: {test.out.source || '—'}</span>{test.out.action === 'lead' && <span className="pill blue">Offers the lead form</span>}</div>
            {test.out.cards?.map((c) => <div key={c.href} className="cell-sub">▸ {c.title} — {c.subtitle}</div>)}
          </div>}
        </Card>
      )}

      {edit && <EntryModal entry={edit} onClose={() => setEdit(null)} onSaved={async () => { if (edit._resolve) await api.del(`/api/site-admin/bot/chats/${edit._resolve}`).catch(() => {}); setEdit(null); refresh(); }} />}
      {del && <ConfirmDialog title="Delete this knowledge entry?" message={`“${del.title}” will no longer be used by the assistant.`} danger confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { try { await api.del(`/api/site-admin/bot/kb/${del.id}`); toast('Deleted', 'ok'); setDel(null); refresh(); } catch (e) { toast(e.message, 'err'); } }} />}
    </div>
  );
}
