// Outbound email. Provider is chosen by environment so no vendor is hard-wired:
//   RESEND_API_KEY + MAIL_FROM  -> Resend HTTP API (no SMTP library needed)
//   otherwise                   -> written to the server log (development) and kept in `outbox` for tests
import { currentTenant } from '../context.js';
import { getSetting } from '../db.js';

export const outbox = [];
/** Where the API key and sender come from (the integration settings register this; environment variables otherwise). */
let mailConfig = () => ({ key: process.env.RESEND_API_KEY || null, from: process.env.MAIL_FROM || null });
export const setMailConfig = (fn) => { mailConfig = fn; };
/** Hook for the sent log (services/emailLog.js); receives one record per message handed to the provider. Never throws. */
let mailLogger = () => {};
export const setMailLogger = (fn) => { mailLogger = (r) => { try { fn(r); } catch { /* logging must not break sending */ } }; };
const MAX_OUTBOX = 100;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TEAL = '#0e7c6b';
/** Platform identity shown on every Agentify-owned mail (signup, billing, console, support). */
export function platformBrand() {
  let support = process.env.PLATFORM_SUPPORT_EMAIL || '';
  try { support = support || (mailConfig() || {}).replyTo || ''; } catch { /* platform db not ready */ }
  const domain = (process.env.ERP_BASE_DOMAIN || '').trim().toLowerCase();
  const site = process.env.PLATFORM_WEBSITE || (domain && domain !== 'localhost' ? `https://${domain}` : '');
  return { name: 'Agentify ERP', tagline: 'CRM and ERP for real estate and construction', website: site, email: support, address: '', phone: '', logo: '' };
}
/** The current workspace's own identity (Settings > Company and printing); falls back to the workspace name. */
export function tenantBrand() {
  const g = (k) => { try { return getSetting(k) || ''; } catch { return ''; } };
  return { name: g('print_header') || g('company_name') || currentTenant()?.name || 'Agentify ERP', tagline: '', website: g('print_website'), email: g('print_email') || g('company_email'), address: g('print_address') || g('company_address'), phone: g('print_phone') || g('company_phone'), logo: '' };
}

/**
 * Branded email body with one call-to-action button.
 * brand: 'platform' = Agentify's own identity (Super Admin and platform mail), 'tenant' = the workspace's company details,
 * omitted = tenant inside a workspace, platform outside one.
 */
export function layout({ heading, lines = [], button, footer, brand, unsubscribe }) {
  const mode = brand || (currentTenant() ? 'tenant' : 'platform');
  const b = mode === 'platform' ? platformBrand() : tenantBrand();
  const contact = [b.address, b.phone, b.email, b.website].filter(Boolean);
  const text = [heading, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : []), ...(unsubscribe ? ['', `Unsubscribe: ${unsubscribe.url}`] : []), '', `- ${b.name}`, ...(b.tagline ? [b.tagline] : []), ...contact].join('\n');
  const mark = mode === 'platform'
    ? `<span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#fff;color:${TEAL};border-radius:8px;font-weight:bold;vertical-align:middle;margin-right:8px">A</span>`
    : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f2937;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
<div style="background:${TEAL};color:#fff;padding:16px 24px;font-size:16px;font-weight:bold">${mark}${escapeHtml(b.name)}</div>
<div style="padding:24px"><h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${lines.map((l) => `<p style="line-height:1.5">${escapeHtml(l)}</p>`).join('')}
${button ? `<p><a href="${escapeHtml(button.url)}" style="display:inline-block;background:${TEAL};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(button.label)}</a></p>` : ''}
${footer ? `<p style="color:#6b7280;font-size:13px">${escapeHtml(footer)}</p>` : ''}</div>
<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 24px;color:#6b7280;font-size:12px;line-height:1.6"><strong style="color:#374151">${escapeHtml(b.name)}</strong>${b.tagline ? `<br>${escapeHtml(b.tagline)}` : ''}${contact.map((c) => `<br>${escapeHtml(c)}`).join('')}${mode === 'tenant' ? '<br><span style="color:#9ca3af">Sent through Agentify ERP</span>' : ''}${unsubscribe ? `<br><a href="${escapeHtml(unsubscribe.url)}" style="color:#6b7280">${escapeHtml(unsubscribe.label || 'Unsubscribe')}</a>` : ''}</div></div>`;
  return { text, html };
}

/** True when a Resend key is saved (console or environment), i.e. mail really leaves the server. */
export const mailReady = () => { try { return !!((mailConfig() || {}).key || process.env.RESEND_API_KEY); } catch { return !!process.env.RESEND_API_KEY; } };

/** Never throws into the caller: a failed email must not undo a signup or an invite. Returns true when handed to the provider. */
export async function sendMail({ to, subject, text, html, type = 'other', workspaceId = null, replyTo }) {
  const msg = { to, subject, text, html, type, at: new Date().toISOString() };
  let cfg = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
  try { cfg = mailConfig() || cfg; } catch { /* platform db not ready: use the environment */ }
  const key = cfg.key;
  const reply = replyTo || cfg.replyTo || undefined;
  const wsId = workspaceId ?? currentTenant()?.id ?? null;
  if (!key) {
    outbox.push(msg); if (outbox.length > MAX_OUTBOX) outbox.shift();
    if (process.env.NODE_ENV !== 'test' && !process.env.ERP_MAIL_QUIET) console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from || 'Agentify ERP <no-reply@example.com>', to: [to], subject, text, html, ...(reply ? { reply_to: reply } : {}) }), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.error('[mail] provider rejected message', res.status); mailLogger({ type, workspaceId: wsId, to, from: cfg.from, subject, status: 'failed' }); return false; }
    let id = null; try { id = (await res.json())?.id || null; } catch { /* no body */ }
    mailLogger({ resendId: id, type, workspaceId: wsId, to, from: cfg.from, subject, status: 'queued' });
    return true;
  } catch (e) { console.error('[mail] send failed', e.message); return false; }
}
