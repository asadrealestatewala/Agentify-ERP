import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BarsChart, DonutChart } from '../components/Charts.jsx';
import DataTable, { ExportMenu, SearchBar, useTable } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import { FormModal } from '../components/ResourcePage.jsx';
import { Card, ConfirmDialog, DateRangeFilter, Empty, Field, Loading, Modal, PageHead, Select, Stat, StatusBadge, Tabs } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { date, money, todayPK } from '../format.js';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];
const TYPE_LABEL = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

export function AccountingDashboard() {
  const [range, setRange] = useState({ range: 'this_month' });
  const treasury = useFetch('/api/accounting/treasury', range);
  const income = useFetch('/api/accounting/income-statement', range);
  const dash = useFetch('/api/dashboard', range);
  const f = dash.data?.finance;
  return (
    <div>
      <PageHead title="Accounting" sub="All figures are derived from posted journals"><DateRangeFilter value={range} onChange={setRange} /></PageHead>
      {!treasury.data || !income.data ? <Loading /> : (
        <>
          <div className="grid g4">
            <Stat label="Cash & bank balance" value={money(treasury.data.total)} icon="bank" to="/accounting/treasury" />
            <Stat label="Income (period)" value={money(income.data.total_income)} tone="pos" />
            <Stat label="Expenses (period)" value={money(income.data.total_expense)} tone="neg" />
            <Stat label="Net profit / (loss)" value={money(income.data.net)} tone={income.data.net >= 0 ? 'pos' : 'neg'} />
            {f && <><Stat label="Receivable from customers" value={money(f.receivable)} to="/payments/receivables" /><Stat label="Vendor payables" value={money(f.vendor_payables)} to="/vendors/credit-book" /><Stat label="Commission payable" value={money(f.commission_payable)} to="/commissions" /><Stat label="Overdue installments" value={money(f.overdue_installments.v)} tone={f.overdue_installments.n ? 'neg' : ''} to="/payments/installments?status=overdue" /></>}
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <Card title="Cash, till & bank accounts" flush>
              <table className="t"><thead><tr><th>Account</th><th className="num">Receipts</th><th className="num">Paid out</th><th className="num">Balance</th></tr></thead>
                <tbody>{treasury.data.accounts.map((a) => <tr key={a.id}><td><Link to={`/accounting/statement?account=${a.id}`}>{a.name}</Link></td><td className="num mono pos">{money(a.receipts)}</td><td className="num mono neg">{money(a.expenses)}</td><td className="num mono">{money(a.balance)}</td></tr>)}</tbody></table>
            </Card>
            <Card title="Expenses by account"><DonutChart data={income.data.expense.map((e) => ({ name: e.name, value: e.balance }))} /></Card>
          </div>
          <div className="row wrap" style={{ marginTop: 14 }}>
            <Link className="btn" to="/receipts/new">New receipt</Link><Link className="btn" to="/expenses/new">New expense voucher</Link><Link className="btn" to="/accounting/treasury">Transfer funds</Link><Link className="btn" to="/accounting/journals">Journal entries</Link><Link className="btn" to="/reports/Financial">Financial reports</Link>
          </div>
        </>
      )}
    </div>
  );
}

