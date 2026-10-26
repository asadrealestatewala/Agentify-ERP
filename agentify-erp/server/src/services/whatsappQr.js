// QR connection mode for a workspace (opt-in, unofficial). Off unless BOTH the platform switch and this workspace's switch are on,
// and the owner has ticked the risk acknowledgement. The same inbox, limits, 24-hour rule, opt-out handling and no-bulk rule
// apply: this module only changes how a message travels. Sessions, QR codes and keys never leave the server except the QR image.
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { bad } from '../util.js';
import { currentTenant } from '../context.js';
import { saveIntegration, integrationConfig, integrationRow, removeIntegration, logIntegration, markTested } from '../integrations/store.js';
import { qrGateway, gatewayReady } from '../integrations/qrGateway.js';
import { whatsappAccess } from './whatsappAccess.js';

export const QR = 'whatsapp_qr';
export const RISK_TEXT = 'Linking a number by QR code uses an unofficial WhatsApp Web session, which is against WhatsApp\'s terms for business use. WhatsApp can restrict or permanently ban the number, and neither Agentify nor the gateway can undo that. Use a number you can afford to lose, never message people who have not contacted you, and keep the official Botlinkd connection for your main number.';
export const mode = () => (getSetting('whatsapp_mode') === 'qr' ? 'qr' : 'cloud');
export const qrConfig = () => integrationConfig(QR);
const pub = () => { try { return JSON.parse(integrationRow(QR)?.public_info || '{}'); } catch { return {}; } };

export function qrView() {
  const acc = whatsappAccess(currentTenant()), row = integrationRow(QR), cfg = qrConfig(), p = pub();
  return { platform_ready: gatewayReady(), allowed: acc.enabled && gatewayReady(), risk_text: RISK_TEXT, accepted: !!p.accepted_at, accepted_at: p.accepted_at || null,
    active: mode() === 'qr' && !!cfg, state: !cfg ? 'off' : row?.status || 'configured', number: p.number || null };
}

/** Switch the workspace on: needs the platform gateway, the entitlement and a ticked acknowledgement. Nothing is linked yet. */
export function enableQr(user, { acknowledge } = {}) {
  const acc = whatsappAccess(currentTenant());
  if (!gatewayReady()) throw bad('QR connection is not switched on for this platform.');
  if (!acc.enabled) throw bad('WhatsApp is not included in your plan.');
  if (acknowledge !== true) throw bad('Tick the box to confirm you understand the risk to your number.');
  const prev = qrConfig();
  const cfg = prev || { session_id: `ws${currentTenant()?.id ?? 0}-${crypto.randomBytes(6).toString('hex')}`, webhook_token: crypto.randomBytes(24).toString('hex'), signing_secret: crypto.randomBytes(32).toString('hex') };
  saveIntegration(QR, cfg, { publicInfo: { ...pub(), accepted_by: user.id, accepted_at: new Date().toISOString() }, status: integrationRow(QR)?.status || 'configured', userId: user.id });
  logIntegration(QR, 'accept-risk', 'success', null, user.id);
}

/** Ask the gateway for a session; the QR then appears through qrStatus(). */
export async function startQr(user, baseUrl) {
  const cfg = qrConfig();
  if (!cfg || !pub().accepted_at) throw bad('Switch on QR connection first.');
  if (!gatewayReady()) throw bad('QR connection is not switched on for this platform.');
  try { await qrGateway().createSession({ sessionId: cfg.session_id, webhookUrl: `${baseUrl}/api/hooks/whatsapp/${cfg.webhook_token}`, secret: cfg.signing_secret }); }
  catch (e) { markTested(QR, false, e.message); logIntegration(QR, 'start', 'error', e.kind || 'error', user.id); throw bad(`The QR gateway could not start a session: ${e.message}`); }
  setSetting('whatsapp_mode', 'qr');
  logIntegration(QR, 'start', 'success', null, user.id);
}

/** Poll the gateway. Connected marks the connection as working and remembers the linked number. */
export async function qrStatus() {
  const cfg = qrConfig();
  if (!cfg) return { state: 'off' };
  let s;
  try { s = await qrGateway().getSession(cfg.session_id); } catch (e) { return { state: 'error', error: e.message }; }
  const st = ['qr', 'connecting', 'connected', 'disconnected'].includes(s.status) ? s.status : 'connecting';
  if (st === 'connected') {
    const number = String(s.number || '').replace(/\D/g, '').slice(0, 15) || null;
    saveIntegration(QR, cfg, { publicInfo: { ...pub(), number }, status: 'connected' });
  } else if (st === 'disconnected') markTested(QR, false, 'The phone unlinked the session or it ended.');
  return { state: st, qr_image: st === 'qr' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(s.qr_image || '')) ? s.qr_image : null, number: pub().number || null };
}

/** Unlink and forget the session. `forget` also withdraws the acknowledgement (switching QR off for the workspace). */
export async function disconnectQr(user, { forget = false } = {}) {
  const cfg = qrConfig();
  if (cfg) { try { await qrGateway().deleteSession(cfg.session_id); } catch { /* the session may already be gone; we forget our side regardless */ } }
  if (forget || !cfg) removeIntegration(QR);
  else saveIntegration(QR, cfg, { publicInfo: { ...pub(), number: null }, status: 'configured', userId: user.id });
  setSetting('whatsapp_mode', 'cloud');
  logIntegration(QR, forget ? 'switch-off' : 'disconnect', 'success', null, user.id);
}
export const qrSend = (to, message) => qrGateway().sendText({ sessionId: qrConfig().session_id, to, message });
