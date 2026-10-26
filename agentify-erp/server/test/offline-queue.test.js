// Offline queue (client/src/api.js): saved field actions belong to the user and workspace that saved them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = new EventTarget();
globalThis.location = { host: 'acme.agentifyerp.co' };
let online = false;
const sent = [];
globalThis.fetch = async (url, opts) => {
  if (!online) throw new TypeError('Failed to fetch');
  sent.push({ url, method: opts.method, body: opts.body });
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const q = await import('../../client/src/api.js');
const KEY = 'erp-offline-queue';
const reset = () => { store.clear(); sent.length = 0; online = false; };

test('offline actions are stamped with the signed-in user and workspace address', async () => {
  reset();
  q.setQueueOwner({ id: 7 });
  const r = await q.api.post('/api/notes', { body: 'met client' });
  assert.deepEqual(r, { queued: true, offline: true });
  const [item] = q.readQueue();
  assert.equal(item.uid, 'staff:7');
  assert.equal(item.host, 'acme.agentifyerp.co');
  assert.equal(q.myQueue().length, 1);
});

test('nothing is queued when nobody is signed in', async () => {
  reset();
  q.setQueueOwner(null);
  await assert.rejects(q.api.post('/api/notes', { body: 'x' }), /offline/);
  assert.equal(q.readQueue().length, 0);
});

test("another user's saved actions are kept, not replayed, and replay once their owner signs in", async () => {
  reset();
  q.setQueueOwner({ id: 7 });
  await q.api.post('/api/tasks', { title: 'call back' });
  q.setQueueOwner({ id: 9 }); // someone else signs in on the same phone
  online = true;
  await q.flushQueue();
  assert.equal(sent.length, 0);
  assert.equal(q.readQueue().length, 1);
  assert.equal(q.myQueue().length, 0);
  q.setQueueOwner({ id: 7 });
  await new Promise((resolve) => window.addEventListener('erp:synced', resolve, { once: true }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/tasks');
  assert.equal(q.readQueue().length, 0);
});

test('a portal user with the same id as a staff member does not get their actions', async () => {
  reset();
  q.setQueueOwner({ id: 7 });
  await q.api.post('/api/notes', { body: 'x' });
  q.setQueueOwner({ id: 7, portal: true });
  online = true;
  await q.flushQueue();
  assert.equal(sent.length, 0);
  assert.equal(q.readQueue().length, 1);
});

test('items saved on another workspace address are not replayed here', async () => {
  reset();
  store.set(KEY, JSON.stringify([{ id: 1, uid: 'staff:7', host: 'other.agentifyerp.co', method: 'POST', url: '/api/notes', body: {} }]));
  q.setQueueOwner({ id: 7 });
  online = true;
  await q.flushQueue();
  assert.equal(sent.length, 0);
  assert.equal(q.readQueue().length, 1);
});

test('legacy items without an owner are discarded unsent and reported', async () => {
  reset();
  store.set(KEY, JSON.stringify([{ id: 1, method: 'POST', url: '/api/notes', body: { body: 'old' } }]));
  online = true;
  const reported = new Promise((resolve) => window.addEventListener('erp:synced', (e) => resolve(e.detail), { once: true }));
  q.setQueueOwner({ id: 7 }); // signing in replays (and here cleans up) the queue
  const { failed } = await reported;
  assert.equal(sent.length, 0);
  assert.equal(q.readQueue().length, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /discarded/);
});
