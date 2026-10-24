// A tiny in-process event bus. Code that changes listings, projects or leads announces it here without knowing who listens
// (the outbound webhooks do, see webhooksOut.js), so those modules do not have to import each other.
const handlers = new Map();
export const on = (name, fn) => handlers.set(name, [...(handlers.get(name) || []), fn]);
export function publish(name, ...args) {
  for (const fn of handlers.get(name) || []) { try { fn(...args); } catch (e) { console.error(`[event ${name}]`, e.message); } }
}
