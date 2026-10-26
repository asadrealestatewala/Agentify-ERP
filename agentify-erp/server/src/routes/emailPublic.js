// Public unsubscribe (no sign-in): GET shows a confirmation page, POST applies it. POST also serves the one-click
// "List-Unsubscribe-Post" header mail apps send. The signed token is bound to this workspace and the address.
import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, HttpError } from '../util.js';
import { readUnsubscribeToken, applyUnsubscribe, fireOptOut } from '../services/emailConsent.js';
import { cancelQueued } from '../services/tenantEmail.js';
import { tenantBrand } from '../services/mailer.js';
import { currentTenant } from '../context.js';

const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:12vh auto;padding:0 16px;color:#1f2937"><h2>${esc(title)}</h2>${body}</body>`;

r.get('/:token', (req, res) => {
  const email = readUnsubscribeToken(req.params.token);
  res.type('html').status(email ? 200 : 400).send(email
    ? page('Unsubscribe', `<p>Stop marketing email from <strong>${esc(tenantBrand().name)}</strong> to <strong>${esc(email)}</strong>?</p><form method="post"><button style="background:#0e7c6b;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-size:16px">Unsubscribe</button></form>`)
    : page('This link is not valid', '<p>The unsubscribe link is invalid or belongs to another sender.</p>'));
});
r.post('/:token', express.urlencoded({ extended: false }), asyncH((req, res) => {
  const email = readUnsubscribeToken(req.params.token);
  if (!email) throw new HttpError(400, 'This unsubscribe link is not valid.');
  applyUnsubscribe(email, req.body?.['List-Unsubscribe'] ? 'one_click' : 'unsubscribe_link');
  cancelQueued(currentTenant().id, email, 'marketing', 'suppressed');
  fireOptOut(email, 'unsubscribed');
  if (req.get('accept')?.includes('json')) return res.json({ ok: true });
  res.type('html').send(page('You are unsubscribed', `<p>${esc(email)} will no longer receive marketing email from ${esc(tenantBrand().name)}. Messages about appointments or your account may still be sent.</p>`));
}));
export default r;
