if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  registerOfflineApp().catch((error) => console.warn('Offline setup could not be completed.', error));
}

async function registerOfflineApp() {
  const worker = navigator.serviceWorker;
  const registration = await worker.register(new URL('../service-worker.js', import.meta.url), { updateViaCache: 'none' });
  await watchPwaUpdates(registration, worker, {
    notice: document.getElementById('pwa-update-notice'),
    button: document.getElementById('pwa-update'),
    online: navigator.onLine,
    reload: () => window.location.reload(),
  });
}

export async function watchPwaUpdates(registration, worker, { notice, button, online, reload }) {
  let requestedWorker = null;
  let reloading = false;
  const showWaitingUpdate = () => {
    const updating = requestedWorker !== null || reloading;
    notice.hidden = !updating && !(registration.active && registration.waiting);
    button.disabled = updating;
    button.textContent = updating ? '更新中…' : '更新する';
  };
  const watchInstallation = () => {
    registration.installing?.addEventListener('statechange', showWaitingUpdate);
  };
  registration.addEventListener('updatefound', watchInstallation);
  watchInstallation();
  showWaitingUpdate();

  worker.addEventListener('controllerchange', () => {
    if (requestedWorker && worker.controller === requestedWorker) {
      requestedWorker = null;
      reloading = true;
      reload();
      return;
    }
    showWaitingUpdate();
  });

  button.addEventListener('click', () => {
    if (requestedWorker || reloading) return;
    const waiting = registration.waiting;
    if (!registration.active || !waiting) {
      showWaitingUpdate();
      return;
    }

    requestedWorker = waiting;
    waiting.addEventListener('statechange', () => {
      if (requestedWorker === waiting && waiting.state === 'redundant') {
        requestedWorker = null;
        showWaitingUpdate();
      }
    });
    showWaitingUpdate();
    try {
      waiting.postMessage('activate-update');
    } catch {
      requestedWorker = null;
      showWaitingUpdate();
    }
  });

  // Registering a first-time installation already fetches the worker script.
  if (online && registration.active) {
    try {
      await registration.update();
    } catch {
      // The active worker and its cache remain available if the network check fails.
    }
    showWaitingUpdate();
  }
}
