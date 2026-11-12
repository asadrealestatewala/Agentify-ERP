import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { WA, WhatsAppButton, useCompanyName } from '../components/WhatsApp.jsx';
import { Avatar, BackLink, Card, Empty, Loading, PageHead, ProgressBar, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth, useFetch } from '../context.jsx';
import { date, dateTime, money, getRegion } from '../format.js';

const ICON = { receipt: 'receipt', sale: 'badge', note: 'note', activity: 'history', document: 'file', task: 'check', overdue: 'bolt', installment: 'calendar' };
const FILTERS = [['all', 'Everything'], ['money', 'Payments'], ['notes', 'Notes & activity'], ['docs', 'Documents & tasks']];
const GROUP = { all: null, money: ['receipt', 'sale', 'overdue', 'installment'], notes: ['note', 'activity'], docs: ['document', 'task'] };

/** One page per customer: who they are, what they owe, everything that happened, and the one thing to do next. */
export default function Customer360() {
  const { id } = useParams();
  const { can } = useAuth();
  const co = useCompanyName();
  const { data, error } = useFetch(`/api/insights/customer/${id}`);
  const [filter, setFilter] = useState('all');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const { contact: c, kpis: k, nba, sales, events } = data;
  const first = (c.full_name || '').split(' ')[0] || c.full_name;
  const msgCtx = { name: first, amount: nba.amount, due_date: nba.due_date, days: nba.days, sale_no: nba.sale_no };
  const shown = events.filter((e) => !GROUP[filter] || GROUP[filter].includes(e.type));
  const pct = k.net ? Math.round((k.paid / k.net) * 100) : 0;
  const pay = can('payments', 'create') ? `/receipts/new?contact=${c.id}${nba.sale_id ? `&sale=${nba.sale_id}` : ''}` : null;
  return (
    <div>
      <BackLink to="/customers">Customers</BackLink>
      <PageHead title={<span>{c.full_name} {c.customer_code && <span className="tag" style={{ verticalAlign: 'middle' }}>{c.customer_code}</span>}</span>} sub={[c.city, c.agent_name && `Agent: ${c.agent_name}`, c.customer_since && `Customer since ${date(c.customer_since)}`].filter(Boolean).join(' · ')}>
        <Link className="btn" to={`/contacts/${c.id}`}>CRM workspace</Link>
        {can('customers', 'view') && <Link className="btn" to={`/customers/${c.id}/statement`}>Statement</Link>}
        {pay && <Link className="btn primary" to={pay}>Receive payment</Link>}
      </PageHead>

      <div className={`nba ${nba.tone}`}>
        <Icon name={nba.tone === 'ok' ? 'check' : nba.tone === 'bad' ? 'bolt' : 'flag'} size={20} />
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="bold">Next best action</div>
          <div>{nba.title}</div>
          {nba.detail && <div className="muted" style={{ fontSize: 12.5 }}>{nba.detail}</div>}
        </div>
        <div className="row wrap">
          {nba.kind === 'overdue' && <><WhatsAppButton className="btn sm success" phone={c.whatsapp || c.phone} text={WA.overdue(msgCtx, co)} label=" Send WhatsApp reminder" />{pay && <Link className="btn sm primary" to={pay}>Record payment</Link>}</>}
          {nba.kind === 'due' && <><WhatsAppButton className="btn sm success" phone={c.whatsapp || c.phone} text={WA.due(msgCtx, co)} label=" Remind on WhatsApp" />{pay && <Link className="btn sm" to={pay}>Record payment</Link>}</>}
          {nba.kind === 'reach' && <><WhatsAppButton className="btn sm success" phone={c.whatsapp || c.phone} text={WA.hello(msgCtx, co)} label=" Say hello" />{c.phone && <a className="btn sm" href={`tel:${c.phone}`}>Call</a>}</>}
          {nba.kind === 'docs' && <Link className="btn sm primary" to={`/contacts/${c.id}`}>Add documents</Link>}
          {nba.kind === 'file' && nba.sale_id && <Link className="btn sm primary" to={`/sales/${nba.sale_id}`}>Open file</Link>}
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Purchase value" value={money(k.net)} sub={`${k.files} file${k.files === 1 ? '' : 's'}`} icon="badge" />
        <Stat label="Paid" value={money(k.paid)} sub={`${pct}% of value`} tone="pos" icon="wallet" />
        <Stat label="Outstanding" value={money(k.outstanding)} icon="dollar" />
        <Stat label="Overdue" value={money(k.overdue)} sub={k.overdue_count ? `${k.overdue_count} installment(s)` : k.next_due ? `Next ${money(k.next_due.amount)} on ${date(k.next_due.due_date)}` : 'Nothing overdue'} tone={k.overdue ? 'neg' : ''} />
      </div>
      {k.net > 0 && <div style={{ marginBottom: 14 }}><ProgressBar value={pct} tone="green" /></div>}

      <div className="c360">
        <div className="stack">
          <Card title="Contact">
            <div className="row" style={{ marginBottom: 10 }}><Avatar name={c.full_name} size="lg" /><div><b>{c.full_name}</b><div className="muted">{c.is_customer ? 'Customer' : 'Lead'}</div></div></div>
            <dl style={{ margin: 0 }}>
              {[['Phone', c.phone && <span className="row" style={{ gap: 6 }}>{c.phone}<a className="qa" href={`tel:${c.phone}`} aria-label="Call"><Icon name="phone" size={13} /></a><WhatsAppButton phone={c.whatsapp || c.phone} text={WA.hello(msgCtx, co)} size={13} /></span>],
                ['Email', c.email], [getRegion().idLabel, c.cnic], ['Address', [c.address, c.city].filter(Boolean).join(', ')], ['Portal', data.portal ? (data.portal.last_login ? `Last login ${dateTime(data.portal.last_login)}` : 'Account created — never signed in') : 'No portal account']]
                .filter(([, v]) => v).map(([kk, v]) => <div className="kv" key={kk}><dt>{kk}</dt><dd>{v}</dd></div>)}
            </dl>
          </Card>
          <Card title="Files" flush>
            {!sales.length ? <Empty>No sales yet.</Empty> : sales.map((s) => (
              <Link key={s.id} to={`/sales/${s.id}`} className="today-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.property_title || (s.kind === 'construction' ? 'Construction contract' : s.sale_no)}</div>
                  <div className="sub">{[s.sale_no, s.project_name, s.registration_no].filter(Boolean).join(' · ')}</div>
                </div>
                <div style={{ textAlign: 'right' }}><div className="mono">{money(s.net_price)}</div>{s.status !== 'confirmed' ? <StatusBadge status={s.status} /> : s.file_status && s.file_status !== 'Active' ? <span className="pill red">{s.file_status}</span> : null}</div>
              </Link>
            ))}
          </Card>
        </div>

        <Card title="Timeline" actions={<div className="seg3" role="group" aria-label="Filter timeline">{FILTERS.map(([v, l]) => <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>)}</div>}>
          {!shown.length ? <Empty icon="history" title="Nothing here yet" hint="Payments, notes, documents and tasks will appear as they happen." /> : (
            <div className="tl360">
              {shown.map((e, i) => (
                <div key={i} className={`tl360-item ${e.future ? 'future' : ''}`}>
                  <span className={`tl360-dot ${e.type}`}><Icon name={ICON[e.type] || 'file'} size={11} /></span>
                  <div>{e.link ? <Link to={e.link}>{e.title}</Link> : e.title}</div>
                  <div className="when">{e.future ? 'Upcoming · ' : ''}{date(e.at)}{e.sub ? ` · ${e.sub}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
