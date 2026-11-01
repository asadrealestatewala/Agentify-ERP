import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireStaff } from '../rbac.js';
import { asyncH, bad } from '../util.js';
import { currentTenant } from '../context.js';
import { directions, validCoord, PROFILES, NoRoute } from '../services/directions.js';

/**
 * In-app turn-by-turn directions on free OSRM / Valhalla routing (services/directions.js). Staff only, rate limited per user.
 * GET /api/directions?from=lat,lng&to=lat,lng&mode=driving|walking|cycling
 */
const r = Router();
r.use(requireStaff);
const limit = rateLimit({ windowMs: 60_000, limit: Number(process.env.DIRECTIONS_LIMIT) || 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${currentTenant()?.id ?? 'legacy'}:${req.user.id}`, message: { error: 'Too many route requests. Please wait a minute and try again.' } });

const point = (v) => { const [lat, lng] = String(v ?? '').split(',').map((x) => x.trim()); return { lat, lng }; };

r.get('/', limit, asyncH(async (req, res) => {
  const from = point(req.query.from); const to = point(req.query.to);
  if (!validCoord(from)) throw bad('Your starting point is not a valid position');
  if (!validCoord(to)) throw bad('The destination has no valid position');
  const mode = req.query.mode ? String(req.query.mode) : 'driving';
  if (!PROFILES[mode]) throw bad('Travel mode must be driving, walking or cycling');
  try { res.json(await directions(from, to, mode)); } catch (e) {
    if (e instanceof NoRoute) return res.status(404).json({ error: 'No route was found between these two places for this travel mode.', code: 'no_route' });
    res.status(502).json({ error: 'Route directions are not available right now. Use the Navigate button to open your maps app, or try again in a moment.', code: 'routing_unavailable' });
  }
}));

export default r;
