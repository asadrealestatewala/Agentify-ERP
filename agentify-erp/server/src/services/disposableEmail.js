// Refuses throw-away email addresses (Mailinator, 10-minute mail and the like) and addresses that cannot receive mail.
// Four layers, cheapest first:
//   1. the Super Admin's own list (console > Security > Email safety): "allow" always wins, "block" always refuses
//   2. a built-in list of well-known disposable services, plus a few telltale words in the domain name
//   3. a DNS check that the domain has mail servers at all (typos and invented domains)
//   4. the one-time code at signup (services/emailOtp.js), which proves the person can read the mailbox
// No list can be complete: new disposable services appear every day. The code at signup is the strong layer; this one
// removes the lazy abuse. The Super Admin can add a domain at any time, and allow a domain the list gets wrong.
import dns from 'node:dns/promises';
import { platformDb } from '../platform.js';
import { getSetting, setSetting } from './platformConfig.js';
import { bad } from '../util.js';

export const BUILTIN_DOMAINS = new Set(`
mailinator.com mailinator.net mailinator2.com guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamailblock.com
sharklasers.com grr.la spam4.me pokemail.net 10minutemail.com 10minutemail.net 10minutemail.org 20minutemail.com 20minutemail.it 30minutemail.com
tempmail.com tempmail.net tempmail.org tempmail.io tempmail.dev tempmailo.com temp-mail.org temp-mail.io temp-mail.ru tempmailaddress.com tempail.com
tempinbox.com tempr.email temporary-mail.net tempmailer.com throwawaymail.com throwam.com yopmail.com yopmail.fr yopmail.net cool.fr.nf jetable.org
nospam.ze.tc trashmail.com trashmail.net trashmail.de trashmail.org trash-mail.com trash-mail.at wegwerfmail.de wegwerfmail.net getnada.com nada.email
dispostable.com maildrop.cc mailnesia.com mailcatch.com mailtemp.net mailforspam.com fakeinbox.com fakemail.net fakemailgenerator.com emailfake.com
email-fake.com generator.email mintemail.com mohmal.com emailondeck.com spamgourmet.com spambox.us spamfree24.org spamex.com mytemp.email discard.email
discardmail.com burnermail.io moakt.com moakt.cc tmpmail.org tmpmail.net harakirimail.com inboxkitten.com mail.tm 1secmail.com 1secmail.net 1secmail.org
esiix.com wwjmp.com xojxe.com yoggm.com kzccv.com vjuum.com laafd.com txcct.com dpptd.com 10mail.org mailbox92.biz luxusmail.org cuvox.de dayrep.com einrot.com
fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com teleworm.us armyspy.com bccto.me linshiyouxiang.net emailtemporanea.net getairmail.com
instantemailaddress.com incognitomail.org mailmoat.com mailnull.com meltmail.com mt2015.com nowmymail.com objectmail.com onewaymail.com
owlpic.com pjjkp.com rcpt.at safetymail.info shiftmail.com sneakemail.com sogetthis.com stuffmail.de supermailer.jp thankyou2010.com
trbvm.com trashmail.me tyldd.com webemail.me zippymail.info zoemail.org drdrb.net fakeinbox.net tafmail.com mailto.plus fexpost.com fexbox.org
inboxbear.com cmail.net mailpoof.com mail-temporaire.fr tempsky.com altmails.com
`.split(/\s+/).filter(Boolean));

/** Words that appear in the names of throw-away services; catches new domains of a service already known. */
const TELLTALE = /(^|[.-])(mailinator|guerrillamail|yopmail|10minutemail|tempmail|temp-mail|trashmail|throwaway|throwawaymail|disposable|fakeinbox|getnada|maildrop|sharklasers)/;

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
export const emailDomain = (email) => { const m = String(email || '').trim().toLowerCase().match(/^[^\s@]+@([^\s@]+)$/); return m ? m[1].replace(/\.$/, '') : null; };
export const normalizeDomain = (d) => String(d || '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');

// ---- switches (platform settings; default on)
const flag = (k) => getSetting(k) !== '0';
export const blockDisposable = () => flag('block_disposable_email');
export const checkMx = () => flag('check_email_mx');
export const signupCodeRequired = () => flag('signup_email_code');
export const getSwitches = () => ({ block_disposable_email: blockDisposable(), check_email_mx: checkMx(), signup_email_code: signupCodeRequired() });
export function setSwitches(body, by) {
  for (const k of ['block_disposable_email', 'check_email_mx', 'signup_email_code']) if (body && k in body) setSetting(k, body[k] ? '1' : '0', { by });
  return getSwitches();
}

