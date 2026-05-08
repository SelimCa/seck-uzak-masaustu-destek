(function bootstrapIncomingSession() {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('seck-host-session') : null;
  const refs = {
    viewerName: document.querySelector('#viewerName'),
    sessionMeta: document.querySelector('#sessionMeta'),
    deviceCode: document.querySelector('#deviceCode'),
    sessionDuration: document.querySelector('#sessionDuration'),
    statusText: document.querySelector('#statusText'),
    sessionState: document.querySelector('#sessionState'),
    focusMainButton: document.querySelector('#focusMainButton'),
    endSessionButton: document.querySelector('#endSessionButton'),
  };

  const state = {
    active: false,
    startedAt: null,
    timerId: null,
  };

  function formatDuration(startedAt) {
    if (!startedAt) {
      return '00:00';
    }

    const diffSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
    const seconds = String(diffSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function applyState(payload) {
    state.active = Boolean(payload?.active);
    state.startedAt = payload?.startedAt || null;

    refs.viewerName.textContent = payload?.viewerName || 'Baglanti bekleniyor';
    refs.sessionMeta.textContent = payload?.meta || 'Henuz aktif oturum yok.';
    refs.deviceCode.textContent = payload?.deviceCode || '-';
    refs.statusText.textContent = payload?.statusText || 'Gelen baglanti oldugunda burada gorunur.';
    refs.sessionState.textContent = state.active ? 'Aktif' : 'Pasif';
    refs.sessionState.className = `badge ${state.active ? 'online' : 'muted'}`;
    refs.endSessionButton.disabled = !state.active;
    refs.sessionDuration.textContent = formatDuration(state.startedAt);

    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    if (state.active && state.startedAt) {
      state.timerId = setInterval(() => {
        refs.sessionDuration.textContent = formatDuration(state.startedAt);
      }, 1000);
      return;
    }

    setTimeout(() => {
      if (!state.active) {
        window.close();
      }
    }, 1200);
  }

  if (channel) {
    channel.addEventListener('message', (event) => {
      const payload = event.data || {};
      if (payload.type === 'state') {
        applyState(payload);
      }
    });

    channel.postMessage({ type: 'request-state' });
  }

  refs.focusMainButton.addEventListener('click', () => {
    channel?.postMessage({ type: 'focus-main' });
  });

  refs.endSessionButton.addEventListener('click', () => {
    channel?.postMessage({ type: 'end-session' });
  });

  window.addEventListener('beforeunload', () => {
    if (state.timerId) {
      clearInterval(state.timerId);
    }

    channel?.close();
  });
})();
