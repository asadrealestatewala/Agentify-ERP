import { all, get, getSetting } from '../db.js';
import { hasPerm } from '../rbac.js';
import { today, addDays, dateRange, moneyText } from '../util.js';
import { trialBalance, treasuryAccounts, accountBalance } from './accounting.js';
import { projectFinancials } from './projectFinance.js';
import { scheduleFor, progressSql } from './schedule.js';
import { teamView, leaderboard, overview, salesAgents } from './goals.js';
import { searchKnowledge, searchDocs } from '../../../shared/guides.js';
import { systemDocs } from './systemKnowledge.js';
import { ensureLibrary, visible as visibleVideos } from '../routes/training.js';

const money = (n) => `${moneyText(Math.round(Number(n) || 0))}`;
const C = (key, label, type) => ({ key, label, type });
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const STOP = new Set(['expert', 'project', 'projects', 'the', 'and', 'for', 'how', 'much', 'many', 'what', 'which', 'was', 'were', 'did', 'does', 'have', 'has', 'with', 'from', 'this', 'that', 'about', 'show', 'give', 'tell', 'list', 'all', 'are', 'any', 'our', 'their', 'month', 'year', 'week']);

/** "this month", "last week", "in march 2026", "last 30 days" … → {from,to,label} */
function period(q) {
  const t = today();
  const presets = [['today', 'today', 'today'], ['yesterday', 'yesterday', 'yesterday'], ['this week', 'this_week', 'this week'], ['last week', null, 'last week'], ['this month', 'this_month', 'this month'], ['last month', 'last_month', 'last month'],
    ['this quarter', 'this_quarter', 'this quarter'], ['this year', 'this_year', 'this year'], ['last year', null, 'last year']];
  for (const [kw, preset, label] of presets) {
    if (q.includes(kw)) {
      if (preset) return { ...dateRange(preset), label };
      if (kw === 'last week') { const w = dateRange('this_week'); return { from: addDays(w.from, -7), to: addDays(w.from, -1), label }; }
      if (kw === 'last year') { const y = Number(t.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
    }
  }
  const m = /last (\d+) days?/.exec(q);
  if (m) return { from: addDays(t, -Number(m[1])), to: t, label: `the last ${m[1]} days` };
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(q)) {
      const y = (/\b(20\d\d)\b/.exec(q) || [])[1] || t.slice(0, 4);
      const last = new Date(Date.UTC(Number(y), i + 1, 0)).getUTCDate();
      return { from: `${y}-${String(i + 1).padStart(2, '0')}-01`, to: `${y}-${String(i + 1).padStart(2, '0')}-${last}`, label: `${MONTHS[i][0].toUpperCase()}${MONTHS[i].slice(1)} ${y}` };
    }
  }
  const y = /\b(20\d\d)\b/.exec(q);
  if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31`, label: y[1] };
  return null;
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
function matchBy(q, rows, nameOf) {
  const qs = ` ${q.replace(/[^a-z0-9 ]/g, ' ')} `;
  let best = null, score = 0;
  for (const r of rows) {
    const name = nameOf(r).toLowerCase();
    let s = qs.includes(` ${name} `) ? 10 : 0;
    for (const w of words(name)) if (qs.includes(` ${w} `)) s += 2 + (w.length > 5 ? 1 : 0);
    if (s > score) { score = s; best = r; }
  }
  return score >= 2 ? best : null;
}

const inL = (l) => (/^(this|last|today|yesterday|the )/.test(l) ? l : `in ${l}`);
const has = (q, ...ks) => ks.some((k) => (k instanceof RegExp ? k.test(q) : q.includes(k)));
const deny = (what) => ({ intent: 'denied', answer: `Your role doesn't have access to ${what}. Ask an administrator if you need it.`, tables: [], suggestions: ['How many leads do we have?', 'Show my goal progress'] });
const inRange = (col, p) => (p ? { sql: ` AND ${col} BETWEEN ? AND ?`, params: [p.from, p.to] } : { sql: '', params: [] });

const INTENTS = [];
const intent = (name, test, run) => INTENTS.push({ name, test, run });

// ---------------------------------------------------------------- help
intent('help', (q) => has(q, 'help', 'what can you', 'what do you know', 'capabilities'), () => ({
  answer: 'I answer from your live ERP data. Try asking:\n• **How many leads did we get this month?**\n• **How many projects are going on?**\n• **How much budget is utilised at each project?**\n• **How many leaves did Sana take and how much salary was paid?**\n• **Sales this month by agent**, **receivables and overdue**, **cash and bank balances**, **balance sheet**, **expenses by project**, **vendor payables**, **property inventory**, **top agents**.\nAdd “pdf” or “report” (or press the PDF button) and I’ll give you a downloadable document.',
  tables: [], suggestions: ['How many leads this month?', 'How many projects are going on?', 'Budget utilised by project', 'Balance sheet'],
}));

// ---------------------------------------------------------------- product help: "how do I...", "what's new", from guides + release notes
const HOWTO = /^ ?(how (do|can|to|does|are|is)|where (is|do|can)|what (is|are|can|do|does|happens|options)|what'?s (the|new)|which|can (i|a|an)|explain|tell me about|describe|open|go to|find|show me the (page|screen|menu)|what'?s new|what changed|what is the|explain|guide|tutorial|video|steps? (to|for)|why (is|can|cant|can't|do))/;
/** Videos the asker may watch that are posted to YouTube (links saved in the console), best match for the topic first. */
function videoLinks(user, topic, limit = 2) {
  let rows = [];
  try { ensureLibrary(); rows = visibleVideos(user).filter((v) => v.youtube_url); } catch { return []; }
  if (!rows.length) return [];
  const docs = rows.map((v) => ({ id: String(v.id), title: v.title, keywords: v.category || '', text: v.description || '', v }));
  return searchDocs(topic, docs, limit).filter((x) => x.coverage >= 0.5).map((x) => ({ label: `Watch: ${x.doc.v.title}`, url: x.doc.v.youtube_url, external: true }));
}

// Unified ranking: every source reports how much of the question it covers (0..1); small bonuses prefer exact guides and workflows.
function bestHelp(q) {
  const where = /^ ?(where|what is|what'?s|open|go to|find)\b/.test(q), process = /^ ?(how (does|do|are|is|can)|explain|tell me about|describe)\b/.test(q), roleQ = /\b(roles?|permissions?|access|allowed|who can|what can|can (see|do|view|edit|approve))\b/.test(q);
  const cands = [];
  for (const h of searchKnowledge(q).slice(0, 6)) cands.push({ kind: h.type, rank: (h.coverage ?? 0.5) + (h.type === 'guide' ? 0.25 : 0) + (h.named && where ? 0.4 : 0) + (h.type === 'release' ? -0.1 : 0), h });
  for (const x of searchDocs(q, systemDocs(), 4)) {
    const d = x.doc, roleDoc = d.source === 'Roles' || d.source === 'Permissions';
    cands.push({ kind: 'system', rank: x.coverage + (d.workflow && process ? 0.2 : 0) + (roleDoc ? (roleQ ? 0.35 : -0.6) : 0), h: x });
  }
  return cands.filter((c) => c.rank >= 0.55).sort((a, b) => b.rank - a.rank);
}
intent('howto', (q) => HOWTO.test(q) && !has(q, 'how many', 'how much') && !period(q) && bestHelp(q).length > 0, (q, ctx) => {
  const ranked = bestHelp(q), first = ranked[0];
  if (first.kind === 'system') {
    const d = first.h.doc, others = ranked.filter((c) => c !== first).slice(0, 3).map((c) => (c.kind === 'system' ? c.h.doc.title : c.kind === 'guide' ? c.h.guide.title : c.kind === 'screen' ? c.h.screen.label : c.h.title));
    return { answer: `**${d.title}**\n${d.text}`, tables: [], links: videoLinks(ctx.user, `${q} ${d.title}`), suggestions: others.length ? others : ["What's new?"] };
  }
  const hits = [first.h, ...ranked.filter((c) => c !== first && c.kind !== 'system').map((c) => c.h)];
  const top = hits[0];
  const links = [];
  const videoLink = (key) => {
    if (!key) return;
    let row; try { row = get('SELECT title, youtube_url FROM training_library WHERE seed_key=?', key); } catch { /* no library yet */ }
    links.push(row?.youtube_url ? { label: `Watch: ${row.title}`, url: row.youtube_url, external: true } : { label: 'Open Training videos', url: '/training' });
  };
  let answer;
  if (top.type === 'guide') {
    const g = top.guide;
    answer = `**${g.title}** (since ${g.since})\n${g.steps.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    if (g.limits?.length) answer += `\n\n**Good to know**\n${g.limits.map((t) => `• ${t}`).join('\n')}`;
    const faq = g.faq.find((f) => words(f.q).filter((w) => ` ${q} `.includes(` ${w} `)).length >= 2);
    if (faq) answer = `${faq.a}\n\n${answer}`;
    videoLink(g.video);
  } else if (top.type === 'screen') {
    const sc = top.screen;
    answer = `**${sc.label}** is under **${sc.section}** in the menu.${sc.about ? `\n${sc.about}` : ''}\nIf you cannot see it, your role or plan may not include it; ask your administrator.`;
    links.push({ label: `Open ${sc.label}`, url: sc.path });
  } else {
    answer = `**${top.version}: ${top.title}**\n${top.item.text}${top.item.where ? `\nWhere: ${top.item.where}` : ''}`;
  }
  const title = top.type === 'guide' ? top.guide.title : top.type === 'screen' ? top.screen.label : top.title;
  const extra = videoLinks(ctx.user, `${q} ${title}`);
  if (extra.length) {
    for (const l of extra) if (!links.some((x) => x.url === l.url)) links.push(l);
    for (let i = links.length - 1; i >= 0; i--) if (links[i].url === '/training') links.splice(i, 1);
  }
  const more = hits.slice(1).map((h) => (h.type === 'guide' ? h.guide.title : h.type === 'screen' ? h.screen.label : `${h.version}: ${h.title}`));
  return { answer, tables: [], links, suggestions: more.length ? more.map((m) => `Tell me about ${m}`) : ["What's new?", 'How do I add a developer?'] };
});

// ---------------------------------------------------------------- leads / customers / follow-ups
intent('leads', (q) => has(q, /\blead/) && !has(q, 'follow'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'crm', 'view')) return deny('leads and CRM data');
  const p = period(q), own = ctx.user.own_scope ? ctx.user.id : null;
  const agent = !own ? matchBy(q, salesAgents(), (a) => a.name) : null;
  const base = `FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id LEFT JOIN users u ON u.id=c.agent_id WHERE 1=1${own ? ' AND (c.agent_id=? OR c.created_by=?)' : ''}${agent ? ' AND c.agent_id=?' : ''}`;
  const bp = [...(own ? [own, own] : []), ...(agent ? [agent.id] : [])];
  const r = inRange('date(c.created_at)', p);
  const total = get(`SELECT COUNT(*) n ${base}${r.sql}`, ...bp, ...r.params).n;
  const month = get(`SELECT COUNT(*) n ${base} AND date(c.created_at) BETWEEN ? AND ?`, ...bp, dateRange('this_month').from, dateRange('this_month').to).n;
  const conv = get(`SELECT COUNT(*) n ${base}${r.sql} AND c.is_customer=1`, ...bp, ...r.params).n;
  const byStage = all(`SELECT COALESCE(st.value,'—') stage, COUNT(*) leads ${base}${r.sql} GROUP BY st.id ORDER BY st.sort_order`, ...bp, ...r.params);
  const bySource = all(`SELECT COALESCE(c.lead_source,'Unknown') source, COUNT(*) leads ${base}${r.sql} GROUP BY c.lead_source ORDER BY leads DESC`, ...bp, ...r.params);
  const byAgent = own ? [] : all(`SELECT COALESCE(u.name,'Unassigned') agent, COUNT(*) leads, SUM(c.is_customer) converted ${base}${r.sql} GROUP BY c.agent_id ORDER BY leads DESC`, ...bp, ...r.params);
  return {
    answer: `We have **${total}** lead${total === 1 ? '' : 's'}${agent ? ` assigned to ${agent.name}` : ''}${p ? ` created ${inL(p.label)}` : ' in total'} — **${conv}** converted to customers${p ? '' : `; **${month}** were added this month`}.`,
    tables: [{ title: 'Leads by stage', columns: [C('stage', 'Stage'), C('leads', 'Leads', 'number')], rows: byStage },
      { title: 'Leads by source', columns: [C('source', 'Source'), C('leads', 'Leads', 'number')], rows: bySource },
      ...(byAgent.length ? [{ title: 'Leads by sales agent', columns: [C('agent', 'Agent'), C('leads', 'Leads', 'number'), C('converted', 'Converted', 'number')], rows: byAgent }] : [])],
    suggestions: ['Leads this month by source', 'Follow-ups due today', 'Top agents this month'],
  };
});

intent('followups', (q) => has(q, 'follow'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'crm', 'view')) return deny('CRM data');
  const own = ctx.user.own_scope ? ctx.user.id : null;
  const t = today();
  const rows = all(`SELECT c.full_name contact, c.phone, st.value stage, c.followup_date, u.name agent FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id LEFT JOIN users u ON u.id=c.agent_id
    WHERE c.is_customer=0 AND c.followup_date IS NOT NULL AND c.followup_date<=? ${own ? 'AND c.agent_id=?' : ''} ORDER BY c.followup_date LIMIT 50`, addDays(t, has(q, 'tomorrow') ? 1 : 0), ...(own ? [own] : []));
  const overdue = rows.filter((r) => r.followup_date < t).length;
  return { answer: `**${rows.length}** follow-up${rows.length === 1 ? '' : 's'} due — **${overdue}** overdue, **${rows.length - overdue}** due ${has(q, 'tomorrow') ? 'by tomorrow' : 'today'}.`,
    tables: [{ title: 'Follow-ups due', columns: [C('contact', 'Contact'), C('phone', 'Phone'), C('stage', 'Stage'), C('followup_date', 'Follow-up'), C('agent', 'Agent')], rows }], suggestions: ['How many leads this month?', 'Top agents this month'] };
});

intent('customers', (q) => has(q, /\bcustomers?\b/) && !has(q, 'overdue', 'receivable', 'outstanding', 'owe'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'customers', 'view')) return deny('customer data');
  const own = ctx.user.own_scope ? ctx.user.id : null;
  const rows = all(`SELECT c.full_name customer, c.phone, (SELECT COUNT(*) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') purchases,
      (SELECT COALESCE(SUM(net_price),0) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') value, (SELECT COALESCE(SUM(net_price-paid_amount),0) FROM sales s WHERE s.contact_id=c.id AND s.status='confirmed') outstanding
    FROM contacts c WHERE c.is_customer=1 ${own ? 'AND c.agent_id=?' : ''} ORDER BY value DESC LIMIT 100`, ...(own ? [own] : []));
  return { answer: `We have **${rows.length}** customers with purchases worth **${money(rows.reduce((a, r) => a + r.value, 0))}**, of which **${money(rows.reduce((a, r) => a + r.outstanding, 0))}** is still outstanding.`,
    tables: [{ title: 'Customers', columns: [C('customer', 'Customer'), C('phone', 'Phone'), C('purchases', 'Purchases', 'number'), C('value', 'Purchase value', 'money'), C('outstanding', 'Outstanding', 'money')], rows }], suggestions: ['Which customers are overdue?', 'Receivables'] };
});

// ---------------------------------------------------------------- projects
intent('budget', (q) => has(q, 'budget', 'utili', 'cost of project', 'project cost', 'spent on', 'spent at', 'spending on'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'accounting', 'view')) return deny('project budgets and spending');
  const projects = all('SELECT id,name,code,budget,total_value,kind FROM projects ORDER BY name');
  const named = matchBy(q, projects, (p) => `${p.name} ${p.code}`);
  const rows = (named ? [named] : projects).map((p) => {
    const f = projectFinancials(p.id), budget = p.budget || null, used = f.development_cost;
    return { project: p.name, budget, utilised: used, remaining: budget ? budget - used : null, used_pct: budget ? Math.round((used / budget) * 100) : null, collected: f.collections };
  });
  const noBudget = rows.filter((r) => !r.budget).length;
  const top = [...rows].sort((a, b) => b.utilised - a.utilised)[0];
  return { answer: named
    ? `**${named.name}**: ${rows[0].budget ? `budget ${money(rows[0].budget)}, **${money(rows[0].utilised)}** utilised (**${rows[0].used_pct}%**), ${money(rows[0].remaining)} remaining.` : `**${money(rows[0].utilised)}** spent so far — no budget has been set for this project (set one under Projects → Edit).`}`
    : `Across ${rows.length} projects **${money(rows.reduce((a, r) => a + r.utilised, 0))}** has been utilised${top ? `; the most is at **${top.project}** (${money(top.utilised)})` : ''}.${noBudget ? ` ${noBudget} project(s) have no budget set.` : ''}`,
  tables: [{ title: 'Budget utilisation by project', columns: [C('project', 'Project'), C('budget', 'Budget', 'money'), C('utilised', 'Utilised (costs booked)', 'money'), C('remaining', 'Remaining', 'money'), C('used_pct', 'Used %', 'number'), C('collected', 'Collected from customers', 'money')], rows }],
  suggestions: ['How many projects are going on?', 'Expenses by project this month'] };
});

intent('projects', (q) => has(q, 'project') && !has(q, 'expense', 'spent', 'revenue', 'profit'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'projects', 'view')) return deny('project data');
  const rows = all(`SELECT p.id, p.name, p.kind, p.dev_status status, p.start_date, p.expected_completion, u.name manager, ${progressSql('p.id')} progress FROM projects p LEFT JOIN users u ON u.id=p.manager_id ORDER BY p.name`);
  const ongoing = rows.filter((p) => p.status !== 'Completed');
  const out = ongoing.map((p) => { const s = scheduleFor(p.id, { scope: 'project' }).summary; return { project: p.name, type: p.kind, status: p.status, progress: p.progress ?? 0, planned: s.tasks ? s.planned_pct : null, health: s.health === 'none' ? '—' : s.health.replace('_', ' '), deadline: p.expected_completion, manager: p.manager }; });
  const delayed = out.filter((o) => ['delayed', 'at risk'].includes(o.health)).length;
  return { answer: `**${ongoing.length}** project${ongoing.length === 1 ? ' is' : 's are'} going on (of ${rows.length} total)${delayed ? ` — **${delayed}** running behind schedule` : ''}: ${ongoing.map((p) => p.name).join(', ') || 'none'}.`,
    tables: [{ title: 'Ongoing projects', columns: [C('project', 'Project'), C('type', 'Type'), C('status', 'Status'), C('progress', 'Progress %', 'number'), C('planned', 'Planned %', 'number'), C('health', 'Schedule'), C('deadline', 'Deadline'), C('manager', 'Manager')], rows: out }],
    suggestions: ['Budget utilised by project', 'Property inventory'] };
});

// ---------------------------------------------------------------- HR
const employees = () => all('SELECT id,name,emp_code,department,designation,salary,status FROM employees ORDER BY name');
intent('leaves', (q) => has(q, /\bleaves?\b/, 'on leave', 'time off', 'absent'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'hrm', 'view')) return deny('HR data');
  const p = period(q) || { ...dateRange('this_year'), label: 'this year' };
  const emp = matchBy(q, employees(), (e) => e.name);
  const rows = (emp ? [emp] : employees().filter((e) => e.status === 'active')).map((e) => {
    const by = all(`SELECT type, SUM(days) d FROM leaves WHERE employee_id=? AND status='approved' AND from_date BETWEEN ? AND ? GROUP BY type`, e.id, p.from, p.to);
    const pending = get(`SELECT COALESCE(SUM(days),0) d FROM leaves WHERE employee_id=? AND status='pending'`, e.id).d;
    return { employee: e.name, department: e.department, days: by.reduce((a, x) => a + x.d, 0), breakdown: by.map((x) => `${x.type} ${x.d}`).join(', ') || '—', pending };
  });
  const total = rows.reduce((a, r) => a + r.days, 0);
  const wantsSalary = has(q, 'salar', 'paid', 'pay');
  const salaryRows = !wantsSalary ? [] : emp ? all(`SELECT period, net, status, payment_date FROM payroll WHERE employee_id=? ORDER BY period DESC LIMIT 12`, emp.id)
    : all(`SELECT e.name employee, COUNT(*) months, COALESCE(SUM(CASE WHEN p.status='paid' THEN p.net END),0) net, COALESCE(SUM(CASE WHEN p.status<>'paid' THEN p.net END),0) pending FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.period BETWEEN ? AND ? GROUP BY e.id ORDER BY net DESC`, p.from.slice(0, 7), p.to.slice(0, 7));
  return { answer: emp ? `**${emp.name}** took **${rows[0].days}** approved leave day(s) ${inL(p.label)} (${rows[0].breakdown}); ${rows[0].pending} day(s) pending.${wantsSalary && salaryRows.length ? ` Salary paid: **${money(salaryRows.filter((s) => s.status === 'paid').reduce((a, s) => a + s.net, 0))}** across ${salaryRows.filter((s) => s.status === 'paid').length} month(s).` : ''}` : `Employees took **${total}** approved leave day(s) ${inL(p.label)}.${wantsSalary && salaryRows.length ? ` Salaries paid in the same period: **${money(salaryRows.reduce((a, r) => a + r.net, 0))}**.` : ''}`,
    tables: [{ title: `Leaves taken (${p.label})`, columns: [C('employee', 'Employee'), C('department', 'Department'), C('days', 'Days taken', 'number'), C('breakdown', 'By type'), C('pending', 'Pending days', 'number')], rows, totals: { employee: 'Total', days: total } },
      ...(wantsSalary && salaryRows.length ? [emp ? { title: `Salary — ${emp.name}`, columns: [C('period', 'Month'), C('net', 'Net salary', 'money'), C('status', 'Status'), C('payment_date', 'Paid on')], rows: salaryRows } : { title: `Salaries paid (${p.label})`, columns: [C('employee', 'Employee'), C('months', 'Months', 'number'), C('net', 'Paid', 'money'), C('pending', 'Not yet paid', 'money')], rows: salaryRows, totals: { employee: 'Total', net: salaryRows.reduce((a, r) => a + r.net, 0) } }] : [])],
    suggestions: ['How much salary was paid this year?', 'Headcount by department'] };
});

intent('salaries', (q) => has(q, 'salar', 'payroll', 'wages'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'hrm', 'view')) return deny('salary data');
  const p = period(q) || { ...dateRange('this_year'), label: 'this year' };
  const emp = matchBy(q, employees(), (e) => e.name);
  const f = (a, b) => `${a.slice(0, 7)}`;
  const rows = all(`SELECT e.name employee, e.department, COUNT(*) months, COALESCE(SUM(CASE WHEN p.status='paid' THEN p.net END),0) paid, COALESCE(SUM(CASE WHEN p.status<>'paid' THEN p.net END),0) pending
    FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.period BETWEEN ? AND ? ${emp ? 'AND e.id=?' : ''} GROUP BY e.id ORDER BY paid DESC`, f(p.from), f(p.to), ...(emp ? [emp.id] : []));
  const paid = rows.reduce((a, r) => a + r.paid, 0), pending = rows.reduce((a, r) => a + r.pending, 0);
  return { answer: `${emp ? `${emp.name} was` : 'Staff were'} paid **${money(paid)}** in salaries ${inL(p.label)}${pending ? `; ${money(pending)} is generated but not yet paid` : ''}.`,
    tables: [{ title: `Salaries (${p.label})`, columns: [C('employee', 'Employee'), C('department', 'Department'), C('months', 'Months', 'number'), C('paid', 'Paid', 'money'), C('pending', 'Not yet paid', 'money')], rows, totals: { employee: 'Total', paid, pending } }],
    suggestions: ['How many leaves did each employee take?', 'Headcount by department'] };
});

intent('headcount', (q) => has(q, 'headcount', 'how many employees', 'employees do we', 'staff'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'hrm', 'view')) return deny('HR data');
  const rows = all("SELECT COALESCE(department,'—') department, COUNT(*) employees, SUM(salary) monthly_payroll FROM employees WHERE status='active' GROUP BY department ORDER BY employees DESC");
  return { answer: `We have **${rows.reduce((a, r) => a + r.employees, 0)}** active employees; monthly payroll is **${money(rows.reduce((a, r) => a + r.monthly_payroll, 0))}**.`,
    tables: [{ title: 'Headcount by department', columns: [C('department', 'Department'), C('employees', 'Employees', 'number'), C('monthly_payroll', 'Monthly payroll', 'money')], rows }], suggestions: ['How much salary was paid this year?'] };
});

// ---------------------------------------------------------------- money
intent('balance_sheet', (q) => has(q, 'balance sheet'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'accounting', 'view')) return deny('the balance sheet');
  const tb = trialBalance({ to: today() });
  const leaf = (t) => tb.filter((a) => a.type === t && a.balance && !tb.some((c) => c.parent_id === a.id));
  const sum = (t) => leaf(t).reduce((a, x) => a + x.balance, 0);
  const profit = sum('income') - sum('expense');
  const mk = (title, t) => ({ title, columns: [C('account', 'Account'), C('balance', 'Balance', 'money')], rows: leaf(t).map((a) => ({ account: `${a.code} ${a.name}`, balance: a.balance })), totals: { account: `Total ${title.toLowerCase()}`, balance: sum(t) } });
  return { answer: `Balance sheet as of today: assets **${money(sum('asset'))}**, liabilities **${money(sum('liability'))}**, equity **${money(sum('equity') + profit)}** (including current profit ${money(profit)}). ${Math.abs(sum('asset') - sum('liability') - sum('equity') - profit) === 0 ? 'The books balance.' : 'Check the ledgers — the books do not balance.'}`,
    tables: [mk('Assets', 'asset'), mk('Liabilities', 'liability'), { ...mk('Equity', 'equity'), rows: [...leaf('equity').map((a) => ({ account: `${a.code} ${a.name}`, balance: a.balance })), { account: 'Current profit / (loss)', balance: profit }], totals: { account: 'Total equity', balance: sum('equity') + profit } }],
    suggestions: ['Cash and bank balances', 'Profit and loss this year'] };
});

intent('profit', (q) => has(q, 'profit', 'loss', 'income statement', 'p&l'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'accounting', 'view')) return deny('financial statements');
  const p = period(q) || { ...dateRange('this_year'), label: 'this year' };
  const tb = trialBalance({ from: p.from, to: p.to }).filter((a) => ['income', 'expense'].includes(a.type) && a.balance && !trialBalance().some((c) => c.parent_id === a.id));
  const inc = tb.filter((a) => a.type === 'income'), exp = tb.filter((a) => a.type === 'expense');
  const ti = inc.reduce((a, x) => a + x.balance, 0), te = exp.reduce((a, x) => a + x.balance, 0);
  return { answer: `For ${p.label}: income **${money(ti)}**, expenses **${money(te)}**, net **${ti - te >= 0 ? 'profit' : 'loss'} of ${money(Math.abs(ti - te))}**.`,
    tables: [{ title: 'Income', columns: [C('account', 'Account'), C('amount', 'Amount', 'money')], rows: inc.map((a) => ({ account: a.name, amount: a.balance })), totals: { account: 'Total income', amount: ti } },
      { title: 'Expenses', columns: [C('account', 'Account'), C('amount', 'Amount', 'money')], rows: exp.map((a) => ({ account: a.name, amount: a.balance })), totals: { account: 'Total expenses', amount: te } }], suggestions: ['Balance sheet', 'Expenses by project'] };
});

intent('expenses', (q) => has(q, 'expense', 'spending', 'spent'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'accounting', 'view')) return deny('expense data');
  const p = period(q) || { ...dateRange('this_month'), label: 'this month' };
  const projects = all('SELECT id,name FROM projects');
  const named = matchBy(q, projects, (x) => x.name);
  const f = `FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id LEFT JOIN projects pr ON pr.id=l.project_id WHERE a.type='expense' AND j.date BETWEEN ? AND ? ${named ? 'AND l.project_id=?' : ''}`;
  const prm = [p.from, p.to, ...(named ? [named.id] : [])];
  const total = get(`SELECT COALESCE(SUM(l.debit-l.credit),0) v ${f}`, ...prm).v;
  const byAccount = all(`SELECT a.name account, SUM(l.debit-l.credit) amount ${f} GROUP BY a.id HAVING amount<>0 ORDER BY amount DESC`, ...prm);
  const byProject = named ? [] : all(`SELECT COALESCE(pr.name,'Company / unallocated') project, SUM(l.debit-l.credit) amount ${f} GROUP BY l.project_id HAVING amount<>0 ORDER BY amount DESC`, ...prm);
  return { answer: `Expenses ${named ? `on **${named.name}** ` : ''}for ${p.label}: **${money(total)}**.`,
    tables: [{ title: 'By expense account', columns: [C('account', 'Account'), C('amount', 'Amount', 'money')], rows: byAccount, totals: { account: 'Total', amount: total } }, ...(byProject.length ? [{ title: 'By project', columns: [C('project', 'Project'), C('amount', 'Amount', 'money')], rows: byProject }] : [])],
    suggestions: ['Budget utilised by project', 'Profit and loss this month'] };
});

intent('sales', (q) => has(q, /\bsales?\b/, 'sold', 'revenue', 'bookings'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'sales', 'view')) return deny('sales data');
  const p = period(q) || { ...dateRange('this_month'), label: 'this month' };
  const own = ctx.user.own_scope ? ctx.user.id : null;
  const base = `FROM sales s LEFT JOIN users u ON u.id=s.agent_id LEFT JOIN projects pr ON pr.id=s.project_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? ${own ? 'AND s.agent_id=?' : ''}`;
  const prm = [p.from, p.to, ...(own ? [own] : [])];
  const t = get(`SELECT COUNT(*) n, COALESCE(SUM(s.net_price),0) v, COALESCE(SUM(s.paid_amount),0) paid ${base}`, ...prm);
  const byAgent = own ? [] : all(`SELECT COALESCE(u.name,'Unassigned') agent, COUNT(*) sales, SUM(s.net_price) value ${base} GROUP BY s.agent_id ORDER BY value DESC`, ...prm);
  const byProject = all(`SELECT COALESCE(pr.name,'—') project, COUNT(*) sales, SUM(s.net_price) value ${base} GROUP BY s.project_id ORDER BY value DESC`, ...prm);
  return { answer: `**${t.n}** sale${t.n === 1 ? '' : 's'} worth **${money(t.v)}** ${inL(p.label)}; **${money(t.paid)}** collected so far.`,
    tables: [...(byAgent.length ? [{ title: 'Sales by agent', columns: [C('agent', 'Agent'), C('sales', 'Sales', 'number'), C('value', 'Value', 'money')], rows: byAgent }] : []), { title: 'Sales by project', columns: [C('project', 'Project'), C('sales', 'Sales', 'number'), C('value', 'Value', 'money')], rows: byProject }],
    suggestions: ['Receivables and overdue', 'Top agents this month'] };
});

intent('collections', (q) => has(q, 'collect', 'received', 'receipts', 'payments received', 'cash in'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'payments', 'view')) return deny('payment data');
  const p = period(q) || { ...dateRange('this_month'), label: 'this month' };
  const rows = all(`SELECT method, COUNT(*) receipts, SUM(CASE WHEN payment_type='Refund' THEN -amount ELSE amount END) amount FROM receipts WHERE status='valid' AND date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC`, p.from, p.to);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return { answer: `Collected **${money(total)}** across ${rows.reduce((a, r) => a + r.receipts, 0)} receipts ${inL(p.label)}.`, tables: [{ title: `Collections (${p.label})`, columns: [C('method', 'Method'), C('receipts', 'Receipts', 'number'), C('amount', 'Amount', 'money')], rows, totals: { method: 'Total', amount: total } }], suggestions: ['Receivables and overdue', 'Cash and bank balances'] };
});

intent('receivables', (q) => has(q, 'receivable', 'outstanding', 'overdue', 'defaulter', 'owe', 'due installments', 'unpaid'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'payments', 'view')) return deny('receivables');
  const t = today();
  const rows = all(`SELECT c.full_name customer, c.phone, COALESCE(s.title,p.title) property, s.net_price net, s.paid_amount paid, s.net_price-s.paid_amount outstanding,
      (SELECT COALESCE(SUM(i.amount-i.paid),0) FROM installments i WHERE i.sale_id=s.id AND i.status<>'paid' AND i.due_date<?) overdue
    FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id WHERE s.status='confirmed' AND s.net_price>s.paid_amount ORDER BY overdue DESC, outstanding DESC LIMIT 100`, t);
  const od = rows.filter((r) => r.overdue > 0);
  return { answer: `Customers owe **${money(rows.reduce((a, r) => a + r.outstanding, 0))}** in total; **${money(od.reduce((a, r) => a + r.overdue, 0))}** is overdue across **${od.length}** account(s).`,
    tables: [{ title: 'Receivables', columns: [C('customer', 'Customer'), C('property', 'Property / contract'), C('net', 'Net value', 'money'), C('paid', 'Paid', 'money'), C('outstanding', 'Outstanding', 'money'), C('overdue', 'Overdue', 'money')], rows }], suggestions: ['Collections this month', 'Sales this month'] };
});

intent('cash', (q) => has(q, 'cash', 'bank', 'treasury', 'till') && !has(q, 'balance sheet'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'accounting', 'view')) return deny('cash and bank balances');
  const rows = treasuryAccounts().map((a) => ({ account: a.name, type: a.subtype, balance: accountBalance(a.id) }));
  return { answer: `Cash and bank balance is **${money(rows.reduce((a, r) => a + r.balance, 0))}** across ${rows.length} accounts.`, tables: [{ title: 'Cash, till and bank', columns: [C('account', 'Account'), C('type', 'Type'), C('balance', 'Balance', 'money')], rows, totals: { account: 'Total', balance: rows.reduce((a, r) => a + r.balance, 0) } }], suggestions: ['Balance sheet', 'Expenses this month'] };
});

intent('vendors', (q) => has(q, 'vendor', 'payable', 'supplier', 'credit book'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'vendors', 'view')) return deny('vendor data');
  const rows = all(`SELECT v.name vendor, v.category, COALESCE(SUM(l.credit),0) billed, COALESCE(SUM(l.debit),0) paid, COALESCE(SUM(l.credit-l.debit),0) payable FROM vendors v
    LEFT JOIN journal_lines l ON l.vendor_id=v.id AND l.account_id=(SELECT id FROM accounts WHERE code='2100') GROUP BY v.id HAVING billed>0 ORDER BY payable DESC`);
  return { answer: `We owe vendors **${money(rows.reduce((a, r) => a + r.payable, 0))}** in total across ${rows.filter((r) => r.payable > 0).length} vendor(s).`, tables: [{ title: 'Vendor payables', columns: [C('vendor', 'Vendor'), C('category', 'Category'), C('billed', 'Billed', 'money'), C('paid', 'Paid', 'money'), C('payable', 'Payable', 'money')], rows, totals: { vendor: 'Total', payable: rows.reduce((a, r) => a + r.payable, 0) } }], suggestions: ['Cash and bank balances'] };
});

intent('commissions', (q) => has(q, 'commission'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'commissions', 'view')) return deny('commission data');
  const own = ctx.user.own_scope ? ctx.user.id : null;
  const rows = all(`SELECT u.name agent, COUNT(*) deals, SUM(cm.amount) earned, SUM(cm.paid_amount) paid, SUM(cm.amount-cm.paid_amount) pending FROM commissions cm JOIN users u ON u.id=cm.agent_id WHERE cm.status<>'cancelled' ${own ? 'AND cm.agent_id=?' : ''} GROUP BY cm.agent_id ORDER BY earned DESC`, ...(own ? [own] : []));
  return { answer: `Commission earned **${money(rows.reduce((a, r) => a + r.earned, 0))}**, paid **${money(rows.reduce((a, r) => a + r.paid, 0))}**, pending **${money(rows.reduce((a, r) => a + r.pending, 0))}**.`, tables: [{ title: 'Commission by agent', columns: [C('agent', 'Agent'), C('deals', 'Deals', 'number'), C('earned', 'Earned', 'money'), C('paid', 'Paid', 'money'), C('pending', 'Pending', 'money')], rows }], suggestions: ['Top agents this month'] };
});

intent('inventory', (q) => has(q, /propert|plots?\b|inventory|houses?\b|units?\b|shops?\b|available/), (q, ctx) => {
  if (!hasPerm(ctx.user, 'properties', 'view')) return deny('property data');
  const byStatus = all("SELECT status, COUNT(*) properties, COALESCE(SUM(net_price),0) value FROM properties GROUP BY status ORDER BY properties DESC");
  const byProject = all("SELECT COALESCE(pr.name,'No project') project, COUNT(*) units, SUM(p.status='sold') sold, SUM(p.status IN ('available','featured')) available, SUM(p.status='reserved') reserved FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE p.status<>'cancelled' GROUP BY p.project_id");
  const n = (...s) => byStatus.filter((x) => s.includes(x.status)).reduce((a, x) => a + x.properties, 0);
  return { answer: `Inventory: **${n('available', 'featured')}** available, **${n('reserved')}** reserved, **${n('sold')}** sold, **${n('draft')}** in draft (${byStatus.reduce((a, x) => a + x.properties, 0)} properties in total).`,
    tables: [{ title: 'Properties by status', columns: [C('status', 'Status'), C('properties', 'Properties', 'number'), C('value', 'Value', 'money')], rows: byStatus }, { title: 'Inventory by project', columns: [C('project', 'Project'), C('units', 'Units', 'number'), C('available', 'Available', 'number'), C('reserved', 'Reserved', 'number'), C('sold', 'Sold', 'number')], rows: byProject }], suggestions: ['Sales this month', 'How many projects are going on?'] };
});

intent('agents', (q) => has(q, 'agent', 'leaderboard', 'top performer', 'best', 'goal', 'target', 'performance'), (q, ctx) => {
  if (!hasPerm(ctx.user, 'crm', 'view')) return deny('agent performance');
  if (ctx.user.own_scope) {
    const o = overview(ctx.user.id);
    return { answer: `Today you're at **${o.daily.overall_pct}%** of your daily goal and **${o.monthly.overall_pct}%** of your monthly goal. ${o.opportunities.to_convert} lead(s) are in follow-up/interested waiting to be converted.`, tables: [{ title: 'Today', columns: [C('label', 'Goal'), C('target', 'Target', 'number'), C('actual', 'Done', 'number'), C('pct', '%', 'number')], rows: o.daily.metrics }], suggestions: ['Follow-ups due today'] };
  }
  const rows = teamView().map((t) => ({ rank: t.rank, agent: t.name, today_pct: t.daily.overall_pct, month_pct: t.monthly.overall_pct, sales: t.sales, points: t.points, to_convert: t.to_convert }));
  return { answer: rows.length ? `**${rows[0].agent}** leads this month with ${rows[0].points} points. ${rows.filter((r) => r.today_pct >= 100).length} of ${rows.length} agents hit today's goal.` : 'No sales agents yet.', tables: [{ title: 'Agent performance', columns: [C('rank', '#', 'number'), C('agent', 'Agent'), C('today_pct', 'Today %', 'number'), C('month_pct', 'Month %', 'number'), C('sales', 'Sales (month)', 'number'), C('points', 'Points', 'number'), C('to_convert', 'Leads to convert', 'number')], rows }], suggestions: ['Follow-ups due today', 'Commission by agent'] };
});

const SUGGEST = ['How many leads this month?', 'How many projects are going on?', 'Budget utilised by project', 'Sales this month', 'Receivables and overdue', 'Balance sheet'];

/** Answer a natural-language question from the live database, respecting the asker's permissions. */
export function ask(question, user) {
  const q = ` ${String(question || '').toLowerCase().replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (q.trim().length < 2) return { intent: 'empty', answer: 'Ask me something about your leads, projects, budgets, sales, staff or accounts.', tables: [], suggestions: SUGGEST };
  const ctx = { user };
  for (const it of INTENTS) {
    if (it.test(q)) {
      const out = it.run(q, ctx);
      return { intent: it.name, tables: [], suggestions: SUGGEST.slice(0, 4), ...out, wants_pdf: has(q, 'pdf', 'download', 'report', 'export', 'print') };
    }
  }
  return { intent: 'unknown', answer: "I couldn't match that to something I can look up. I can report on leads, follow-ups, customers, sales, collections, receivables, expenses, project budgets and progress, property inventory, cash and bank, balance sheet, profit & loss, vendors, commissions, leaves, salaries and agent performance.", tables: [], suggestions: SUGGEST };
}
