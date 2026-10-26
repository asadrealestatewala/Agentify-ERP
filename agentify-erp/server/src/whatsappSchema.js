// Workspace-database tables for the WhatsApp inbox: conversations, messages and opt-outs. Additive (CREATE IF NOT EXISTS).
// The connection keys are not here: they live encrypted in tenant_integrations (integrations/store.js), provider 'botlinkd'.
export const WHATSAPP_SCHEMA = `
CREATE TABLE IF NOT EXISTS wa_threads(
  id INTEGER PRIMARY KEY, wa_id TEXT NOT NULL UNIQUE, contact_id INTEGER, display_name TEXT, assigned_to INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), unread INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT, last_inbound_at TEXT, last_preview TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wa_threads_last ON wa_threads(last_message_at);
CREATE INDEX IF NOT EXISTS idx_wa_threads_contact ON wa_threads(contact_id);
-- one row per message. event_id (the provider's event id) makes a repeated delivery of the same inbound message a no-op.
CREATE TABLE IF NOT EXISTS wa_messages(
  id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')), type TEXT NOT NULL DEFAULT 'text', body TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','sent','failed')), provider_ref TEXT, event_id TEXT, user_id INTEGER, error TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wa_msg_thread ON wa_messages(thread_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_msg_event ON wa_messages(event_id) WHERE event_id IS NOT NULL;
-- a number that asked us to stop: nothing is sent to it until it writes START or staff lift the block
CREATE TABLE IF NOT EXISTS wa_optouts(wa_id TEXT PRIMARY KEY, reason TEXT, source TEXT, created_at TEXT NOT NULL, removed_at TEXT);
`;
