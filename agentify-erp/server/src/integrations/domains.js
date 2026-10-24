// Custom domains, the way Shopify does them: the owner types a domain they own, the CRM shows two DNS records to add at
// their registrar, and a Verify button checks them. Only after the check passes does the domain start serving the
// workspace. The domain list lives in the platform database because the request host is resolved before any workspace
// is opened. HTTPS certificates are issued by the web server (see docs/custom-domains.md): the server asks
// GET /api/platform/domain-check?domain=... whether it may issue one.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { platformDb, BASE_DOMAIN, sitesDomain } from '../platform.js';
import { bad, HttpError } from '../util.js';

export const DOMAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS domain_requests(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, domain TEXT NOT NULL UNIQUE COLLATE NOCASE, token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', last_check_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), verified_at TEXT);
`;
let ready = false;
const pdb = () => { const d = platformDb(); if (!ready) { d.exec(DOMAIN_SCHEMA); ready = true; } return d; };

// replaceable in tests
export const resolver = { txt: (n) => dns.resolveTxt(n), cname: (n) => dns.resolveCname(n), a: (n) => dns.resolve4(n) };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
export function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!d || d.includes(':') || d.includes('@') || net.isIP(d)) throw bad('Enter a domain name such as www.yourcompany.com (no http://, no port).');
  const labels = d.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels.at(-1))) throw bad('That does not look like a domain name.');
  if (BASE_DOMAIN && (d === BASE_DOMAIN || d.endsWith(`.${BASE_DOMAIN}`))) throw bad(`Domains ending in ${BASE_DOMAIN} are ours. Use your own domain.`);
  { const sd = sitesDomain(); if (sd && (d === sd || d.endsWith(`.${sd}`))) throw bad(`Domains ending in ${sd} are ours. Use your own domain.`); }
  if (/\.(localhost|local|test|invalid|internal)$/.test(d) && process.env.NODE_ENV === 'production') throw bad('Use a public domain name.');
  return d;
}

export const records = (tenant, req) => {
  const d = pdb().prepare('SELECT * FROM domain_requests WHERE tenant_id=?').get(tenant.id);
  if (!d) return null;
  const target = `${tenant.slug}.${BASE_DOMAIN}`;
  const apex = d.domain.split('.').length === 2;
  return {
    domain: d.domain, status: d.status, verified_at: d.verified_at, last_check_at: d.last_check_at, error: d.last_error,
    records: [
      { type: 'TXT', name: `_agentify-challenge.${d.domain}`, value: d.token, purpose: 'Proves you own the domain' },
      apex ? { type: 'A', name: d.domain, value: process.env.ERP_SERVER_IP || '(your server IP address, shown by your administrator)', purpose: 'Sends visitors to your workspace (apex domains cannot use a CNAME)' }
        : { type: 'CNAME', name: d.domain, value: target, purpose: 'Sends visitors to your workspace' },
    ],
    note: apex ? 'Some registrars call the apex record "@". If you would rather use www.' + d.domain + ', add a CNAME for www pointing to ' + target + '.' : null,
  };
};

export function requestDomain(tenant, input) {
  const domain = normalizeDomain(input);
  const db = pdb();
  const taken = db.prepare('SELECT tenant_id FROM domain_requests WHERE domain=?').get(domain);
  if (taken && taken.tenant_id !== tenant.id) throw bad('That domain is already connected to another workspace.');
  if (db.prepare('SELECT 1 FROM tenants WHERE custom_domain=? AND id<>?').get(domain, tenant.id)) throw bad('That domain is already connected to another workspace.');
  const mine = db.prepare('SELECT * FROM domain_requests WHERE tenant_id=?').get(tenant.id);
  if (mine && mine.domain === domain) return;
  if (mine) db.prepare('DELETE FROM domain_requests WHERE tenant_id=?').run(tenant.id);
  db.prepare("UPDATE tenants SET custom_domain=NULL WHERE id=?").run(tenant.id);
  db.prepare('INSERT INTO domain_requests(tenant_id, domain, token) VALUES(?,?,?)').run(tenant.id, domain, `agentify-verify-${crypto.randomBytes(16).toString('hex')}`);
}

/** Checks the two DNS records. Succeeds only when the TXT proof matches and the domain points at us. */
export async function verifyDomain(tenant) {
  const db = pdb();
  const d = db.prepare('SELECT * FROM domain_requests WHERE tenant_id=?').get(tenant.id);
  if (!d) throw bad('Add a domain first.');
  const target = `${tenant.slug}.${BASE_DOMAIN}`;
  const fail = (msg) => { db.prepare("UPDATE domain_requests SET last_check_at=datetime('now'), last_error=?, status='pending' WHERE id=?").run(msg, d.id); throw bad(msg); };
  let txt = [];
  try { txt = (await resolver.txt(`_agentify-challenge.${d.domain}`)).map((x) => x.join('')); } catch { /* no record */ }
  if (!txt.includes(d.token)) fail(`We could not find the TXT record yet. Add a TXT record named _agentify-challenge.${d.domain} with the value shown, then wait a few minutes (DNS can take up to an hour) and try again.`);
  let pointsHere = false;
  try { pointsHere = (await resolver.cname(d.domain)).some((c) => c.replace(/\.$/, '').toLowerCase() === target); } catch { /* not a CNAME */ }
  if (!pointsHere && process.env.ERP_SERVER_IP) { try { pointsHere = (await resolver.a(d.domain)).includes(process.env.ERP_SERVER_IP); } catch { /* none */ } }
  if (!pointsHere) fail(`The TXT record is correct, but ${d.domain} does not point to your workspace yet. Add the ${d.domain.split('.').length === 2 ? 'A' : 'CNAME'} record shown and try again.`);
  db.prepare("UPDATE domain_requests SET status='verified', verified_at=datetime('now'), last_check_at=datetime('now'), last_error=NULL WHERE id=?").run(d.id);
  db.prepare("UPDATE tenants SET custom_domain=?, updated_at=datetime('now') WHERE id=?").run(d.domain, tenant.id);
  return { domain: d.domain };
}

export function removeDomain(tenant) {
  const db = pdb();
  db.prepare('DELETE FROM domain_requests WHERE tenant_id=?').run(tenant.id);
  db.prepare("UPDATE tenants SET custom_domain=NULL, updated_at=datetime('now') WHERE id=?").run(tenant.id);
}

/** For the web server's on-demand certificate check: only domains a customer verified, plus our own subdomains. */
export function mayIssueCertificate(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return false;
  // the platform host and its www form are ours, and the app already treats both as the marketing site
  if (BASE_DOMAIN && (d === BASE_DOMAIN || d === `www.${BASE_DOMAIN}`)) return true;
  // our own subdomains: only for workspaces that exist, so strangers cannot make the server request certificates for made-up names
  if (BASE_DOMAIN && d.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = d.slice(0, -(BASE_DOMAIN.length + 1));
    return /^[a-z0-9-]{1,63}$/.test(slug) && !!pdb().prepare('SELECT 1 FROM tenants WHERE slug=?').get(slug);
  }
  // the free-websites domain: its apex (redirects to the marketing site) and the subdomains of free websites that exist
  const sd = sitesDomain();
  if (sd && (d === sd || d.endsWith(`.${sd}`))) {
    if (d === sd) return true;
    const slug = d.slice(0, -(sd.length + 1));
    return /^[a-z0-9-]{1,63}$/.test(slug) && !!pdb().prepare("SELECT 1 FROM tenants WHERE slug=? AND product='website' AND status='active'").get(slug);
  }
  return !!pdb().prepare("SELECT 1 FROM domain_requests WHERE domain=? AND status='verified'").get(d);
}
export { HttpError };