export function ChartOfAccounts() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data, reload } = useFetch('/api/accounting/accounts');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const { hidden, remove } = useUndoDelete('accounts');
  const tree = useMemo(() => {
    if (!data) return [];
    const kids = {};
    data.forEach((a) => { (kids[a.parent_id || 0] ||= []).push(a); });
    const walk = (pid, depth) => (kids[pid] || []).flatMap((a) => [{ ...a, depth }, ...walk(a.id, depth + 1)]);
    return walk(0, 0);
  }, [data]);
  const rollup = (a) => (data || []).filter((x) => x.id === a.id || isDesc(a, x)).reduce((s, x) => s + (x.id === a.id ? 0 : (x.parent_id === a.id ? 0 : 0)), 0);
  const isDesc = (anc, x) => { let p = x; while (p?.parent_id) { if (p.parent_id === anc.id) return true; p = data.find((y) => y.id === p.parent_id); } return false; };
  const totalOf = (a) => data.filter((x) => (x.id === a.id || isDesc(a, x)) && !data.some((c) => c.parent_id === x.id)).reduce((s, x) => s + x.balance, 0);
  const parents = (data || []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, type: a.type }));
  return (
    <div>
      <PageHead title="Chart of accounts" sub="Balances are computed from journals — they can't be edited directly.">{can('accounting', 'create') && <button className="btn primary" onClick={() => setEdit({ type: 'asset' })}><Icon name="plus" size={14} />Add account</button>}</PageHead>
      <Card flush>
        {!data ? <Loading /> : TYPE_ORDER.map((type) => (
          <div key={type}>
            <table className="t"><tbody>
              {tree.filter((a) => a.type === type && !hidden.has(a.id)).map((a) => {
                const leaf = !data.some((c) => c.parent_id === a.id);
                return (
                  <tr key={a.id} style={{ background: a.depth === 0 ? '#f4f6fa' : undefined, fontWeight: a.depth === 0 ? 600 : 400 }}>
                    <td style={{ width: 80 }} className="mono muted">{a.code}</td>
                    <td style={{ paddingLeft: 12 + a.depth * 22 }}>{leaf ? <Link to={`/accounting/statement?account=${a.id}`}>{a.name}</Link> : a.name}{a.subtype && <span className="tag" style={{ marginLeft: 8 }}>{a.subtype}</span>}{!a.active && <span className="pill grey" style={{ marginLeft: 6 }}>inactive</span>}</td>
                    <td className="num mono" style={{ width: 160 }}>{money(leaf ? a.balance : totalOf(a))}</td>
                    <td className="right nowrap" style={{ width: 150 }}>{can('accounting', 'edit') && <button className="btn sm ghost" onClick={() => setEdit({ ...a, opening_balance: a.opening_now, canOpen: leaf })}>Edit</button>}{can('accounting', 'delete') && !a.protected && <button className="btn sm ghost danger" onClick={() => setDel(a)}>Delete</button>}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        ))}
      </Card>
      {edit && <FormModal title={edit.id ? 'Edit account' : 'Add account'} size="sm" initial={edit}
        fields={edit.id ? [{ name: 'name', label: 'Account name', required: true }, ...(edit.canOpen ? [{ name: 'opening_balance', label: 'Opening balance', type: 'money', hint: 'Changing it posts only the difference against Capital' }] : [])] : [{ name: 'code', label: 'Code', required: true, hint: 'e.g. 5170' }, { name: 'name', label: 'Name', required: true }, { name: 'type', label: 'Type', type: 'select', options: TYPE_ORDER.map((t) => ({ value: t, label: TYPE_LABEL[t] })), allowEmpty: false },
          { name: 'parent_id', label: 'Parent account', type: 'select', number: true, options: (f) => parents.filter((p) => p.type === f.type) }, { name: 'subtype', label: 'Subtype (treasury accounts)', type: 'select', options: ['', 'cash', 'bank', 'custody', 'online'] }, { name: 'opening_balance', label: 'Opening balance', type: 'money', hint: 'Posted against Capital' }]}
        onClose={() => setEdit(null)} onSave={async (f) => { if (edit.id) await api.put(`/api/accounting/accounts/${edit.id}`, { name: f.name, ...(edit.canOpen ? { opening_balance: f.opening_balance || 0 } : {}) }); else await api.post('/api/accounting/accounts', f); setEdit(null); reload(); toast('Saved', 'ok'); }} />}
      {del && <ConfirmDialog danger title="Delete account" message={`Delete ${del.code} ${del.name}?`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const acc = del; setDel(null); remove(acc.id, `${acc.code} ${acc.name} deleted`, () => api.del(`/api/accounting/accounts/${acc.id}`), { onDone: reload }); }} />}
    </div>
  );
}

export function Journals() {
  const { can } = useAuth();
  const toast = useToast();
  const [sp] = useSearchParams();
  const { accounts } = useLookups();
  const t = useTable('/api/accounting/journals', { filters: {} });
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [q0] = useState(sp.get('q') || '');
  useMemo(() => { if (q0) t.setQ(q0); /* eslint-disable-next-line */ }, []);
  return (
    <div>
      <PageHead title="Journal / transactions" sub="Every financial event, as balanced debit/credit entries">{can('accounting', 'approve') && <button className="btn" onClick={() => setAdding(true)}>Manual journal</button>}</PageHead>
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search journal no. or memo…" />
          <div style={{ width: 190 }}><Select value={t.extra.ref_type || ''} onChange={(v) => t.setFilter({ ref_type: v })} placeholder="All sources" options={['sale', 'receipt', 'expense', 'vendor_payment', 'commission', 'commission_payment', 'payroll', 'transfer', 'opening', 'manual']} /></div>
          <div style={{ width: 240 }}><Select value={t.extra.account_id || ''} onChange={(v) => t.setFilter({ account_id: v })} placeholder="Any account" options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} /></div></div>
        <DataTable {...t.tableProps} onRowClick={setOpen} columns={[
          { key: 'journal_no', label: 'Journal', render: (r) => <span className="cell-main mono">{r.journal_no}</span> }, { key: 'date', label: 'Date', render: (r) => date(r.date) }, { key: 'memo', label: 'Description' }, { key: 'project_name', label: 'Project' },
          { key: 'ref_type', label: 'Source', render: (r) => <span className="tag">{r.ref_type || 'manual'}</span> }, { key: 'user_name', label: 'By', hidden: true }, { key: 'amount', label: 'Amount', num: true, render: (r) => money(r.amount) }]} />
      </Card>
      {open && <JournalModal id={open.id} onClose={() => setOpen(null)} />}
      {adding && <ManualJournal accounts={accounts} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); t.reload(); toast('Journal posted', 'ok'); }} />}
    </div>
  );
}
function JournalModal({ id, onClose }) {
  const { data } = useFetch(`/api/accounting/journals/${id}`);
  return (
    <Modal title={data ? `${data.journal_no} — ${date(data.date)}` : 'Journal'} size="lg" onClose={onClose}>
      {!data ? <Loading /> : (<div className="stack"><div>{data.memo}</div>
        <table className="t"><thead><tr><th>Account</th><th>Linked to</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{data.lines.map((l) => <tr key={l.id}><td>{l.code} {l.account_name}</td><td className="muted">{l.contact_name || l.vendor_name || ''}</td><td className="num mono">{l.debit ? money(l.debit) : ''}</td><td className="num mono">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="num mono">{money(data.lines.reduce((s, l) => s + l.debit, 0))}</td><td className="num mono">{money(data.lines.reduce((s, l) => s + l.credit, 0))}</td></tr></tfoot></table></div>)}
    </Modal>
  );
}
function ManualJournal({ accounts, onClose, onSaved }) {
  const [memo, setMemo] = useState('');
  const [date_, setDate] = useState(todayPK());
  const [lines, setLines] = useState([{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }]);
  const [err, setErr] = useState('');
  const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const upd = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Modal title="Manual journal entry" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={d !== c || !d || !memo} onClick={async () => { try { await api.post('/api/accounting/journals', { memo, date: date_, lines }); onSaved(); } catch (e) { setErr(e.message); } }}>Post journal</button></>}>
      <div className="stack">{err && <div className="alert err">{err}</div>}<div className="alert warn">Manual journals are audited. Prefer vouchers, receipts and sales — they update sub-ledgers automatically.</div>
        <div className="form-grid"><Field label="Memo" required><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></Field><Field label="Date"><input className="input" type="date" value={date_} onChange={(e) => setDate(e.target.value)} /></Field></div>
        {lines.map((l, i) => <div key={i} className="row"><div className="grow"><Select value={l.account_id} onChange={(v) => upd(i, 'account_id', v)} options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} placeholder="Account…" /></div>
          <input className="input" style={{ width: 130 }} type="number" min="0" placeholder="Debit" value={l.debit} onChange={(e) => upd(i, 'debit', e.target.value)} /><input className="input" style={{ width: 130 }} type="number" min="0" placeholder="Credit" value={l.credit} onChange={(e) => upd(i, 'credit', e.target.value)} /></div>)}
        <div className="row between"><button className="btn sm" onClick={() => setLines([...lines, { account_id: '', debit: '', credit: '' }])}>Add line</button><span className={d === c ? 'pos' : 'neg'}>Debit {money(d)} · Credit {money(c)}{d !== c && ` · difference ${money(Math.abs(d - c))}`}</span></div></div>
    </Modal>
  );
}

