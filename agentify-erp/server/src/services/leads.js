// One way for a website enquiry to become a CRM lead, shared by the company website, the old /api/public endpoints and
// the Integration API v1: find the person (same phone written differently, or same e-mail), add to their history or
// create them, route them to an agent, and keep where it came from and what they agreed to.
import { all, get, getSetting, run } from '../db.js';
import { activity, notify } from '../audit.js';
import { bad, int, jparse, now } from '../util.js';
import { phoneKey } from './phone.js';
import { isPersonName } from '../validation.js';

/** Round-robin lead routing: website -> CRM lead -> sales agent -> sales manager. */
export function nextAgent() {
  const agents = all("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Agent' AND u.active=1 ORDER BY u.id");
  if (!agents.length) return null;
  const last = Number(getSetting('lead_rr_last', 0));
  const next = agents.find((a) => a.id > last) || agents[0];
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'lead_rr_last', String(next.id));
  return next.id;
}

/** The same person if their phone (in any spelling) or e-mail is already in the CRM. */
function findContact(phone, email) {
  if (phone) {
    const exact = get('SELECT id,agent_id FROM contacts WHERE phone=?', phone);
    if (exact) return exact;
    const key = phoneKey(phone);
    if (key.length >= 7) {
      const rows = all("SELECT id,agent_id,phone FROM contacts WHERE phone IS NOT NULL AND replace(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ? LIMIT 50", `%${key.slice(-7)}`);
      const hit = rows.find((r) => phoneKey(r.phone) === key);
      if (hit) return hit;
    }
  }
  return (email && get('SELECT id,agent_id FROM contacts WHERE lower(email)=lower(?)', email)) || null;
}

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const url = (v) => { const s = text(v, 500); return /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };
const flag = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : null);

/** Where the enquiry came from (form, page, referrer, campaign) as sent by the website. Unknown keys are dropped. */
export function cleanSource(s) {
  if (!s || typeof s !== 'object') return null;
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) if (s[k]) utm[k] = text(s[k], 120);
  const out = { form: text(s.form, 80) || null, page_url: url(s.page_url), referrer: url(s.referrer), utm };
  return out.form || out.page_url || out.referrer || Object.keys(utm).length ? out : null;
}

/** What the visitor agreed to, exactly as the website recorded it. Nothing is assumed when it was not sent. */
export function cleanConsent(c) {
  if (!c || typeof c !== 'object') return null;
  const at = text(c.at, 40);
  const out = { marketing: flag(c.marketing), privacy: flag(c.privacy), text: text(c.text, 600) || null, at: /^\d{4}-\d{2}-\d{2}/.test(at) ? at : null, received_at: now() };
  return out.marketing === null && out.privacy === null && !out.text ? null : out;
}

export function validateContactFields(body) {
  const name = text(body.name, 120);
  const phone = text(body.phone, 30);
  const email = text(body.email, 120);
  if (!name) throw bad('Name is required');
  if (!isPersonName(name)) throw bad('Please enter a valid name: letters only, no numbers or symbols');
  if (!phone && !email) throw bad('Phone or email is required');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('Email is not valid');
  if (phone && !/^[+\d][\d\s\-()]{6,19}$/.test(phone)) throw bad('Phone is not valid');
  return { name, phone, email };
}

/** A listing or project given as its number or its code. */
const byRef = (table, ref, cols) => {
  const s = text(ref, 60);
  if (!s) return null;
  return (/^\d+$/.test(s) && get(`SELECT ${cols} FROM ${table} WHERE id=?`, int(s))) || get(`SELECT ${cols} FROM ${table} WHERE code=?`, s) || null;
};

/**
 * Create the lead or add to the person already in the CRM.
 * `connection` (Integration API) supplies the lead source, pipeline stage and agent chosen in the wizard.
 * Returns { id, result: 'created' | 'matched' }.
 */
export function submitLead(body, { kind = 'lead', connection = null, test = false } = {}) {
  const { name, phone, email } = validateContactFields(body);
  const message = String(body.message || '').slice(0, 2000);
  const cfg = connection?.config || {};
  const consent = cleanConsent(body.consent);
  if (cfg.require_privacy_consent && !(consent && consent.privacy === true)) throw bad('This connection requires the visitor to accept the privacy notice (consent.privacy must be true)', { code: 'consent_required' });
  const source = cleanSource(body.source);
  const prop = byRef('properties', body.property_ref ?? body.property_id, 'id,title,project_id,agent_id');
  const project = prop ? get('SELECT id,name FROM projects WHERE id=?', prop.project_id) : byRef('projects', body.project_ref, 'id,name');
  const existing = findContact(phone, email);
  const mgr = get("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Manager' AND u.active=1 LIMIT 1")?.id ?? null;
  const about = prop ? prop.title : project?.name || null;
  let cid, agent, result;
  if (existing) {
    result = 'matched'; cid = existing.id; agent = existing.agent_id;
    activity(cid, null, `Website ${kind}${test ? ' (test)' : ''}`, { detail: `${about ? `${about} — ` : ''}${message}`.slice(0, 300) });
    if (connection && message) run("INSERT INTO notes(entity_type,entity_id,body,user_id,created_at) VALUES('contact',?,?,NULL,?)", cid, `[Website ${kind}] ${message}`, now());
  } else {
    result = 'created';
    agent = cfg.agent_id || prop?.agent_id || nextAgent();
    const stage = cfg.stage_id || get("SELECT id FROM lookups WHERE type='lead_stage' AND active=1 ORDER BY sort_order LIMIT 1")?.id;
    cid = Number(run(`INSERT INTO contacts(first_name,last_name,full_name,phone,email,lead_source,stage_id,agent_id,manager_id,tags,project_id,property_id,created_at,last_activity_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, name.split(' ')[0], name.split(' ').slice(1).join(' ') || null, name, phone || null, email || null, cfg.lead_source || 'Website', stage, agent, mgr,
    JSON.stringify(test ? ['website', 'test'] : ['website']), project?.id ?? null, prop?.id ?? null, now(), now()).lastInsertRowid);
    activity(cid, null, 'Lead created', { detail: `Website ${kind}${test ? ' (test submission)' : ''}${about ? ` for ${about}` : ''}` });
    if (agent) activity(cid, null, 'Contact assigned', { field: 'Sales agent', next: get('SELECT name FROM users WHERE id=?', agent)?.name });
    if (message) run("INSERT INTO notes(entity_type,entity_id,body,user_id,created_at) VALUES('contact',?,?,NULL,?)", cid, `[Website ${kind}] ${message}`, now());
  }
  if (connection || source || consent) {
    run('INSERT INTO lead_attribution(contact_id,connection_id,external_id,form,enquiry_type,page_url,referrer,utm,consent,result,test,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      cid, connection?.id ?? null, text(body.external_id, 120) || null, source?.form ?? null, text(body.enquiry_type, 40) || kind, source?.page_url ?? null, source?.referrer ?? null,
      source ? JSON.stringify(source.utm) : null, consent ? JSON.stringify(consent) : null, result, test ? 1 : 0, now());
  }
  if (!test) notify([agent, mgr], 'lead', `New website ${kind}`, `${name}${about ? ` — ${about}` : ''}`, `/contacts/${cid}`);
  return { id: cid, result };
}

export const attributionFor = (contactId) => all('SELECT * FROM lead_attribution WHERE contact_id=? ORDER BY id DESC', contactId)
  .map((a) => ({ ...a, utm: jparse(a.utm, {}), consent: jparse(a.consent, null) }));
