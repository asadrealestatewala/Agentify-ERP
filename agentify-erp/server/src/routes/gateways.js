import { Router } from 'express';
import { can, requireStaff } from '../rbac.js';
import { asyncH } from '../util.js';
import { gatewayList, removeGateway, retryPosting, saveGateway, setGatewayEnabled, staffCheckouts } from '../services/gateways.js';

/** Staff side of the workspace's online payment gateways (Settings > Payment gateways). Keys are accepted here and never sent back. */
const r = Router();
r.use(requireStaff);
const origin = (req) => `${req.protocol}://${req.get('host')}`;
r.get('/', can('settings', 'view'), (req, res) => res.json(gatewayList(origin(req))));
r.put('/:id', can('settings', 'edit'), asyncH(async (req, res) => { await saveGateway(req.params.id, req.body || {}, req); res.json(gatewayList(origin(req)).find((g) => g.id === req.params.id)); }));
r.post('/:id/enabled', can('settings', 'edit'), asyncH((req, res) => { setGatewayEnabled(req.params.id, !!req.body?.enabled, req); res.json({ ok: true }); }));
r.delete('/:id', can('settings', 'edit'), asyncH((req, res) => { removeGateway(req.params.id, req); res.json({ ok: true }); }));
r.get('/checkouts/list', can('payments', 'view'), (_req, res) => res.json(staffCheckouts()));
r.post('/checkouts/:id(\\d+)/retry', can('payments', 'create'), asyncH((req, res) => { retryPosting(Number(req.params.id), req); res.json({ ok: true }); }));
export default r;
