(function bootstrap() {
  const $ = (selector) => document.querySelector(selector);

  const refs = {
    socketBadge: $('#socketBadge'),
    sessionBadge: $('#sessionBadge'),
    reconnectButton: $('#reconnectButton'),
    appVersion: $('#appVersion'),
    deviceName: $('#deviceName'),
    deviceCode: $('#deviceCode'),
    rollingPassword: $('#rollingPassword'),
    rollingCountdown: $('#rollingCountdown'),
    fixedPasswordInput: $('#fixedPasswordInput'),
    savePasswordButton: $('#savePasswordButton'),
    refreshLicenseButton: $('#refreshLicenseButton'),
    requestLicenseButton: $('#requestLicenseButton'),
    checkUpdatesButton: $('#checkUpdatesButton'),
    clearPasswordButton: $('#clearPasswordButton'),
    shareScreenButton: $('#shareScreenButton'),
    licenseStatus: $('#licenseStatus'),
    hostStatus: $('#hostStatus'),
    connectedViewer: $('#connectedViewer'),
    localPreview: $('#localPreview'),
    targetCodeInput: $('#targetCodeInput'),
    targetPasswordInput: $('#targetPasswordInput'),
    targetAliasInput: $('#targetAliasInput'),
    connectButton: $('#connectButton'),
    saveContactButton: $('#saveContactButton'),
    viewerStatus: $('#viewerStatus'),
    savedList: $('#savedList'),
    savedHint: $('#savedHint'),
    tabAllButton: $('#tabAllButton'),
    tabFavoritesButton: $('#tabFavoritesButton'),
    tabRecentButton: $('#tabRecentButton'),
    fileInput: $('#fileInput'),
    sendFileButton: $('#sendFileButton'),
    transferStatus: $('#transferStatus'),
    openAdminPanelButton: $('#openAdminPanelButton'),
    adminPanel: $('#adminPanel'),
    closeAdminPanelButton: $('#closeAdminPanelButton'),
    adminUnlockModal: $('#adminUnlockModal'),
    adminUnlockInput: $('#adminUnlockInput'),
    adminUnlockSubmitButton: $('#adminUnlockSubmitButton'),
    adminUnlockCloseButton: $('#adminUnlockCloseButton'),
    adminTabRequestsButton: $('#adminTabRequestsButton'),
    adminTabLicensesButton: $('#adminTabLicensesButton'),
    adminRefreshButton: $('#adminRefreshButton'),
    adminStatus: $('#adminStatus'),
    adminRequestsView: $('#adminRequestsView'),
    adminLicensesView: $('#adminLicensesView'),
    adminLicenseDeviceCodeInput: $('#adminLicenseDeviceCodeInput'),
    adminLicenseNameInput: $('#adminLicenseNameInput'),
    adminLicenseExpiryInput: $('#adminLicenseExpiryInput'),
    adminLicensePresetSelect: $('#adminLicensePresetSelect'),
    adminLicenseDaysInput: $('#adminLicenseDaysInput'),
    adminLicenseActiveInput: $('#adminLicenseActiveInput'),
    adminSaveLicenseButton: $('#adminSaveLicenseButton'),
    adminLicensesList: $('#adminLicensesList'),
  };

  const DEVICE_BOOK_KEY = 'seck-device-book-v1';
  const SESSION_CHANNEL_NAME = 'seck-host-session';

  const state = {
    config: null,
    socket: null,
    localStream: null,
    peerConnection: null,
    dataChannel: null,
    activePeerSocketId: null,
    hostDisplayInfo: null,
    incomingFile: null,
    selectedSourceId: null,
    savedFilter: 'all',
    activeViewerName: '',
    adminTab: 'requests',
    adminDashboard: { requests: [], licenses: [], source: '' },
    sessionStartedAt: null,
    incomingSessionWindow: null,
    sessionChannel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SESSION_CHANNEL_NAME) : null,
  };

  function setBadge(element, text, type) {
    if (!element) {
      return;
    }

    element.textContent = text;
    element.className = `badge ${type}`;
  }

  function setText(element, text) {
    if (element) {
      element.textContent = text;
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateActiveViewerUi() {
    const hasActiveSession = Boolean(state.activePeerSocketId);
    const viewerLabel = state.activeViewerName || 'Bilinmeyen istemci';
    setText(refs.connectedViewer, hasActiveSession ? `Bagli istemci: ${viewerLabel}` : 'Bagli istemci yok.');

    publishHostSessionState();
  }

  function publishHostSessionState() {
    if (!state.sessionChannel) {
      return;
    }

    state.sessionChannel.postMessage({
      type: 'state',
      active: Boolean(state.activePeerSocketId),
      viewerName: state.activeViewerName || 'Baglanti bekleniyor',
      deviceCode: state.config?.deviceCode || '',
      startedAt: state.sessionStartedAt,
      statusText: refs.hostStatus?.textContent || 'Gelen baglanti oldugunda burada gorunur.',
      meta: state.activePeerSocketId
        ? `${state.activeViewerName || 'Bir istemci'} bagli. Gorev cubugundan yonetebilirsin.`
        : 'Henuz aktif oturum yok.',
    });
  }

  function openIncomingSessionWindow() {
    if (state.incomingSessionWindow && !state.incomingSessionWindow.closed) {
      state.incomingSessionWindow.focus();
      publishHostSessionState();
      return;
    }

    state.incomingSessionWindow = window.open(
      './incoming-session.html',
      'seck-incoming-session',
      'width=520,height=620,menubar=no,toolbar=no,location=no,status=no'
    );

    setTimeout(() => {
      publishHostSessionState();
    }, 150);
  }

  function openAdminUnlockModal() {
    refs.adminUnlockModal.classList.remove('hidden');
    refs.adminUnlockInput.value = '';
    refs.adminUnlockInput.focus();
  }

  function closeAdminUnlockModal() {
    refs.adminUnlockModal.classList.add('hidden');
    refs.adminUnlockInput.value = '';
  }

  function openAdminPanel() {
    if (!state.config?.adminAuthorized) {
      return;
    }

    refs.adminPanel.classList.remove('hidden');
    setText(refs.adminStatus, 'Yonetim paneli acildi.');
  }

  function closeAdminPanel() {
    refs.adminPanel.classList.add('hidden');

    if (refs.endSessionButton) {
      refs.endSessionButton.disabled = !hasActiveSession;
    }
  }

  function setAdminStatus(message) {
    setText(refs.adminStatus, message || 'Yonetim hazir.');
  }

  function normalizeCode(input) {
    return String(input || '').replace(/[^0-9]/g, '');
  }

  function formatCode(input) {
    const compact = normalizeCode(input);
    if (compact.length !== 9) {
      return String(input || '').trim();
    }

    return `${compact.slice(0, 3)}-${compact.slice(3, 6)}-${compact.slice(6, 9)}`;
  }

  function buildIceServers() {
    const servers = [{ urls: 'stun:stun.l.google.com:19302' }];

    if (state.config?.turnServerUrl) {
      servers.push({
        urls: state.config.turnServerUrl,
        username: state.config.turnUsername || '',
        credential: state.config.turnPassword || '',
      });
    }

    return servers;
  }

  function loadBook() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DEVICE_BOOK_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object') {
        return { devices: {} };
      }

      return {
        devices: parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
      };
    }
    catch {
      return { devices: {} };
    }
  }

  function saveBook(book) {
    localStorage.setItem(DEVICE_BOOK_KEY, JSON.stringify(book));
  }

  function upsertDevice(code, patch) {
    const formatted = formatCode(code);
    if (!formatted || normalizeCode(formatted).length !== 9) {
      return;
    }

    const book = loadBook();
    const current = book.devices[formatted] || {
      code: formatted,
      alias: '',
      lastKnownName: '',
      favorite: false,
      lastConnectedAt: 0,
      thumbnailDataUrl: '',
    };

    book.devices[formatted] = {
      ...current,
      ...patch,
      code: formatted,
    };

    saveBook(book);
    renderSavedDevices();
  }

  function removeDevice(code) {
    const formatted = formatCode(code);
    const book = loadBook();
    delete book.devices[formatted];
    saveBook(book);
    renderSavedDevices();
  }

  function placeholderThumb(code) {
    const label = encodeURIComponent(code);
    return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%23ff9f43'/><stop offset='100%' stop-color='%232be4c6'/></linearGradient></defs><rect width='480' height='270' fill='url(%23g)'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI' font-size='34' fill='white'>${label}</text></svg>`;
  }

  function getFilteredDevices() {
    const devices = Object.values(loadBook().devices || {});

    if (state.savedFilter === 'favorites') {
      return devices.filter((item) => item.favorite).sort((a, b) => (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0));
    }

    if (state.savedFilter === 'recent') {
      return devices
        .filter((item) => (item.lastConnectedAt || 0) > 0)
        .sort((a, b) => (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0));
    }

    return devices.sort((a, b) => {
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }

      return (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0);
    });
  }

  function renderSavedDevices() {
    const devices = getFilteredDevices();

    if (!devices.length) {
      refs.savedList.innerHTML = '<p class="help">Henuz kayitli bilgisayar yok.</p>';
      return;
    }

    refs.savedList.innerHTML = devices.map((item) => {
      const name = item.alias || item.lastKnownName || 'Adsiz Bilgisayar';
      const thumb = item.thumbnailDataUrl || placeholderThumb(item.code);
      const dateText = item.lastConnectedAt ? new Date(item.lastConnectedAt).toLocaleString('tr-TR') : 'Henuz baglanilmadi';
      return `
        <article class="saved-card" data-code="${item.code}">
          <img class="saved-thumb" src="${thumb}" alt="${name}">
          <div class="saved-meta">
            <div class="saved-name">${name}</div>
            <div class="saved-code">Kod: ${item.code}</div>
            <div class="saved-code">Son: ${dateText}</div>
            <div class="saved-actions">
              <button data-action="connect" data-code="${item.code}">Baglan</button>
              <button data-action="favorite" data-code="${item.code}">${item.favorite ? 'Favoriden Cikar' : 'Favori Yap'}</button>
              <button data-action="rename" data-code="${item.code}">Adlandir</button>
              <button data-action="delete" data-code="${item.code}">Sil</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function setActiveTab(filter) {
    state.savedFilter = filter;
    refs.tabAllButton.classList.toggle('active', filter === 'all');
    refs.tabFavoritesButton.classList.toggle('active', filter === 'favorites');
    refs.tabRecentButton.classList.toggle('active', filter === 'recent');
    renderSavedDevices();
  }

  function updateConfigView() {
    if (!state.config) {
      return;
    }

    setText(refs.appVersion, `v${state.config.appVersion || '0.1.0'}`);
    setText(refs.deviceName, state.config.deviceName);
    setText(refs.deviceCode, state.config.deviceCode);
    setText(refs.rollingPassword, state.config.rollingPassword);
    setText(refs.rollingCountdown, `${state.config.rollingPasswordTtl} sn sonra yenilenir`);
    refs.fixedPasswordInput.placeholder = state.config.hasFixedPassword
      ? 'Sabit sifre aktif, degistirmek icin yeni sifre gir'
      : 'Istersen sabit sifre belirle';

    const licenseState = state.config.licenseStatus || { ok: false, message: 'Lisans kontrol ediliyor...' };
    const statusParts = [licenseState.message || 'Lisans kontrol ediliyor...'];
    if (licenseState.deviceCode) {
      statusParts.push(`Bilgisayar Kodu: ${licenseState.deviceCode}`);
    }
    setText(refs.licenseStatus, statusParts.join(' '));

    if (!licenseState.ok) {
      setBadge(refs.socketBadge, 'Lisans gerekli', 'danger');
    }

    refs.openAdminPanelButton.classList.toggle('hidden', !state.config.adminAuthorized);
    if (!state.config.adminAuthorized) {
      closeAdminPanel();
    }
  }

  async function refreshConfig() {
    state.config = await window.anydeksApi.getConfig();

    if (state.socket && !canUseRemoteFeatures()) {
      state.socket.removeAllListeners();
      state.socket.disconnect();
      state.socket = null;
    }

    updateConfigView();
  }

  function canUseRemoteFeatures() {
    return Boolean(state.config?.licenseStatus?.ok);
  }

  function getLicenseMessage() {
    return state.config?.licenseStatus?.message || 'Lisans gerekli.';
  }

  function setAdminTab(tab) {
    state.adminTab = tab;
    refs.adminTabRequestsButton.classList.toggle('active', tab === 'requests');
    refs.adminTabLicensesButton.classList.toggle('active', tab === 'licenses');
    refs.adminRequestsView.classList.toggle('hidden', tab !== 'requests');
    refs.adminLicensesView.classList.toggle('hidden', tab !== 'licenses');
  }

  async function handleAdminUnlock() {
    const result = await window.anydeksApi.authorizeAdmin(refs.adminUnlockInput.value);
    setText(refs.hostStatus, result.message || 'Yonetici modu sonucu alinamadi.');
    if (!result.ok) {
      return;
    }

    closeAdminUnlockModal();
    await refreshConfig();
    await refreshAdminDashboard();
    setAdminTab('requests');
    openAdminPanel();
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function resolveExpiryFromPreset(preset) {
    const now = new Date();

    if (preset === '1m') {
      now.setMonth(now.getMonth() + 1);
      return toIsoDate(now);
    }

    if (preset === '3m') {
      now.setMonth(now.getMonth() + 3);
      return toIsoDate(now);
    }

    if (preset === '6m') {
      now.setMonth(now.getMonth() + 6);
      return toIsoDate(now);
    }

    if (preset === '1y') {
      now.setFullYear(now.getFullYear() + 1);
      return toIsoDate(now);
    }

    if (preset === 'forever') {
      return '';
    }

    if (preset === 'days') {
      const days = Number(refs.adminLicenseDaysInput.value);
      if (!Number.isInteger(days) || days <= 0) {
        throw new Error('Ozel gun sayisi pozitif bir tam sayi olmali.');
      }

      now.setDate(now.getDate() + days);
      return toIsoDate(now);
    }

    return refs.adminLicenseExpiryInput.value.trim();
  }

  function syncExpiryPreset() {
    const preset = refs.adminLicensePresetSelect.value;
    if (preset === 'custom') {
      return;
    }

    refs.adminLicenseExpiryInput.value = resolveExpiryFromPreset(preset);
  }

  function populateAdminLicenseForm(item = {}) {
    refs.adminLicenseDeviceCodeInput.value = item.deviceCode || '';
    refs.adminLicenseNameInput.value = item.name || '';
    refs.adminLicenseExpiryInput.value = item.expires || '';
    refs.adminLicensePresetSelect.value = 'custom';
    refs.adminLicenseDaysInput.value = '';
    refs.adminLicenseActiveInput.checked = item.active !== false;
  }

  function renderAdminRequests() {
    const requests = (state.adminDashboard.requests || []).filter((item) => item.status !== 'approved');
    if (!requests.length) {
      refs.adminRequestsView.innerHTML = '<p class="help">Bekleyen lisans talebi yok.</p>';
      return;
    }

    refs.adminRequestsView.innerHTML = requests.map((item) => `
      <article class="admin-card">
        <div class="admin-card-title">${escapeHtml(item.deviceCode)}</div>
        <div class="admin-card-meta">Bilgisayar Adi: ${escapeHtml(item.deviceName || '-')}</div>
        <div class="admin-card-meta">Surum: ${escapeHtml(item.appVersion || '-')}</div>
        <div class="admin-card-meta">Durum: ${escapeHtml(item.status || 'pending')}</div>
        <div class="admin-card-meta">Tarih: ${escapeHtml(new Date(item.updatedAt || item.requestedAt || Date.now()).toLocaleString('tr-TR'))}</div>
        <div class="admin-card-actions">
          <button data-admin-action="approve-request" data-code="${escapeHtml(item.deviceCode)}" data-name="${escapeHtml(item.deviceName || '')}">Onayla</button>
          <button data-admin-action="fill-request" data-code="${escapeHtml(item.deviceCode)}" data-name="${escapeHtml(item.deviceName || '')}">Lisans Formuna Al</button>
          <button data-admin-action="delete-request" data-code="${escapeHtml(item.deviceCode)}">Sil</button>
        </div>
      </article>
    `).join('');
  }

  function renderAdminLicenses() {
    const licenses = state.adminDashboard.licenses || [];
    if (!licenses.length) {
      refs.adminLicensesList.innerHTML = '<p class="help">Kayitli lisans yok.</p>';
      return;
    }

    refs.adminLicensesList.innerHTML = licenses.map((item) => `
      <article class="admin-card">
        <div class="admin-card-title">${escapeHtml(item.deviceCode)}</div>
        <div class="admin-card-meta">Ad: ${escapeHtml(item.name || '-')}</div>
        <div class="admin-card-meta">Durum: ${item.active ? 'Aktif' : 'Pasif'}</div>
        <div class="admin-card-meta">Son kullanma: ${escapeHtml(item.expires || '-')}</div>
        <div class="admin-card-actions">
          <button data-admin-action="edit-license" data-code="${escapeHtml(item.deviceCode)}">Duzenle</button>
          <button data-admin-action="delete-license" data-code="${escapeHtml(item.deviceCode)}">Sil</button>
        </div>
      </article>
    `).join('');
  }

  function renderAdminDashboard() {
    renderAdminRequests();
    renderAdminLicenses();
  }

  async function refreshAdminDashboard() {
    if (!state.config?.adminAuthorized) {
      return;
    }

    state.adminDashboard = await window.anydeksApi.getAdminDashboard();
    renderAdminDashboard();
  }

  function attachSocketHandlers(socket) {
    socket.on('connect', () => {
      setBadge(refs.socketBadge, 'Sunucuya bagli', 'online');
      socket.emit('host:register', {
        deviceCode: state.config.deviceCode,
        deviceName: state.config.deviceName,
      });
    });

    socket.on('disconnect', () => {
      setBadge(refs.socketBadge, 'Sunucuya bagli degil', 'offline');
    });

    socket.on('session:request', async ({ viewerSocketId, viewerName, credential }) => {
      if (state.peerConnection || state.activePeerSocketId) {
        socket.emit('session:response', {
          viewerSocketId,
          accepted: false,
          reason: 'Bu bilgisayarda zaten aktif bir oturum var.',
        });
        return;
      }

      const validation = await window.anydeksApi.validateCredential(credential);
      if (!validation.ok) {
        socket.emit('session:response', {
          viewerSocketId,
          accepted: false,
          reason: 'Sifre dogrulanamadi.',
        });
        return;
      }

      try {
        await ensureLocalStream();
        state.hostDisplayInfo = await window.anydeksApi.getDisplayInfo();
        state.activePeerSocketId = viewerSocketId;
        state.activeViewerName = viewerName || 'Bir istemci';
        state.sessionStartedAt = Date.now();
        updateActiveViewerUi();
        openIncomingSessionWindow();
        setText(refs.hostStatus, `${viewerName || 'Bir istemci'} baglandi. Oturum aciliyor...`);
        publishHostSessionState();
        socket.emit('session:response', {
          viewerSocketId,
          accepted: true,
          hostInfo: {
            deviceName: state.config.deviceName,
          },
        });
        setBadge(refs.sessionBadge, 'Gelen baglanti kabul edildi', 'warn');
      }
      catch (error) {
        socket.emit('session:response', {
          viewerSocketId,
          accepted: false,
          reason: `Ekran paylasimi hazirlanamadi: ${error.message}`,
        });
      }
    });

    socket.on('signal:relay', async ({ from, payload }) => {
      try {
        if (state.activePeerSocketId && from !== state.activePeerSocketId) {
          return;
        }

        if (payload.description?.type === 'offer') {
          await createHostPeer();
          await state.peerConnection.setRemoteDescription(payload.description);
          const answer = await state.peerConnection.createAnswer();
          await state.peerConnection.setLocalDescription(answer);
          socket.emit('signal:relay', {
            to: from,
            payload: { description: state.peerConnection.localDescription },
          });
          return;
        }

        if (payload.candidate && state.peerConnection) {
          await state.peerConnection.addIceCandidate(payload.candidate);
        }
      }
      catch (error) {
        setText(refs.viewerStatus, `Sinyal hatasi: ${error.message}`);
      }
    });

    socket.on('session:ended', ({ from, reason }) => {
      if (state.activePeerSocketId && from !== state.activePeerSocketId) {
        return;
      }

      resetHostSession();
      setText(refs.hostStatus, reason || 'Uzak istemci oturumu sonlandirdi.');
      setText(refs.transferStatus, 'Oturum kapandi.');
    });
  }

  async function ensureSocket() {
    if (!canUseRemoteFeatures()) {
      throw new Error(getLicenseMessage());
    }

    if (state.socket?.connected) {
      return state.socket;
    }

    if (state.socket) {
      state.socket.removeAllListeners();
      state.socket.disconnect();
    }

    state.socket = window.io(state.config.signalServerUrl, {
      transports: ['websocket'],
      reconnection: true,
    });

    attachSocketHandlers(state.socket);
    return state.socket;
  }

  async function ensureLocalStream() {
    if (state.localStream && state.localStream.active) {
      return state.localStream;
    }

    const sources = await window.anydeksApi.listDesktopSources();
    if (!sources.length) {
      throw new Error('Paylasilacak ekran bulunamadi.');
    }

    let sourceId = state.selectedSourceId;
    if (!sourceId || !sources.some((source) => source.id === sourceId)) {
      sourceId = sources[0].id;
    }

    if (sources.length > 1) {
      const choice = window.prompt(
        ['Paylasilacak ekran numarasini gir:', ...sources.map((source, index) => `${index + 1}. ${source.name}`)].join('\n'),
        '1'
      );

      if (choice === null) {
        throw new Error('Ekran secimi iptal edildi.');
      }

      const choiceIndex = Number(choice) - 1;
      if (Number.isInteger(choiceIndex) && sources[choiceIndex]) {
        sourceId = sources[choiceIndex].id;
      }
    }

    state.selectedSourceId = sourceId;
    await window.anydeksApi.setDesktopSource(sourceId);

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          frameRate: { ideal: 24, max: 24 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
        },
      });
    }
    catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('constraint') && !message.includes('supported')) {
        throw error;
      }

      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
    }

    const [videoTrack] = stream.getVideoTracks();
    videoTrack.addEventListener('ended', () => {
      state.localStream = null;
      refs.localPreview.srcObject = null;
      refs.localPreview.classList.add('hidden');
      setText(refs.hostStatus, 'Paylasilan ekran kapandi. Yeni oturum icin tekrar secim yapmalisin.');
    });

    state.localStream = stream;
    refs.localPreview.srcObject = stream;
    refs.localPreview.classList.remove('hidden');
    setText(refs.hostStatus, 'Ekran paylasimi hazir.');
    return stream;
  }

  function resetHostSession() {
    if (state.dataChannel) {
      state.dataChannel.close();
      state.dataChannel = null;
    }

    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }

    state.activePeerSocketId = null;
    state.activeViewerName = '';
    state.sessionStartedAt = null;
    updateActiveViewerUi();
    setBadge(refs.sessionBadge, 'Oturum yok', 'muted');
    publishHostSessionState();
  }

  function endActiveSession(reason = 'Host oturumu sonlandirdi.') {
    const targetSocketId = state.activePeerSocketId;
    if (targetSocketId && state.socket) {
      state.socket.emit('session:end', {
        to: targetSocketId,
        reason,
      });
    }

    resetHostSession();
    setText(refs.hostStatus, 'Oturumu sonlandirdin.');
    setText(refs.transferStatus, 'Oturum kapandi.');
    publishHostSessionState();
  }

  async function createHostPeer() {
    if (state.peerConnection) {
      return state.peerConnection;
    }

    const stream = await ensureLocalStream();
    const peer = new RTCPeerConnection({ iceServers: buildIceServers() });
    state.peerConnection = peer;

    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || !state.activePeerSocketId) {
        return;
      }

      state.socket.emit('signal:relay', {
        to: state.activePeerSocketId,
        payload: { candidate },
      });
    };

    peer.onconnectionstatechange = () => {
      const currentState = peer.connectionState;
      if (currentState === 'connected') {
        setBadge(refs.sessionBadge, 'Oturum aktif', 'online');
        updateActiveViewerUi();
        openIncomingSessionWindow();
        publishHostSessionState();
      }

      if (['failed', 'disconnected', 'closed'].includes(currentState)) {
        resetHostSession();
        setText(refs.hostStatus, 'Baglanti kesildi veya kapandi.');
      }
    };

    peer.ondatachannel = ({ channel }) => {
      setupDataChannel(channel);
    };

    return peer;
  }

  function setupDataChannel(channel) {
    state.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      setText(refs.transferStatus, 'Veri kanali hazir. Dosya gonderebilirsin.');
    };

    channel.onclose = () => {
      state.dataChannel = null;
      setText(refs.transferStatus, 'Veri kanali kapandi.');
    };

    channel.onmessage = async (event) => {
      await handleChannelMessage(event.data);
    };
  }

  async function handleChannelMessage(data) {
    if (typeof data === 'string') {
      const message = JSON.parse(data);

      if (message.kind === 'input') {
        const translated = translateInputPayload(message.payload);
        await window.anydeksApi.performInput(translated);
        return;
      }

      if (message.kind === 'file-meta') {
        state.incomingFile = {
          name: message.fileName,
          size: message.size,
          chunks: [],
          received: 0,
        };
        setText(refs.transferStatus, `${message.fileName} aliniyor...`);
        return;
      }

      if (message.kind === 'file-end' && state.incomingFile) {
        const merged = mergeChunks(state.incomingFile.chunks, state.incomingFile.received);
        const result = await window.anydeksApi.saveIncomingFile({
          fileName: state.incomingFile.name,
          bytes: Array.from(merged),
        });
        setText(refs.transferStatus, `Dosya kaydedildi: ${result.filePath}`);
        state.incomingFile = null;
      }
      return;
    }

    const buffer = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
    if (!state.incomingFile) {
      return;
    }

    state.incomingFile.chunks.push(buffer);
    state.incomingFile.received += buffer.byteLength;
  }

  function mergeChunks(chunks, totalLength) {
    const merged = new Uint8Array(totalLength);
    let offset = 0;

    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });

    return merged;
  }

  function translateInputPayload(payload) {
    if (!state.hostDisplayInfo) {
      return payload;
    }

    if (payload.type === 'move' || payload.type === 'click' || payload.type === 'doubleClick') {
      return {
        ...payload,
        x: Math.round(payload.xNorm * state.hostDisplayInfo.width),
        y: Math.round(payload.yNorm * state.hostDisplayInfo.height),
      };
    }

    return payload;
  }

  async function handleSendFile() {
    const file = refs.fileInput.files?.[0];
    if (!file) {
      setText(refs.transferStatus, 'Once bir dosya sec.');
      return;
    }

    if (state.dataChannel?.readyState !== 'open') {
      setText(refs.transferStatus, 'Aktif baglanti yok. Dosya gonderilemedi.');
      return;
    }

    state.dataChannel.send(JSON.stringify({
      kind: 'file-meta',
      fileName: file.name,
      size: file.size,
    }));

    const buffer = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      state.dataChannel.send(buffer.slice(offset, offset + chunkSize));
    }

    state.dataChannel.send(JSON.stringify({ kind: 'file-end' }));
    setText(refs.transferStatus, `${file.name} gonderildi.`);
  }

  function openRemoteWindow(code, credential, alias) {
    const targetCode = formatCode(code);
    if (normalizeCode(targetCode).length !== 9) {
      setText(refs.viewerStatus, 'Hedef kod 9 rakam olmali.');
      return;
    }

    const remoteUrl = new URL('./remote.html', window.location.href);
    remoteUrl.searchParams.set('targetCode', targetCode);
    remoteUrl.searchParams.set('credential', credential);
    remoteUrl.searchParams.set('viewerName', state.config.deviceName);
    remoteUrl.searchParams.set('signalServerUrl', state.config.signalServerUrl);
    remoteUrl.searchParams.set('turnServerUrl', state.config.turnServerUrl || '');
    remoteUrl.searchParams.set('turnUsername', state.config.turnUsername || '');
    remoteUrl.searchParams.set('turnPassword', state.config.turnPassword || '');

    upsertDevice(targetCode, {
      alias: String(alias || '').trim(),
      lastConnectedAt: Date.now(),
    });

    window.open(
      remoteUrl.toString(),
      '_blank',
      'width=1600,height=900,menubar=no,toolbar=no,location=no,status=no'
    );

    setText(refs.viewerStatus, 'Uzak ekran penceresi acildi.');
  }

  function installSavedListActions() {
    refs.savedList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) {
        return;
      }

      const code = button.getAttribute('data-code') || '';
      const action = button.getAttribute('data-action');
      const devices = loadBook().devices || {};
      const device = devices[code];
      if (!device) {
        return;
      }

      if (action === 'connect') {
        refs.targetCodeInput.value = code;
        refs.targetAliasInput.value = device.alias || '';
        if (!refs.targetPasswordInput.value.trim()) {
          setText(refs.viewerStatus, 'Bu bilgisayara baglanmak icin sifreyi gir.');
          return;
        }

        openRemoteWindow(code, refs.targetPasswordInput.value, device.alias || '');
        return;
      }

      if (action === 'favorite') {
        upsertDevice(code, { favorite: !device.favorite });
        return;
      }

      if (action === 'rename') {
        const alias = window.prompt('Bu bilgisayara yeni ad ver:', device.alias || device.lastKnownName || code);
        if (alias === null) {
          return;
        }

        upsertDevice(code, { alias: alias.trim() });
        return;
      }

      if (action === 'delete') {
        if (window.confirm(`${code} kaydini silmek istiyor musun?`)) {
          removeDevice(code);
        }
      }
    });
  }

  function installUiListeners() {
    refs.reconnectButton.addEventListener('click', async () => {
      try {
        await ensureSocket();
        setText(refs.viewerStatus, 'Baglanti yeniden denendi.');
      }
      catch (error) {
        setText(refs.viewerStatus, error.message);
      }
    });

    refs.savePasswordButton.addEventListener('click', async () => {
      state.config = await window.anydeksApi.setFixedPassword(refs.fixedPasswordInput.value);
      refs.fixedPasswordInput.value = '';
      updateConfigView();
      setText(refs.hostStatus, state.config.hasFixedPassword ? 'Sabit sifre kaydedildi.' : 'Sabit sifre devre disi birakildi.');
    });

    refs.clearPasswordButton.addEventListener('click', async () => {
      state.config = await window.anydeksApi.setFixedPassword('');
      updateConfigView();
      setText(refs.hostStatus, 'Sabit sifre temizlendi.');
    });

    refs.openAdminPanelButton.addEventListener('click', () => openAdminPanel());
    refs.closeAdminPanelButton.addEventListener('click', () => closeAdminPanel());
    refs.appVersion.addEventListener('dblclick', () => openAdminUnlockModal());
    refs.adminUnlockCloseButton.addEventListener('click', () => closeAdminUnlockModal());
    refs.adminUnlockSubmitButton.addEventListener('click', async () => handleAdminUnlock());
    refs.adminUnlockInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        await handleAdminUnlock();
      }
      if (event.key === 'Escape') {
        closeAdminUnlockModal();
      }
    });

    refs.refreshLicenseButton.addEventListener('click', async () => {
      state.config = await window.anydeksApi.refreshLicenseStatus();
      updateConfigView();

      if (!canUseRemoteFeatures()) {
        setText(refs.hostStatus, getLicenseMessage());
        return;
      }

      try {
        await ensureSocket();
        setText(refs.hostStatus, 'Lisans yenilendi ve baglanti servisi hazir.');
      }
      catch (error) {
        setText(refs.hostStatus, error.message);
      }
    });

    refs.requestLicenseButton.addEventListener('click', async () => {
      try {
        const result = await window.anydeksApi.requestLicense();
        setText(refs.hostStatus, result?.message || 'Lisans talebi gonderildi.');
      }
      catch (error) {
        setText(refs.hostStatus, `Lisans talebi gonderilemedi: ${error.message}`);
      }
    });

    refs.checkUpdatesButton.addEventListener('click', async () => {
      const result = await window.anydeksApi.checkForUpdates();
      if (!result?.ok) {
        setText(refs.hostStatus, result?.message || 'Guncelleme kontrolu baslatilamadi.');
      }
    });

    refs.shareScreenButton.addEventListener('click', async () => {
      try {
        if (!canUseRemoteFeatures()) {
          throw new Error(getLicenseMessage());
        }

        await ensureLocalStream();
      }
      catch (error) {
        setText(refs.hostStatus, `Ekran secimi iptal edildi veya hata olustu: ${error.message}`);
      }
    });

    refs.saveContactButton.addEventListener('click', () => {
      const code = formatCode(refs.targetCodeInput.value);
      if (normalizeCode(code).length !== 9) {
        setText(refs.savedHint, 'Kaydetmek icin 9 rakamli bilgisayar kodu gir.');
        return;
      }

      upsertDevice(code, {
        alias: refs.targetAliasInput.value.trim(),
      });
      setText(refs.savedHint, `${code} kaydedildi.`);
    });

    refs.connectButton.addEventListener('click', async () => {
      const code = formatCode(refs.targetCodeInput.value);
      const credential = refs.targetPasswordInput.value.trim();
      const alias = refs.targetAliasInput.value.trim();

      if (normalizeCode(code).length !== 9 || !credential) {
        setText(refs.viewerStatus, 'Baglanmak icin 9 rakamli hedef kod ve sifre gir.');
        return;
      }

      try {
        await ensureSocket();
        openRemoteWindow(code, credential, alias);
      }
      catch (error) {
        setText(refs.viewerStatus, error.message);
      }
    });

    refs.sendFileButton.addEventListener('click', handleSendFile);

    refs.tabAllButton.addEventListener('click', () => setActiveTab('all'));
    refs.tabFavoritesButton.addEventListener('click', () => setActiveTab('favorites'));
    refs.tabRecentButton.addEventListener('click', () => setActiveTab('recent'));
    refs.adminTabRequestsButton.addEventListener('click', () => setAdminTab('requests'));
    refs.adminTabLicensesButton.addEventListener('click', () => setAdminTab('licenses'));
    refs.adminRefreshButton.addEventListener('click', async () => {
      await refreshAdminDashboard();
      setAdminStatus('Yonetim listeleri yenilendi.');
    });
    refs.adminLicensePresetSelect.addEventListener('change', syncExpiryPreset);
    refs.adminLicenseDaysInput.addEventListener('input', () => {
      if (refs.adminLicensePresetSelect.value !== 'days') {
        return;
      }

      try {
        refs.adminLicenseExpiryInput.value = resolveExpiryFromPreset('days');
      }
      catch {
        refs.adminLicenseExpiryInput.value = '';
      }
    });
    refs.adminSaveLicenseButton.addEventListener('click', async () => {
      try {
        state.adminDashboard = await window.anydeksApi.upsertLicense({
          deviceCode: refs.adminLicenseDeviceCodeInput.value,
          name: refs.adminLicenseNameInput.value,
          expires: resolveExpiryFromPreset(refs.adminLicensePresetSelect.value),
          active: refs.adminLicenseActiveInput.checked,
        });
        await refreshConfig();
        renderAdminDashboard();
        setAdminTab('licenses');
        setAdminStatus('Lisans kaydi guncellendi. Ana ekrandaki lisans durumu yenilendi.');
      }
      catch (error) {
        setAdminStatus(error.message);
      }
    });
    refs.adminRequestsView.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-admin-action]');
      if (!button) {
        return;
      }

      const action = button.getAttribute('data-admin-action');
      const deviceCode = button.getAttribute('data-code') || '';
      const deviceName = button.getAttribute('data-name') || '';

      if (action === 'fill-request') {
        populateAdminLicenseForm({ deviceCode, name: deviceName, active: true, expires: '' });
        setAdminTab('licenses');
        setAdminStatus(`${deviceCode} lisans formuna alindi.`);
        return;
      }

      if (action === 'approve-request') {
        try {
          state.adminDashboard = await window.anydeksApi.approveLicenseRequest({
            deviceCode,
            name: deviceName || deviceCode,
            expires: resolveExpiryFromPreset(refs.adminLicensePresetSelect.value),
          });
          await refreshConfig();
          renderAdminDashboard();
          setAdminStatus(`${deviceCode} icin lisans onaylandi.`);
        }
        catch (error) {
          setAdminStatus(error.message);
        }
        return;
      }

      if (action === 'delete-request') {
        if (!window.confirm(`${deviceCode} lisans talebi silinsin mi?`)) {
          return;
        }

        const requests = await window.anydeksApi.deleteLicenseRequest(deviceCode);
        state.adminDashboard.requests = requests;
        renderAdminRequests();
        setAdminStatus(`${deviceCode} talebi silindi.`);
      }
    });
    refs.adminLicensesList.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-admin-action]');
      if (!button) {
        return;
      }

      const action = button.getAttribute('data-admin-action');
      const deviceCode = button.getAttribute('data-code') || '';
      const item = (state.adminDashboard.licenses || []).find((entry) => entry.deviceCode === deviceCode);
      if (!item) {
        return;
      }

      if (action === 'edit-license') {
        populateAdminLicenseForm(item);
        return;
      }

      if (action === 'delete-license') {
        if (!window.confirm(`${deviceCode} lisansi silinsin mi?`)) {
          return;
        }

        state.adminDashboard = await window.anydeksApi.deleteLicense(deviceCode);
        await refreshConfig();
        renderAdminDashboard();
        setAdminStatus(`${deviceCode} lisansi silindi.`);
      }
    });

    window.anydeksApi.onOpenAdminPanel(() => {
      openAdminPanel();
      setAdminTab('requests');
      refreshAdminDashboard().catch(() => {});
      setAdminStatus('Yeni lisans talebi bildirimi acildi.');
    });

    installSavedListActions();

    if (state.sessionChannel) {
      state.sessionChannel.addEventListener('message', (event) => {
        const payload = event.data || {};
        if (payload.type === 'request-state') {
          publishHostSessionState();
          return;
        }

        if (payload.type === 'focus-main') {
          window.focus();
          return;
        }

        if (payload.type === 'end-session' && state.activePeerSocketId) {
          endActiveSession('Oturum yonetici tarafindan sonlandirildi.');
        }
      });
    }
  }

  function listenRemoteUpdates() {
    window.addEventListener('storage', (event) => {
      if (event.key === DEVICE_BOOK_KEY) {
        renderSavedDevices();
      }
    });
  }

  async function initialize() {
    await refreshConfig();

    try {
      await ensureSocket();
    }
    catch (error) {
      setText(refs.viewerStatus, error.message);
    }

    installUiListeners();
    listenRemoteUpdates();
    renderSavedDevices();
    updateActiveViewerUi();
    if (state.config?.adminAuthorized) {
      await refreshAdminDashboard();
    }
    setAdminTab('requests');

    setInterval(refreshConfig, 1000);
    setInterval(() => {
      if (!state.config?.adminAuthorized) {
        return;
      }

      refreshAdminDashboard().catch(() => {});
    }, 4000);
  }

  window.addEventListener('beforeunload', () => {
    if (state.activePeerSocketId && state.socket) {
      state.socket.emit('session:end', {
        to: state.activePeerSocketId,
        reason: 'Host uygulamasi kapatildi.',
      });
    }

    if (state.peerConnection) {
      state.peerConnection.close();
    }
    if (state.socket) {
      state.socket.disconnect();
    }
    if (state.sessionChannel) {
      state.sessionChannel.close();
    }
  });

  initialize().catch((error) => {
    setText(refs.viewerStatus, `Baslatma hatasi: ${error.message}`);
  });
})();
