import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoRepository} from '../src/services/demoRepository.ts';
import {DEMO_WASHES} from '../src/data/demo.ts';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  clear() { this.values.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval};

test('demo repository persists report, queue session, favourite and alert workflows', async () => {
  localStorage.clear();
  const repository = new DemoRepository();
  const wash = DEMO_WASHES[0];
  assert.equal((await repository.submitReport({washId: wash.id, kind: 'queue', queueBucket: '1-3', position: wash.position})).verification, 'nearby');
  assert.equal((await repository.startQueueSession(wash.id, wash.position, '1-3')).status, 'active');
  assert.equal((await repository.finishQueueSession('completed')).status, 'completed');
  await repository.toggleFavourite(wash.id, true);
  assert.deepEqual(await repository.getFavouriteIds(), [wash.id]);
  const alert = await repository.createAlert(wash.id, 10);
  assert.equal((await repository.getAlerts())[0].id, alert.id);
  assert.equal((await repository.metrics()).completedWaits, 1);
});
test('demo repository rejects multiple active sessions', async () => {
  localStorage.clear();
  const repository = new DemoRepository();
  await repository.startQueueSession(DEMO_WASHES[0].id, DEMO_WASHES[0].position);
  await assert.rejects(() => repository.startQueueSession(DEMO_WASHES[1].id, DEMO_WASHES[1].position), /active queue timer/);
});
