// Free website-only accounts: where they are served (a separate domain a super admin sets in the console), whether
// signup is open, and a DNS check for that domain. Nothing is served or accepted until the domain is set and signup is
// switched on, so a free site can never appear on the app's own domain.
import dns from 'node:dns/promises';
import { platformDb, BASE_DOMAIN, isMultiTenant, sitesDomain, forgetSitesDomain } from '../platform.js';
import { bad } from '../util.js';
import { getSetting, setSetting } from './platformConfig.js';

const HOST_RE = /^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** Are free websites open for signup right now? Needs a multi-tenant server, a sites domain and the switch on. */
export const freeSitesOpen = () => isMultiTenant() && !!sitesDomain() && getSetting('free_sites_open') === '1';

export function freeSitesConfig() {
  const domain = sitesDomain();
  const n = platformDb().prepare("SELECT COUNT(*) n FROM tenants WHERE product='website'").get().n;
  return {
    domain: domain || '', open: getSetting('free_sites_open') === '1', effective_open: freeSitesOpen(), sites: n, multi_tenant: isMultiTenant(), base_domain: BASE_DOMAIN,
    dns: domain ? { records: [{ type: 'A', name: `*.${domain}`, note: 'every free website' }, { type: 'A', name: domain, note: 'the bare domain (it sends visitors to the marketing site)' }], server_ip: process.env.ERP_SERVER_IP || null } : null,
  };
}

/** Save the free-websites domain and the signup switch. Returns the new configuration. */
export function saveFreeSites({ domain, open }, by) {
  const d = String(domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (d) {
    if (!HOST_RE.test(d)) throw bad('Enter a domain such as agentifysites.co (letters, digits and hyphens, no https:// or path)');
    if (BASE_DOMAIN && (d === BASE_DOMAIN || d.endsWith(`.${BASE_DOMAIN}`) || BASE_DOMAIN.endsWith(`.${d}`))) throw bad(`The free-websites domain must be separate from ${BASE_DOMAIN}. That separation is what keeps free sites away from the app.`);
    const taken = platformDb().prepare('SELECT slug FROM tenants WHERE custom_domain=? OR custom_domain LIKE ?').get(d, `%.${d}`);
    if (taken) throw bad(`A workspace (${taken.slug}) already uses ${d} as its own domain`);
  }
  if (open && !d) throw bad('Set the domain before opening free website signup');
  setSetting('free_sites_domain', d, { by });
  setSetting('free_sites_open', open ? '1' : '', { by });
  forgetSitesDomain();
  return freeSitesConfig();
}

/** Does DNS send the domain (and any name under it) to this server? Uses a made-up name to test the wildcard record. */
export async function checkFreeSitesDns(resolver = dns) {
  const d = sitesDomain();
  if (!d) throw bad('Set the domain first');
  const probe = `dns-check-${Math.random().toString(36).slice(2, 8)}.${d}`;
  const look = async (h) => { try { return (await resolver.resolve4(h)).sort(); } catch { return []; } };
  const [wildcard, apex] = [await look(probe), await look(d)];
  const ip = process.env.ERP_SERVER_IP || null;
  const same = (a) => !!ip && a.length > 0 && a.every((x) => x === ip);
  return { domain: d, wildcard, apex, server_ip: ip, wildcard_ok: ip ? same(wildcard) : wildcard.length > 0, apex_ok: ip ? same(apex) : apex.length > 0,
    note: ip ? null : 'ERP_SERVER_IP is not set on the server, so the addresses are shown but not compared with this server.' };
}
