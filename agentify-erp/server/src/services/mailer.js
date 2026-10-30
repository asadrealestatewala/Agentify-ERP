// Outbound email. Provider is chosen by environment so no vendor is hard-wired:
//   RESEND_API_KEY + MAIL_FROM  -> Resend HTTP API (no SMTP library needed)
//   otherwise                   -> written to the server log (development) and kept in `outbox` for tests
import { currentTenant } from '../context.js';
import { getSetting } from '../db.js';

export const outbox = [];
const BILLING_TYPES = ['billing', 'billing_notice'];
/** Sender and Reply-To for billing mail (registered by services/billingMail.js). */
let billingIdentity = () => null;
export const setBillingIdentity = (fn) => { billingIdentity = fn; };
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
 * Branded email: one table-based layout that renders the same in Gmail, Outlook (desktop and web), Apple Mail and phones.
 * Inline styles only (clients strip <style>), a bulletproof button (VML fallback for Outlook), a hidden preheader, an
 * opt-in dark-mode palette, a ~3 KB PNG logo (clients block SVG) and a plain-text twin.
 * brand: 'platform' = Agentify's own identity (Super Admin and platform mail), 'tenant' = the workspace's company details,
 * omitted = tenant inside a workspace, platform outside one. preheader: inbox preview text (defaults to the first line).
 */
export function layout({ heading, lines = [], button, footer, brand, unsubscribe, preheader }) {
  const mode = brand || (currentTenant() ? 'tenant' : 'platform');
  const b = mode === 'platform' ? platformBrand() : tenantBrand();
  const contact = [b.address, b.phone, b.email, b.website].filter(Boolean);
  const text = [heading, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : []), ...(unsubscribe ? ['', `Unsubscribe: ${unsubscribe.url}`] : []), '', `- ${b.name}`, ...(b.tagline ? [b.tagline] : []), ...contact].join('\n');
  const e = escapeHtml;
  const font = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  // the logo is a hosted PNG, so it only appears when the platform's public address is known
  const logo = mode === 'platform' && b.website ? `<td style="padding-right:10px" valign="middle"><img src="${e(b.website.replace(/\/+$/, ''))}/email-logo.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px"></td>` : '';
  const pre = String(preheader ?? lines[0] ?? heading ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const btn = button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td align="center" bgcolor="${TEAL}" class="btn" style="border-radius:8px;background:${TEAL}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${e(button.url)}" style="height:44px;v-text-anchor:middle;width:220px" arcsize="18%" stroke="f" fillcolor="${TEAL}"><w:anchorlock/><center style="color:#ffffff;${font};font-size:16px;font-weight:bold">${e(button.label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${e(button.url)}" style="display:inline-block;padding:13px 24px;${font};font-size:16px;font-weight:bold;line-height:18px;color:#ffffff;text-decoration:none;border-radius:8px;background:${TEAL}">${e(button.label)}</a><!--<![endif]-->
</td></tr></table>
<p style="margin:12px 0 0;${font};font-size:13px;line-height:19px;color:#6b7280" class="mut">Button not working? Copy this link into your browser:<br><a href="${e(button.url)}" style="color:${TEAL};word-break:break-all">${e(button.url)}</a></p>` : '';
  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(heading)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>@media (prefers-color-scheme:dark){.bg{background:#0f1514!important}.card{background:#18201f!important;border-color:#2a3433!important}.hd{color:#f3f4f6!important}.tx{color:#d1d5db!important}.mut{color:#9ca3af!important}.ft{background:#141b1a!important;border-color:#2a3433!important}}@media (max-width:620px){.wrap{width:100%!important}.pad{padding:22px 18px!important}}</style></head>
<body class="bg" style="margin:0;padding:0;background:#f4f6f5;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f6f5">${e(pre)}${'&nbsp;&zwnj;'.repeat(Math.max(0, 40 - Math.ceil(pre.length / 3)))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="#f4f6f5" style="background:#f4f6f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="wrap card" bgcolor="#ffffff" style="width:560px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
<tr><td bgcolor="${TEAL}" style="background:${TEAL};padding:16px 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}<td valign="middle" style="${font};font-size:18px;font-weight:bold;color:#ffffff">${e(b.name)}</td></tr></table></td></tr>
<tr><td class="pad" style="padding:28px 24px 24px;${font};color:#1f2937"><h1 class="hd" style="margin:0 0 16px;${font};font-size:22px;line-height:28px;color:#111827">${e(heading)}</h1>
${lines.map((l) => `<p class="tx" style="margin:0 0 14px;${font};font-size:16px;line-height:24px;color:#374151">${e(l)}</p>`).join('\n')}
${btn}
${footer ? `<p class="mut" style="margin:20px 0 0;${font};font-size:13px;line-height:19px;color:#6b7280">${e(footer)}</p>` : ''}</td></tr>
<tr><td class="ft" bgcolor="#f9fafb" style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 24px;${font};font-size:12px;line-height:19px;color:#6b7280"><strong style="color:#374151" class="hd">${e(b.name)}</strong>${b.tagline ? `<br>${e(b.tagline)}` : ''}${contact.map((c) => `<br>${e(c)}`).join('')}${mode === 'tenant' ? '<br><span style="color:#9ca3af">Sent through Agentify ERP</span>' : ''}${unsubscribe ? `<br><a href="${e(unsubscribe.url)}" style="color:#6b7280">${e(unsubscribe.label || 'Unsubscribe')}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** True when a Resend key is saved (console or environment), i.e. mail really leaves the server. */
export const mailReady = () => { try { return !!((mailConfig() || {}).key || process.env.RESEND_API_KEY); } catch { return !!process.env.RESEND_API_KEY; } };

/** Never throws into the caller: a failed email must not undo a signup or an invite. Returns true when handed to the provider. */
export async function sendMail({ to, subject, text, html, type = 'other', workspaceId = null, replyTo, from }) {
  const msg = { to, subject, text, html, type, at: new Date().toISOString() };
  msg.from = from || (BILLING_TYPES.includes(type) ? billingIdentity()?.from : undefined);
  let cfg = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
  try { cfg = mailConfig() || cfg; } catch { /* platform db not ready: use the environment */ }
  const key = cfg.key;
  // billing mail comes from the billing address and replies land in the billing inbox (services/billingMail.js sets this hook)
  const bill = BILLING_TYPES.includes(type) ? billingIdentity() : null;
  const sender = from || bill?.from || cfg.from;
  const reply = replyTo || bill?.replyTo || cfg.replyTo || undefined;
  const wsId = workspaceId ?? currentTenant()?.id ?? null;
  if (!key) {
    outbox.push(msg); if (outbox.length > MAX_OUTBOX) outbox.shift();
    if (process.env.NODE_ENV !== 'test' && !process.env.ERP_MAIL_QUIET) console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender || 'Agentify ERP <no-reply@example.com>', to: [to], subject, text, html, ...(reply ? { reply_to: reply } : {}) }), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.error('[mail] provider rejected message', res.status); mailLogger({ type, workspaceId: wsId, to, from: sender, subject, status: 'failed' }); return false; }
    let id = null; try { id = (await res.json())?.id || null; } catch { /* no body */ }
    mailLogger({ resendId: id, type, workspaceId: wsId, to, from: sender, subject, status: 'queued' });
    return true;
  } catch (e) { console.error('[mail] send failed', e.message); return false; }
}
