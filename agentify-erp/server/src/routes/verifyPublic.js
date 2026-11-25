import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, notFound } from '../util.js';
import { publicLetter, brandLogoPath } from '../services/allotment.js';

/**
 * Public document verification (no sign-in): the QR code on an allotment letter opens /verify/allotment/<token> on the
 * workspace's own address, and that page reads this API. Only the letter's own copy is returned (no CNIC, phone,
 * e-mail, price or payments); an unknown token answers 404 exactly like a wrong one.
 */
const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));
r.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); next(); });

r.get('/allotment/:token', asyncH((req, res) => {
  const l = publicLetter(req.params.token);
  if (!l) throw notFound('No letter matches this code. It may have been mistyped or is not genuine.');
  res.json(l);
}));
r.get('/allotment/:token/logo', asyncH((req, res) => {
  if (!publicLetter(req.params.token)) throw notFound();
  const p = brandLogoPath();
  if (!p) throw notFound();
  res.sendFile(p);
}));

export default r;