/** General ledger / account statement. */
export function AccountStatement() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const { accounts } = useLookups();
  const [range, setRange] = useState({ range: 'this_year' });
  const account = sp.get('account') || '';
  const { data, loading } = useFetch(account ? `/api/accounting/ledger/${account}` : null, range);
  return (
    <div>
      <PageHead title="Account statement" sub="General ledger with running balance">
        <div style={{ width: 280 }}><Select value={account} onChange={(v) => setSp(v ? { account: v } : {})} options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} placeholder="Select an account…" /></div>
        <DateRangeFilter value={range} onChange={setRange} presets={[['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom range']]} />
        {data && <button className="btn" onClick={() => download(`/api/accounting/ledger/${account}`, { ...range, format: 'xlsx' }, `ledger-${data.account.code}.xlsx`).catch((e) => toast(e.message, 'err'))}><Icon name="download" size={14} />Excel</button>}
        {data && <button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>}
      </PageHead>
      {!account ? <Empty>Pick an account to see its ledger.</Empty> : !data ? <Loading /> : (
        <Card title={`${data.account.code} ${data.account.name}`} flush actions={<span className="muted">{date(data.from)} → {date(data.to)}</span>}>
          <table className="t" style={{ opacity: loading ? 0.6 : 1 }}><thead><tr><th>Date</th><th>Journal</th><th>Description</th><th>Linked to</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="muted">Opening balance</td><td className="num mono">{money(data.opening)}</td></tr>
              {data.rows.map((r) => <tr key={r.id}><td>{date(r.date)}</td><td><Link to={`/accounting/journals?q=${r.journal_no}`}>{r.journal_no}</Link></td><td>{r.jmemo}</td><td className="muted">{r.contact_name || r.vendor_name || r.project_name || ''}</td><td className="num mono">{r.debit ? money(r.debit) : ''}</td><td className="num mono">{r.credit ? money(r.credit) : ''}</td><td className="num mono">{money(r.balance)}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4}>Closing balance</td><td className="num mono">{money(data.rows.reduce((s, r) => s + r.debit, 0))}</td><td className="num mono">{money(data.rows.reduce((s, r) => s + r.credit, 0))}</td><td className="num mono">{money(data.closing)}</td></tr></tfoot></table>
        </Card>
      )}
    </div>
  );
}

