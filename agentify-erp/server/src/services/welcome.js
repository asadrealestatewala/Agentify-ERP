// Welcome messages for new people: where to sign in, the exact login, a one-time temporary password (or an invitation link),
// what happens on first sign-in, and where to get the apps. The same text is shown to the inviting admin (to copy) and emailed.
import crypto from 'node:crypto';

const pick = (chars) => chars[crypto.randomInt(chars.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** A readable one-time password: 12 characters, no look-alikes (0/O, 1/l/I), always upper case + lower case + digits. */
export function tempPassword() {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789';
  const all = U + L + D;
  const out = [pick(U), pick(U), pick(L), pick(L), pick(D), pick(D)];
  while (out.length < 12) out.push(pick(all));
  return shuffle(out).join('');
}

/** Account recovery code: 16 characters in four groups (80 bits). Normalised for comparison. */
export function newRecoveryCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => pick(A)).join('')).join('-');
}
export const normaliseRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const APK_URL = 'https://agentifyerp.co/downloads/agentify-erp.apk';

/**
 * @param {object} o  name, org (workspace/company), role, signInUrl, login, password (temporary) or inviteUrl, hours (link validity),
 *                    downloadUrl (web page with the apps), apk (Android file), product
 * @returns {{subject:string, lines:string[], text:string}}
 */
export function welcomeMessage(o) {
  const product = o.product || 'Agentify ERP';
  const lines = [`Welcome to ${product}${o.name ? `, ${o.name}` : ''}!`];
  lines.push(o.org ? `Your sign-in details for ${o.org}${o.role ? ` (${o.role})` : ''}:` : 'Your sign-in details:');
  if (o.password) {
    lines.push(`1. Open ${o.signInUrl} and choose "Sign in".`);
    lines.push(`2. Email or username: ${o.login}`);
    lines.push(`3. Temporary password: ${o.password}`);
    lines.push(`This password works for your first sign-in only. ${product} then asks you to choose your own password and gives you a recovery code. Keep that code safe: it lets you set a new password if you forget it.`);
  } else {
    lines.push(`1. Open this link and choose your own password: ${o.inviteUrl}`);
    lines.push(`2. The link works once and expires in ${o.hours || 72} hours.`);
    lines.push(`3. Afterwards sign in at ${o.signInUrl} with ${o.login}.`);
  }
  if (o.downloadUrl || o.apk) {
    lines.push(`Apps: ${[o.downloadUrl && `web ${o.downloadUrl}`, o.apk && `Android ${o.apk}`].filter(Boolean).join(' · ')}`);
  }
  lines.push('On every new PC or phone, choose "Sign in" with the same email or username and your own password.');
  return { subject: `Welcome to ${product}${o.org ? ` - ${o.org}` : ''}`, lines, text: lines.join('\n\n') };
}
