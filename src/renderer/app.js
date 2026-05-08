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
    licenseKeyInput: $('#licenseKeyInput'),
    savePasswordButton: $('#savePasswordButton'),
    saveLicenseButton: $('#saveLicenseButton'),
    checkUpdatesButton: $('#checkUpdatesButton'),
    clearPasswordButton: $('#clearPasswordButton'),
    shareScreenButton: $('#shareScreenButton'),
    licenseStatus: $('#licenseStatus'),
    hostStatus: $('#hostStatus'),
    connectedViewer: $('#connectedViewer'),
    endSessionButton: $('#endSessionButton'),
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
  };

  const DEVICE_BOOK_KEY = 'seck-device-book-v1';

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

  function updateActiveViewerUi() {
    const hasActiveSession = Boolean(state.activePeerSocketId);
    const viewerLabel = state.activeViewerName || 'Bilinmeyen istemci';
    setText(refs.connectedViewer, hasActiveSession ? `Bagli istemci: ${viewerLabel}` : 'Bagli istemci yok.');

    if (refs.endSessionButton) {
      refs.endSessionButton.disabled = !hasActiveSession;
    }
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

    if (document.activeElement !== refs.licenseKeyInput) {
      refs.licenseKeyInput.value = state.config.licenseKey || '';
    }

    const licenseState = state.config.licenseStatus || { ok: false, message: 'Lisans kontrol ediliyor...' };
    setText(refs.licenseStatus, licenseState.message || 'Lisans kontrol ediliyor...');

    if (!licenseState.ok) {
      setBadge(refs.socketBadge, 'Lisans gerekli', 'danger');
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
        updateActiveViewerUi();
        setText(refs.hostStatus, `${viewerName || 'Bir istemci'} baglandi. Oturum aciliyor...`);
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

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: { ideal: 24, max: 24 },
        width: { min: 1280, ideal: 1920, max: 3840 },
        height: { min: 720, ideal: 1080, max: 2160 },
      },
    });

    const [videoTrack] = stream.getVideoTracks();
    videoTrack.addEventListener('ended', () => {
      state.localStream = null;
      refs.localPreview.srcObject = null;
      setText(refs.hostStatus, 'Paylasilan ekran kapandi. Yeni oturum icin tekrar secim yapmalisin.');
    });

    state.localStream = stream;
    refs.localPreview.srcObject = stream;
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
    updateActiveViewerUi();
    setBadge(refs.sessionBadge, 'Oturum yok', 'muted');
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

    refs.saveLicenseButton.addEventListener('click', async () => {
      state.config = await window.anydeksApi.setLicenseKey(refs.licenseKeyInput.value);
      updateConfigView();

      if (canUseRemoteFeatures()) {
        try {
          await ensureSocket();
          setText(refs.hostStatus, 'Lisans kaydedildi ve baglanti servisi hazir.');
        }
        catch (error) {
          setText(refs.hostStatus, error.message);
        }
        return;
      }

      setText(refs.hostStatus, getLicenseMessage());
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

    refs.endSessionButton.addEventListener('click', () => {
      if (!state.activePeerSocketId) {
        return;
      }

      endActiveSession('Host oturumu sonlandirdi.');
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

    installSavedListActions();
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

    setInterval(refreshConfig, 1000);
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
  });

  initialize().catch((error) => {
    setText(refs.viewerStatus, `Baslatma hatasi: ${error.message}`);
  });
})();
