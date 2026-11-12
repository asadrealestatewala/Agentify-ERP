// Outbound requests to addresses a workspace or the console typed in (webhooks, AI base URLs, voice endpoints, site checks)
// must never reach the server's own network. Two layers:
//  1. assertPublicHttps (in integrations.js) checks the URL before it is saved or used;
//  2. guardedDispatcher re-checks every address at connect time, so a name that resolves to a public address during the
//     check and to an internal one a moment later (DNS rebinding) is still refused.
import dns from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';

// IPv4 ranges that are not the public internet (RFC 6890 special-purpose registry, plus CGNAT)
const V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];
// IPv6: unspecified, loopback, IPv4-mapped/translated, discard, documentation, unique-local, link-local, site-local, multicast, 6to4/Teredo
const V6 = [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]];
const blocked = new net.BlockList();
for (const [a, p] of V4) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of V6) blocked.addSubnet(a, p, 'ipv6');

/** True for any address that is not a normal public internet address (also for anything that is not an IP at all). */
export function isPrivateAddress(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v = net.isIP(s);
  if (!v) return true;
  if (v === 6) {
    // IPv4 written inside IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d) is how the IPv4 checks get bypassed; a real public
    // webhook never needs that form, so it is refused whatever IPv4 address it carries
    if (/^::(ffff:)?(0:)?[0-9a-f.:]*$/i.test(s) && s !== '::') return true;
    return blocked.check(s, 'ipv6');
  }
  return blocked.check(s, 'ipv4');
}

/** dns.lookup that refuses to hand back an internal address. */
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return cb(Object.assign(new Error('Internal network addresses are not allowed'), { code: 'EPRIVATEADDR' }));
    if (options?.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

let dispatcher = null;
/** An undici dispatcher for fetch({ dispatcher }) that checks the real address of every connection it opens. */
export function guardedDispatcher() {
  dispatcher ||= new Agent({ connect: { lookup: guardedLookup } });
  return dispatcher;
}

/** fetch() for a URL someone typed in: checked first, then connected only to public addresses. Redirects are never followed. */
export async function publicFetch(url, opts = {}) {
  const { assertPublicHttps } = await import('./integrations.js');
  const safe = await assertPublicHttps(url);
  return fetch(safe, { redirect: 'manual', ...opts, dispatcher: guardedDispatcher() });
}
