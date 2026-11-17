// GET /api/hifi-one/summary: read by Hifi One's server every 15 minutes with the key made in the console
// (Integrations → Hifi One). Platform domain only, Bearer key, counts only. ?next= is the cursor from the previous page.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { onPlatformHost } from '../services/platformAuth.js';
import { keyOk, summary } from '../services/hifiOne.js';

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
r.get('/summary', limiter, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!onPlatformHost(req)) return res.status(404).json({ error: 'Not found' });
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.get('authorization') || ''));
  if (!m || !keyOk(m[1])) return res.status(401).json({ error: 'Wrong or missing key. Make a key in the Agentify console under Integrations → Hifi One.' });
  res.json(summary(req.query.next));
});
export default r;
