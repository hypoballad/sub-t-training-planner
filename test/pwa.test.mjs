import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const asset = (path) => new URL(`../${path}`, import.meta.url);
const scope = 'https://example.test/sub-t-training-planner/';
const prefix = `sub-t-training-planner:${scope}:`;
const cacheName = prefix + 'qa-release';
const worker = (await readFile(asset('service-worker.js'), 'utf8')).replace('development-v1', 'qa-release');

function bootWorker({ rejectInstall = false } = {}) {
  const handlers = new Map();
  const cached = new Set();
  const old = prefix + 'old-release';
  const unrelated = 'sub-t-training-planner:https://example.test/other/:old-release';
  const cacheKeys = new Set([old, unrelated]);
  const called = [];
  const caches = {
    has: async (key) => cacheKeys.has(key),
    open: async (key) => {
      cacheKeys.add(key);
      return {
        async addAll(requests) {
          if (rejectInstall) throw new Error('asset unavailable');
          for (const request of requests) {
            assert.equal(request.cache, 'reload');
            cached.add(request.url);
          }
        },
      };
    },
    keys: async () => [...cacheKeys],
    delete: async (key) => cacheKeys.delete(key),
    match: async (key, options) => {
      assert.equal(options.cacheName, cacheName);
      return cached.has(key) ? { cached: key } : undefined;
    },
  };
  runInNewContext(worker, {
    URL, Request, caches,
    fetch: async (request) => ({ network: request.url }),
    self: {
      registration: { scope },
      addEventListener: (name, listener) => handlers.set(name, listener),
      clients: { claim: async () => { called.push('claim'); } },
      skipWaiting: async () => { called.push('skipWaiting'); },
    },
  });
  const dispatch = (name, event = {}) => {
    let pending;
    const hold = (promise) => { pending = promise; };
    handlers.get(name)({ ...event, waitUntil: hold, respondWith: hold });
    return pending;
  };
  return { cached, cacheKeys, old, unrelated, called, dispatch };
}

test('manifest is standalone under the Pages subpath and points to valid home screen icons', async () => {
  const manifest = JSON.parse(await readFile(asset('manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Sub-T Training Planner');
  assert.equal(manifest.display, 'standalone');
  const manifestUrl = new URL('manifest.webmanifest', scope);
  for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], manifestUrl).href, scope);
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
  ]);
  for (const { src, sizes } of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    assert.ok(new URL(src, manifestUrl).href.startsWith(scope));
    const icon = await readFile(asset(src));
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`, sizes);
  }
});

test('precache comes from the registration scope and covers all runtime modules', async () => {
  const { cached, dispatch } = bootWorker();
  await dispatch('install');
  const files = ['index.html', 'style.css', 'manifest.webmanifest',
    ...(await readdir(asset('src'))).map((name) => `src/${name}`),
    ...(await readdir(asset('icons'))).map((name) => `icons/${name}`),
  ];
  assert.deepEqual([...cached].sort(), files.map((file) => new URL(file, scope).href).sort());
});

test('activation cleans previous versions within this app scope', async () => {
  const { dispatch, old, unrelated, cacheKeys, called } = bootWorker();
  await dispatch('install');
  assert.ok(cacheKeys.has(old));
  await dispatch('message', { data: 'activate-update' });
  await dispatch('activate');
  assert.deepEqual([...cacheKeys].sort(), [cacheName, unrelated].sort());
  assert.deepEqual(called, ['skipWaiting', 'claim']);
});

test('a failed install leaves the previous cache available', async () => {
  const { dispatch, cacheKeys, old } = bootWorker({ rejectInstall: true });
  await assert.rejects(dispatch('install'), /asset unavailable/);
  assert.ok(cacheKeys.has(old));
  assert.ok(!cacheKeys.has(cacheName));
});

test('navigations and modules use the cached app while unrelated requests pass through', async () => {
  const { dispatch } = bootWorker();
  const request = (url, mode = 'same-origin', method = 'GET') => dispatch('fetch', { request: { url, mode, method } });
  const index = new URL('index.html', scope).href;
  assert.deepEqual(await request(scope, 'navigate'), { network: scope });
  await dispatch('install');
  assert.deepEqual(await request(scope, 'navigate'), { cached: index });
  assert.deepEqual(await request(`${index}?example=1`, 'navigate'), { cached: index });
  const moduleUrl = new URL('src/engine.mjs', scope).href;
  assert.deepEqual(await request(moduleUrl), { cached: moduleUrl });
  assert.equal(request('https://example.test/other/', 'navigate'), undefined);
  assert.equal(request(moduleUrl.replace('example.test', 'other.test')), undefined);
  assert.equal(request(scope, 'navigate', 'POST'), undefined);
});
