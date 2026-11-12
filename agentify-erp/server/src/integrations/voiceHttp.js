// A generic voice provider for countries where Twilio is not the right fit (Pakistan: local robocall / bulk-voice
// services). The provider is reached over HTTPS with an API key: the workspace owner enters the provider's call endpoint,
// the key and the caller number, and the CRM posts a small JSON body for each call. Providers differ, so the body field
// names can be mapped; the provider's own documentation decides the values. Only public https endpoints are allowed.
import { guardedDispatcher } from '../services/netGuard.js';
import { bad } from '../util.js';
import { assertPublicHttps } from '../services/integrations.js';

export function validateVoiceHttp(c) {
  const out = { endpoint: String(c.endpoint || '').trim(), api_key: String(c.api_key || '').trim(), from_number: String(c.from_number || '').trim(), auth_header: String(c.auth_header || 'Authorization').trim(), auth_prefix: String(c.auth_prefix ?? 'Bearer ').trimStart(),
    field_to: String(c.field_to || 'to').trim(), field_from: String(c.field_from || 'from').trim(), field_agent: String(c.field_agent || 'agent').trim() };
  if (!out.endpoint) throw bad('Enter the provider\'s call endpoint (an https:// address from their API documentation).');
  if (!out.api_key) throw bad('Enter the API key from your provider account.');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(out.auth_header)) throw bad('The header name may contain letters, digits and hyphens only.');
  return out;
}

async function call(c, body) {
  await assertPublicHttps(c.endpoint);
  const res = await fetch(c.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', [c.auth_header]: `${c.auth_prefix}${c.api_key}` }, body: JSON.stringify(body), redirect: 'error', dispatcher: guardedDispatcher() });
  let data = null; try { data = await res.json(); } catch { /* provider may answer with text */ }
  if (!res.ok) throw new Error(data?.message || data?.error || `The provider answered ${res.status}`);
  return data || {};
}

/** Sends the provider's endpoint a dry "ping" with test=true; providers that reject unknown fields should answer with their own error. */
export async function testVoiceHttp(c) { await call(c, { test: true }); return { endpoint_host: new URL(c.endpoint).host }; }
export async function startVoiceCall(c, { to, agentNumber }) {
  const r = await call(c, { [c.field_to]: to, [c.field_from]: c.from_number, [c.field_agent]: agentNumber });
  return { sid: String(r.id || r.call_id || r.sid || ''), status: 'queued' };
}
