// Outbound email. Provider is chosen by environment so no vendor is hard-wired:
//   RESEND_API_KEY + MAIL_FROM  -> Resend HTTP API (no SMTP library needed)
//   otherwise                   -> written to the server log (development) and kept in `outbox` for tests
import { currentTenant } from '../context.js';

export const outbox = [];
/** Where the API key and sender come from (the integration settings register this; environment variables otherwise). */
let mailConfig = () => ({ key: process.env.RESEND_API_KEY || null, from: process.env.MAIL_FROM || null });
export const setMailConfig = (fn) => { mailConfig = fn; };
/** Hook for the sent log (services/emailLog.js); receives one record per message handed to the provider. Never throws. */
let mailLogger = () => {};
export const setMailLogger = (fn) => { mailLogger = (r) => { try { fn(r); } catch { /* logging must not break sending */ } }; };
const MAX_OUTBOX = 100;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Plain, branded-by-tenant email body with one call-to-action button. */
export function layout({ heading, lines = [], button, footer }) {
  const company = currentTenant()?.name || 'Agentify ERP';
  const text = [heading, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : []), '', `- ${company}`].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2937">
<h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${lines.map((l) => `<p style="line-height:1.5">${escapeHtml(l)}</p>`).join('')}
${button ? `<p><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#0e7c6b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(button.label)}</a></p>` : ''}
${footer ? `<p style="color:#6b7280;font-size:13px">${escapeHtml(footer)}</p>` : ''}<p style="color:#6b7280;font-size:13px">${escapeHtml(company)}</p></div>`;
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
