import { all, get, run, tx, nextNo, val, currentDb } from '../db.js';
import { now, today, bad, int, moneyText } from '../util.js';

/** code -> account id, cached per tenant database (account ids differ between tenants). */
const codeCaches = new WeakMap();
/** Resolve a chart-of-accounts code to id. */
export function acct(code) {
  const conn = currentDb();
  if (!codeCaches.has(conn)) codeCaches.set(conn, new Map());
  const codeCache = codeCaches.get(conn);
  if (codeCache.has(code)) return codeCache.get(code);
  const id = val('SELECT id FROM accounts WHERE code=?', code);
  if (!id) throw bad(`Account ${code} is missing from the chart of accounts`);
  codeCache.set(code, id);
  return id;
}

export const isDebitNature = (type) => type === 'asset' || type === 'expense';

/**
 * The single posting engine. Every financial change goes through here as a balanced journal.
 * lines: [{account: id|code, debit, credit, projectId, contactId, vendorId, saleId, memo}]
 */
export function postJournal({ date, memo, refType, refId, projectId, userId, lines, reversalOf }) {
  const clean = lines
    .map((l) => ({ ...l, debit: int(l.debit), credit: int(l.credit) }))
    .filter((l) => l.debit || l.credit);
  if (clean.length < 2) throw bad('A journal needs at least two lines');
  let d = 0, c = 0;
  for (const l of clean) {
    if (l.debit < 0 || l.credit < 0) throw bad('Journal amounts cannot be negative');
    if (l.debit && l.credit) throw bad('A journal line cannot have both debit and credit');
    d += l.debit; c += l.credit;
  }
  if (d !== c) throw bad(`Journal is not balanced (debit ${d} ≠ credit ${c})`);
  return tx(() => {
    const no = nextNo('JV', 'JV', 6);
    const r = run('INSERT INTO journals(journal_no,date,memo,ref_type,ref_id,project_id,reversal_of,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      no, date || today(), memo ?? null, refType ?? null, refId ?? null, projectId ?? null, reversalOf ?? null, userId ?? null, now());
    const jid = Number(r.lastInsertRowid);
    for (const l of clean) {
      const accountId = typeof l.account === 'string' ? acct(l.account) : l.account;
      run(`INSERT INTO journal_lines(journal_id,account_id,debit,credit,project_id,contact_id,vendor_id,sale_id,memo) VALUES(?,?,?,?,?,?,?,?,?)`,
        jid, accountId, l.debit, l.credit, l.projectId ?? projectId ?? null, l.contactId ?? null, l.vendorId ?? null, l.saleId ?? null, l.memo ?? null);
    }
    return jid;
  });
}

export function reverseJournal(journalId, memo, userId) {
  const j = get('SELECT * FROM journals WHERE id=?', journalId);
  if (!j) throw bad('Journal not found');
  if (get('SELECT id FROM journals WHERE reversal_of=?', journalId)) throw bad('Journal already reversed');
  const lines = all('SELECT * FROM journal_lines WHERE journal_id=?', journalId);
  return postJournal({
    date: today(), memo: memo || `Reversal of ${j.journal_no}`, refType: j.ref_type, refId: j.ref_id,
    projectId: j.project_id, userId, reversalOf: journalId,
    lines: lines.map((l) => ({ account: l.account_id, debit: l.credit, credit: l.debit, projectId: l.project_id,
      contactId: l.contact_id, vendorId: l.vendor_id, saleId: l.sale_id, memo: l.memo })),
  });
}

/** Balance of an account in its natural sign (opening + movements) up to `to` inclusive. */
export function accountBalance(accountId, { to, from } = {}) {
  const a = get('SELECT type,opening_balance FROM accounts WHERE id=?', accountId);
  if (!a) throw bad('Account not found');
  const row = get(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l
    JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.date<=? AND j.date>=?`, accountId, to || '2999-12-31', from || '1900-01-01');
  const mv = isDebitNature(a.type) ? row.d - row.c : row.c - row.d;
  return (from ? 0 : a.opening_balance) + mv;
}

/** All accounts with balances (natural sign) for a period. Opening balances are posted as journals, so no separate add-in. */
export function trialBalance({ from, to, projectId } = {}) {
  const accounts = all('SELECT * FROM accounts ORDER BY code');
  const rows = all(`SELECT l.account_id, SUM(l.debit) d, SUM(l.credit) c FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE j.date>=? AND j.date<=? ${projectId ? 'AND l.project_id=?' : ''} GROUP BY l.account_id`,
  from || '1900-01-01', to || '2999-12-31', ...(projectId ? [projectId] : []));
  const m = new Map(rows.map((r) => [r.account_id, r]));
  return accounts.map((a) => {
    const r = m.get(a.id) || { d: 0, c: 0 };
    return { ...a, debit: r.d, credit: r.c, balance: isDebitNature(a.type) ? r.d - r.c : r.c - r.d };
  });
}

export function treasuryAccounts() {
  return all(`SELECT * FROM accounts WHERE subtype IN ('cash','bank','custody','online') AND active=1 ORDER BY code`);
}

export function assertTreasury(accountId) {
  const a = get('SELECT * FROM accounts WHERE id=?', accountId);
  if (!a || !['cash', 'bank', 'custody', 'online'].includes(a.subtype)) throw bad('Select a valid cash/bank/till account');
  return a;
}

/** Cash and custody accounts must not go below zero. */
export function assertFunds(accountId, amount) {
  const a = assertTreasury(accountId);
  if (a.subtype === 'bank' || a.subtype === 'online') return;
  const bal = accountBalance(accountId);
  if (bal < amount) throw bad(`Insufficient funds in ${a.name} (balance ${moneyText(bal)}, needed ${moneyText(amount)})`);
}

/** Post an account's opening balance against Capital. */
export function postOpening(accountId, amount, userId) {
  if (!amount) return null;
  const a = get('SELECT * FROM accounts WHERE id=?', accountId);
  const asset = isDebitNature(a.type);
  return postJournal({
    memo: `Opening balance — ${a.name}`, refType: 'opening', refId: accountId, userId,
    lines: asset
      ? [{ account: accountId, debit: amount }, { account: '3100', credit: amount }]
      : [{ account: '3100', debit: amount }, { account: accountId, credit: amount }],
  });
}

/** Accounts the posting engine looks up by code (receipts, expenses, payroll...). They can be renamed but not removed or deactivated. */
export const CORE_CODES = ['1110', '1120', '1130', '1210', '1220', '1300', '1350', '2100', '2200', '2300', '2610', '3100', '4000', '4150', '4500', '5000', '5100', '5110', '5140', '5150', '5160', '5200', '5300', '5700', '5800'];

/** Current opening balance (natural sign) = net of all "opening" journals for the account. */
export function currentOpening(accountId) {
  const a = get('SELECT type FROM accounts WHERE id=?', accountId);
  const r = get(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE j.ref_type='opening' AND j.ref_id=? AND l.account_id=?`, accountId, accountId);
  return isDebitNature(a.type) ? r.d - r.c : r.c - r.d;
}

/** Change an opening balance by posting only the difference, so history stays journal-based. */
export function setOpening(accountId, amount, userId) {
  const a = get('SELECT * FROM accounts WHERE id=?', accountId);
  const target = int(amount);
  if (target < 0) throw bad('Opening balance cannot be negative');
  const delta = target - currentOpening(accountId);
  if (!delta) return null;
  const debitNature = isDebitNature(a.type);
  const up = delta > 0, n = Math.abs(delta);
  const accountDebit = debitNature ? up : !up;
  const first = get(`SELECT MIN(date) d FROM journals WHERE ref_type='opening' AND ref_id=?`, accountId)?.d
    || get('SELECT MIN(date) d FROM journals')?.d;
  return postJournal({
    date: first || undefined, memo: `Opening balance changed — ${a.name}`, refType: 'opening', refId: accountId, userId,
    lines: accountDebit
      ? [{ account: accountId, debit: n }, { account: '3100', credit: n }]
      : [{ account: '3100', debit: n }, { account: accountId, credit: n }],
  });
}
