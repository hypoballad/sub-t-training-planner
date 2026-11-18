import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { watchPwaUpdates } from '../src/pwa.mjs';

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

function makeUpdateContext({ online = true, hasActive = true, failCheck = false } = {}) {
  const initialWorker = hasActive ? {} : null;
  const registration = Object.assign(new EventTarget(), {
    active: initialWorker, waiting: null, installing: null, checks: 0,
    async update() {
      this.checks += 1;
      if (failCheck) throw new Error('network unavailable');
    },
  });
  const serviceWorker = Object.assign(new EventTarget(), { controller: initialWorker });
  const notice = { hidden: true };
  const button = new EventTarget();
  const sent = [];
  let reloads = 0;
  return {
    registration, serviceWorker, notice, button, sent,
    reloads: () => reloads,
    initialize: () => watchPwaUpdates(registration, serviceWorker, { notice, button, online, reload: () => { reloads += 1; } }),
    install() {
      const candidate = Object.assign(new EventTarget(), {
        state: 'installing',
        postMessage: (data) => sent.push(data),
      });
      registration.installing = candidate;
      registration.dispatchEvent(new Event('updatefound'));
      return candidate;
    },
    wait(candidate) {
      registration.installing = null;
      registration.waiting = candidate;
      candidate.state = 'installed';
      candidate.dispatchEvent(new Event('statechange'));
    },
    activate(candidate) {
      registration.waiting = null;
      registration.active = candidate;
      serviceWorker.controller = candidate;
      serviceWorker.dispatchEvent(new Event('controllerchange'));
    },
  };
}

test('online startup checks for updates and shows a notification once a worker waits', async () => {
  const context = makeUpdateContext();
  await context.initialize();
  assert.equal(context.registration.checks, 1);
  const candidate = context.install();
  assert.equal(context.notice.hidden, true);
  context.wait(candidate);
  assert.equal(context.notice.hidden, false);
  assert.equal(context.button.textContent, '更新する');
  assert.deepEqual(context.sent, []);
  assert.equal(context.reloads(), 0);
});

test('a pending update is shown immediately, including when starting offline', async () => {
  const context = makeUpdateContext({ online: false });
  context.wait(context.install());
  await context.initialize();
  assert.equal(context.registration.checks, 0);
  assert.equal(context.notice.hidden, false);
  assert.equal(context.reloads(), 0);
});

test('first install and network failure do not block use or trigger a reload', async () => {
  const first = makeUpdateContext({ hasActive: false });
  await first.initialize();
  const candidate = first.install();
  first.wait(candidate);
  assert.equal(first.notice.hidden, true);
  first.activate(candidate);
  assert.equal(first.reloads(), 0);
  assert.equal(first.registration.checks, 0);

  const unreachable = makeUpdateContext({ failCheck: true });
  await unreachable.initialize();
  assert.equal(unreachable.registration.checks, 1);
  assert.equal(unreachable.notice.hidden, true);
});

test('a click activates only the waiting worker and reloads once when it takes control', async () => {
  const context = makeUpdateContext();
  await context.initialize();
  context.button.dispatchEvent(new Event('click'));
  assert.deepEqual(context.sent, []);
  const candidate = context.install();
  context.wait(candidate);
  context.button.dispatchEvent(new Event('click'));
  context.button.dispatchEvent(new Event('click'));
  assert.deepEqual(context.sent, ['activate-update']);
  assert.equal(context.button.disabled, true);
  assert.equal(context.reloads(), 0);
  context.activate(candidate);
  context.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(context.reloads(), 1);
});

test('a worker change from another tab does not reload this tab', async () => {
  const context = makeUpdateContext();
  await context.initialize();
  const candidate = context.install();
  context.wait(candidate);
  context.activate(candidate);
  assert.equal(context.notice.hidden, true);
  assert.equal(context.reloads(), 0);
});