// ---- the Super Admin's own list
const rules = () => platformDb().prepare('SELECT domain, action, note, created_by, created_at FROM email_domain_rules ORDER BY domain').all();
export const listRules = () => ({ rules: rules(), builtin_count: BUILTIN_DOMAINS.size });
export function addRule({ domain, action, note }, by) {
  const d = normalizeDomain(domain);
  if (!DOMAIN_RE.test(d)) throw bad('Enter a domain such as mailinator.com (the part after the @)');
  if (!['block', 'allow'].includes(action)) throw bad('Choose block or allow');
  platformDb().prepare(`INSERT INTO email_domain_rules(domain,action,note,created_by) VALUES(?,?,?,?)
    ON CONFLICT(domain) DO UPDATE SET action=excluded.action, note=excluded.note, created_by=excluded.created_by`).run(d, action, String(note || '').slice(0, 200) || null, by || null);
  cache.clear();
  return d;
}
export function removeRule(domain) {
  const n = platformDb().prepare('DELETE FROM email_domain_rules WHERE domain=?').run(normalizeDomain(domain)).changes;
  cache.clear();
  return n > 0;
}

// ---- DNS: does the domain accept mail? Injectable so tests never touch the network.
const defaultResolver = {
  async mail(domain) {
    try { const mx = await dns.resolveMx(domain); if (mx.length) return true; } catch (e) { if (!['ENOTFOUND', 'ENODATA'].includes(e.code)) throw e; }
    // no MX record: a domain with an address record still receives mail (RFC 5321 implicit MX)
    for (const fn of [dns.resolve4, dns.resolve6]) { try { if ((await fn.call(dns, domain)).length) return true; } catch (e) { if (!['ENOTFOUND', 'ENODATA'].includes(e.code)) throw e; } }
    return false;
  },
};
let resolver = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT ? { mail: async () => true } : defaultResolver;
export const setMailResolver = (r) => { resolver = r || defaultResolver; cache.clear(); };
const cache = new Map(); // domain -> { at, ok }
const CACHE_MS = 10 * 60_000;
async function domainReceivesMail(domain) {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  let ok;
  try { ok = await Promise.race([resolver.mail(domain), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 3000))]); }
  catch { return true; } // a DNS outage must never stop real customers: only a definite "no such mail domain" refuses
  cache.set(domain, { at: Date.now(), ok });
  return ok;
}

export const MESSAGES = {
  syntax: 'Enter a valid email address.',
  disposable: 'Temporary or disposable email addresses cannot be used. Please use your permanent work or personal email address.',
  no_mail: 'That email domain cannot receive mail. Check the spelling, or use a different address.',
};

/** { ok: true } or { ok: false, code, message }. Use for signup, invitations and anywhere a new person's address is accepted. */
export async function checkEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const domain = emailDomain(e);
  if (!domain || !DOMAIN_RE.test(domain) || e.length > 254) return { ok: false, code: 'syntax', message: MESSAGES.syntax };
  const mine = platformDb().prepare('SELECT action FROM email_domain_rules WHERE domain=?').get(domain);
  // a rule for a parent domain covers its subdomains too (mail.example.com is covered by example.com)
  const parents = domain.split('.').map((_, i, a) => a.slice(i).join('.')).filter((d) => d.includes('.'));
  const own = mine || platformDb().prepare(`SELECT action FROM email_domain_rules WHERE domain IN (${parents.map(() => '?').join(',')}) ORDER BY length(domain) DESC LIMIT 1`).get(...parents);
  if (own?.action === 'allow') return { ok: true };
  if (own?.action === 'block') return { ok: false, code: 'disposable', message: MESSAGES.disposable };
  if (blockDisposable() && (parents.some((d) => BUILTIN_DOMAINS.has(d)) || TELLTALE.test(domain))) return { ok: false, code: 'disposable', message: MESSAGES.disposable };
  if (checkMx() && !(await domainReceivesMail(domain))) return { ok: false, code: 'no_mail', message: MESSAGES.no_mail };
  return { ok: true };
}
/** Throws a 400 with a plain message when the address is refused. */
export async function assertEmailAllowed(email) {
  const r = await checkEmail(email);
  if (!r.ok) throw bad(r.message);
}
