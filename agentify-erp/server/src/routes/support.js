// In-app support desk, workspace side (mounted at /api/support). Any signed-in staff member can raise tickets and follow
// their own; a workspace's Super Admin role sees all of that workspace's tickets. Tickets are stored on the platform side.
import { Router } from 'express';
import { requireStaff } from '../rbac.js';
import { asyncH } from '../util.js';
import { currentRegion } from '../regions/runtime.js';
import * as S from '../services/supportDesk.js';
import { supportLangs, nativeLang } from '../../../shared/supportDesk.js';

const r = Router();
r.use(requireStaff);
const region = () => currentRegion().config.region;
const sendFile = (res, f) => res.set({ 'Content-Type': f.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' }).send(f.buffer);

r.get('/config', (req, res) => res.json({ region: region(), native: nativeLang(region()), languages: supportLangs(region()), all_tickets: !!req.user.isSuper }));
r.get('/unread', (req, res) => res.json({ unread: S.unreadCount(req.user) }));
r.get('/tickets', (req, res) => res.json(S.listMine(req.user, { status: req.query.status })));
r.post('/tickets', asyncH((req, res) => res.status(201).json(S.createTicket(req.user, req.body || {}, region()))));
r.get('/tickets/:id(\\d+)', (req, res) => res.json(S.getMine(req.user, req.params.id)));
r.post('/tickets/:id(\\d+)/reply', asyncH((req, res) => res.status(201).json(S.customerReply(req.user, req.params.id, req.body || {}))));
r.post('/tickets/:id(\\d+)/status', asyncH((req, res) => res.json(S.customerStatus(req.user, req.params.id, req.body?.status))));
r.get('/tickets/:id(\\d+)/files/:fid(\\d+)', (req, res) => sendFile(res, S.mineFile(req.user, req.params.id, req.params.fid)));
export default r;
