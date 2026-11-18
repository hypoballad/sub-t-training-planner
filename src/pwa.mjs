if ('serviceWorker' in navigator) {
  registerOfflineApp().catch((error) => console.warn('Offline setup could not be completed.', error));
}

async function registerOfflineApp() {
  const updateButton = document.getElementById('pwa-update');
  const worker = navigator.serviceWorker;
  const registration = await worker.register(new URL('../service-worker.js', import.meta.url), { updateViaCache: 'none' });
  let reloadAfterUpdate = false;

  const showWaitingUpdate = () => {
    updateButton.hidden = !registration.waiting;
  };
  const watchInstallation = () => {
    registration.installing?.addEventListener('statechange', showWaitingUpdate);
  };
  registration.addEventListener('updatefound', watchInstallation);
  watchInstallation();
  showWaitingUpdate();

  worker.addEventListener('controllerchange', () => {
    if (reloadAfterUpdate) window.location.reload();
    else showWaitingUpdate();
  });
  updateButton.addEventListener('click', () => {
    updateButton.disabled = true;
    reloadAfterUpdate = true;
    if (registration.waiting) registration.waiting.postMessage('activate-update');
    else window.location.reload();
  });
}