export function IncomeStatement() {
  const [range, setRange] = useState({ range: 'this_month' });
  const [project, setProject] = useState('');
  const { projects } = useLookups();
  const { data } = useFetch('/api/accounting/income-statement', { ...range, project_id: project });
  return (
    <div>
      <PageHead title="Income statement" sub={data ? `${date(data.from)} → ${date(data.to)}` : ''}>
        <div style={{ width: 190 }}><Select value={project} onChange={setProject} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="All projects" /></div>
        <DateRangeFilter value={range} onChange={setRange} /><button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>
      </PageHead>
      {!data ? <Loading /> : (
        <Card flush>
          <table className="t"><tbody>
            <tr><td colSpan={2} className="bold" style={{ background: 'var(--surface-2)' }}>Income</td></tr>
            {data.income.map((a) => <tr key={a.id}><td style={{ paddingLeft: 28 }}>{a.code} {a.name}</td><td className="num mono">{money(a.balance)}</td></tr>)}
            <tr><td className="bold">Total income</td><td className="num mono bold">{money(data.total_income)}</td></tr>
            <tr><td colSpan={2} className="bold" style={{ background: 'var(--surface-2)' }}>Expenses</td></tr>
            {data.expense.map((a) => <tr key={a.id}><td style={{ paddingLeft: 28 }}>{a.code} {a.name}</td><td className="num mono">{money(a.balance)}</td></tr>)}
            <tr><td className="bold">Total expenses</td><td className="num mono bold">{money(data.total_expense)}</td></tr>
            <tr style={{ background: 'var(--surface-2)' }}><td className="bold" style={{ fontSize: 15 }}>Net profit / (loss)</td><td className={`num mono bold ${data.net >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 15 }}>{money(data.net)}</td></tr>
          </tbody></table>
        </Card>
      )}
    </div>
  );
}

export function Treasury({ banksOnly }) {
  const { can } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState({ range: 'this_month' });
  const { data, reload } = useFetch('/api/accounting/treasury', range);
  const recs = useFetch('/api/accounting/reconciliations');
  const { treasury } = useLookups();
  const [xfer, setXfer] = useState(null);
  const [rec, setRec] = useState(null);
  const accounts = (data?.accounts || []).filter((a) => !banksOnly || ['bank', 'online'].includes(a.subtype));
  return (
    <div>
      <PageHead title={banksOnly ? 'Bank accounts' : 'Cash, till & bank'} sub="Opening balance + receipts − payments ± transfers = closing balance"><DateRangeFilter value={range} onChange={setRange} />
        {can('accounting', 'create') && <button className="btn primary" onClick={() => setXfer({ date: todayPK() })}><Icon name="transfer" size={14} />Transfer / give cash</button>}</PageHead>
      {!data ? <Loading /> : (
        <>
          <div className="grid g4" style={{ marginBottom: 12 }}>{accounts.map((a) => <div key={a.id} className="card stat"><div className="row between"><span className="label">{a.name}</span><span className="tag">{a.subtype}</span></div><div className="value">{money(a.balance)}</div>{a.last_reconciliation && <div className="sub-v">Reconciled {date(a.last_reconciliation.date)}{a.last_reconciliation.difference ? ` · diff ${money(a.last_reconciliation.difference)}` : ' ✓'}</div>}</div>)}</div>
          <Card title="Movement for the period" flush>
            <table className="t"><thead><tr><th>Account</th><th className="num">Opening</th><th className="num">Receipts</th><th className="num">Expenses & payouts</th><th className="num">Transfers (net)</th><th className="num">Closing</th><th /></tr></thead>
              <tbody>{accounts.map((a) => <tr key={a.id}><td><Link to={`/accounting/statement?account=${a.id}`} className="cell-main">{a.name}</Link></td><td className="num mono">{money(a.opening)}</td><td className="num mono pos">{money(a.receipts)}</td><td className="num mono neg">{money(a.expenses)}</td><td className="num mono">{money(a.transfers, { sign: true })}</td><td className="num mono bold">{money(a.closing)}</td>
                <td className="right">{can('accounting', 'approve') && <button className="btn sm" onClick={() => setRec({ account_id: a.id, name: a.name, book: a.balance, date: todayPK() })}>Reconcile</button>}</td></tr>)}</tbody></table>
          </Card>
          {recs.data?.length > 0 && <div style={{ marginTop: 12 }}><Card title="Reconciliation history" flush><table className="t"><tbody>{recs.data.slice(0, 10).map((r) => <tr key={r.id}><td>{date(r.date)}</td><td>{r.account_name}</td><td className="num mono">{money(r.statement_balance)}</td><td className="num mono">{money(r.book_balance)}</td><td className={`num mono ${r.difference ? 'neg' : 'pos'}`}>{r.difference ? money(r.difference) : 'Matched'}</td><td className="muted">{r.notes}</td></tr>)}</tbody></table></Card></div>}
        </>
      )}
      {xfer && <FormModal title="Transfer between accounts" size="sm" initial={xfer} submitLabel="Transfer"
        fields={[{ name: 'from_account_id', label: 'From', type: 'select', number: true, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })) }, { name: 'to_account_id', label: 'To', type: 'select', number: true, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })), hint: 'e.g. Company Cash Till → Finance Manager Custody' },
          { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date' }, { name: 'memo', label: 'Memo' }]}
        onClose={() => setXfer(null)} onSave={async (f) => { await api.post('/api/accounting/transfers', f); toast('Transfer recorded', 'ok'); setXfer(null); reload(); }} />}
      {rec && <FormModal title={`Reconcile ${rec.name}`} size="sm" initial={rec} submitLabel="Record reconciliation"
        fields={[{ name: 'date', label: 'Statement date', type: 'date' }, { name: 'statement_balance', label: 'Statement / counted balance', type: 'money', required: true, hint: `System balance today: ${money(rec.book)}` }, { name: 'notes', label: 'Notes', type: 'textarea' }]}
        onClose={() => setRec(null)} onSave={async (f) => { const r = await api.post('/api/accounting/reconciliations', f); toast(r.difference ? `Difference of ${money(r.difference)} recorded` : 'Reconciled — balances match', r.difference ? 'err' : 'ok'); setRec(null); reload(); recs.reload(); }} />}
    </div>
  );
}

export function BalanceSheet() {
  const toast = useToast();
  const [asOf, setAsOf] = useState(todayPK());
  const { data, loading } = useFetch('/api/accounting/balance-sheet', { to: asOf });
  const dl = async (format) => { try { await download('/api/accounting/balance-sheet', { to: asOf, format }, `balance-sheet.${format}`); } catch (e) { toast(e.message, 'err'); } };
  const side = (title, rows, total, extra) => (
    <Card title={title} flush>
      <table className="t"><tbody>
        {rows.map((a) => <tr key={a.id}><td className="mono muted" style={{ width: 70 }}>{a.code}</td><td>{a.name}</td><td className="num mono">{money(a.balance)}</td></tr>)}
        {extra}
        {!rows.length && !extra && <tr><td colSpan={3} className="muted">Nothing to show</td></tr>}
      </tbody><tfoot><tr><td colSpan={2}>Total {title.toLowerCase()}</td><td className="num mono">{money(total)}</td></tr></tfoot></table>
    </Card>
  );
  return (
    <div>
      <PageHead title="Balance sheet" sub="Assets = liabilities + equity (including current profit) — built from posted journals only">
        <label className="row"><span className="muted">As of</span><input className="input" type="date" style={{ width: 150 }} value={asOf} max={todayPK()} onChange={(e) => setAsOf(e.target.value)} /></label>
        <button className="btn primary" onClick={() => dl('pdf')}><Icon name="download" size={14} />PDF</button><button className="btn" onClick={() => dl('xlsx')}>Excel</button><button className="btn" onClick={() => window.print()}><Icon name="print" size={14} />Print</button>
      </PageHead>
      {!data ? <Loading /> : (
        <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className={`alert ${data.balanced ? 'ok' : 'err'}`}>{data.balanced ? `The books balance as of ${date(data.as_of)}: ${money(data.total_assets)} assets = ${money(data.total_liabilities)} liabilities + ${money(data.total_equity + data.current_profit)} equity.` : 'The books do NOT balance — review recent journals.'}</div>
          <div className="grid g2" style={{ alignItems: 'start' }}>
            {side('Assets', data.assets, data.total_assets)}
            <div className="stack">
              {side('Liabilities', data.liabilities, data.total_liabilities)}
              {side('Equity', data.equity, data.total_equity + data.current_profit, <tr><td className="mono muted" /><td>Current profit / (loss)</td><td className={`num mono ${data.current_profit < 0 ? 'neg' : 'pos'}`}>{money(data.current_profit)}</td></tr>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
