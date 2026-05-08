(function bootstrapWebClient() {
  const POINTER_SEND_INTERVAL_MS = 12;

  const refs = {
    targetCode: document.querySelector('#targetCode'),
    credential: document.querySelector('#credential'),
    viewerName: document.querySelector('#viewerName'),
    connectButton: document.querySelector('#connectButton'),
    disconnectButton: document.querySelector('#disconnectButton'),
    fullscreenButton: document.querySelector('#fullscreenButton'),
    statusText: document.querySelector('#statusText'),
    remoteSurface: document.querySelector('#remoteSurface'),
    remoteVideo: document.querySelector('#remoteVideo'),
    overlay: document.querySelector('#overlay'),
  };

  const state = {
    socket: null,
    peerConnection: null,
    dataChannel: null,
    hostSocketId: null,
    controlActive: false,
    lastMoveAt: 0,
  };

  function setStatus(text) {
    refs.statusText.textContent = text;
  }

  function normalizeCode(input) {
    return String(input || '').replace(/[^0-9]/g, '');
  }

  function formatCode(input) {
    const compact = normalizeCode(input);
    if (compact.length !== 9) {
      return input;
    }

    return `${compact.slice(0, 3)}-${compact.slice(3, 6)}-${compact.slice(6, 9)}`;
  }

  function sendJson(message) {
    if (state.dataChannel?.readyState === 'open') {
      state.dataChannel.send(JSON.stringify(message));
    }
  }

  function sendInput(payload) {
    sendJson({ kind: 'input', payload });
  }

  function showOverlay(text) {
    refs.overlay.textContent = text;
    refs.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    refs.overlay.classList.add('hidden');
  }

  function pointerToNormalized(event) {
    const rect = refs.remoteVideo.getBoundingClientRect();
    const videoWidth = refs.remoteVideo.videoWidth || rect.width;
    const videoHeight = refs.remoteVideo.videoHeight || rect.height;

    if (!rect.width || !rect.height || !videoWidth || !videoHeight) {
      return { xNorm: 0, yNorm: 0 };
    }

    const videoAspect = videoWidth / videoHeight;
    const boxAspect = rect.width / rect.height;

    let renderedWidth = rect.width;
    let renderedHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (boxAspect > videoAspect) {
      renderedWidth = rect.height * videoAspect;
      offsetX = (rect.width - renderedWidth) / 2;
    }
    else {
      renderedHeight = rect.width / videoAspect;
      offsetY = (rect.height - renderedHeight) / 2;
    }

    const localX = Math.min(Math.max(event.clientX - rect.left - offsetX, 0), renderedWidth);
    const localY = Math.min(Math.max(event.clientY - rect.top - offsetY, 0), renderedHeight);

    return {
      xNorm: renderedWidth ? localX / renderedWidth : 0,
      yNorm: renderedHeight ? localY / renderedHeight : 0,
    };
  }

  function activateControl() {
    state.controlActive = true;
    refs.remoteSurface.classList.add('active');
    refs.remoteSurface.focus();
  }

  function deactivateControl() {
    state.controlActive = false;
    refs.remoteSurface.classList.remove('active');
  }

  function installControlListeners() {
    refs.remoteSurface.addEventListener('click', () => activateControl());
    refs.remoteSurface.addEventListener('contextmenu', (event) => event.preventDefault());

    refs.remoteSurface.addEventListener('mousedown', (event) => {
      activateControl();
      const pointer = pointerToNormalized(event);
      const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
      sendInput({ type: 'click', button, ...pointer });
    });

    refs.remoteSurface.addEventListener('dblclick', (event) => {
      const pointer = pointerToNormalized(event);
      sendInput({ type: 'doubleClick', button: 'left', ...pointer });
    });

    refs.remoteSurface.addEventListener('mousemove', (event) => {
      if (!state.controlActive) {
        return;
      }

      const now = Date.now();
      if (now - state.lastMoveAt < POINTER_SEND_INTERVAL_MS) {
        return;
      }

      state.lastMoveAt = now;
      sendInput({ type: 'move', ...pointerToNormalized(event) });
    });

    refs.remoteSurface.addEventListener('wheel', (event) => {
      if (!state.controlActive) {
        return;
      }

      event.preventDefault();
      sendInput({ type: 'scroll', deltaY: event.deltaY < 0 ? 120 : -120 });
    }, { passive: false });

    refs.remoteSurface.addEventListener('blur', () => deactivateControl());

    window.addEventListener('keydown', (event) => {
      if (!state.controlActive) {
        return;
      }

      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      event.preventDefault();
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        sendInput({ type: 'text', text: event.key });
        return;
      }

      sendInput({
        type: 'key',
        key: event.key === ' ' ? 'Space' : event.key,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      });
    });
  }

  function setupDataChannel(channel) {
    state.dataChannel = channel;

    channel.onopen = () => {
      setStatus('Baglanti aktif.');
      hideOverlay();
    };

    channel.onclose = () => {
      setStatus('Baglanti kapandi.');
    };
  }

  async function createViewerPeer() {
    state.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    state.peerConnection.onicecandidate = ({ candidate }) => {
      if (!candidate || !state.hostSocketId) {
        return;
      }

      state.socket.emit('signal:relay', {
        to: state.hostSocketId,
        payload: { candidate },
      });
    };

    state.peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      refs.remoteVideo.srcObject = stream;
      refs.remoteVideo.play().catch(() => {});
      hideOverlay();
    };

    const channel = state.peerConnection.createDataChannel('anydeks-control', {
      ordered: false,
      maxRetransmits: 0,
    });
    setupDataChannel(channel);

    const offer = await state.peerConnection.createOffer({ offerToReceiveVideo: true });
    await state.peerConnection.setLocalDescription(offer);

    state.socket.emit('signal:relay', {
      to: state.hostSocketId,
      payload: { description: state.peerConnection.localDescription },
    });
  }

  function closeSession(statusText = 'Hazir.', overlayText = 'Baglanti bekleniyor') {
    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }

    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }

    state.dataChannel = null;
    state.hostSocketId = null;
    refs.remoteVideo.srcObject = null;
    deactivateControl();
    showOverlay(overlayText);
    setStatus(statusText);
  }

  function connect() {
    const targetCode = formatCode(refs.targetCode.value.trim());
    const credential = refs.credential.value;
    const viewerName = refs.viewerName.value.trim() || 'Web Kullanici';

    if (!targetCode || !credential) {
      setStatus('Hedef kod ve sifre gerekli.');
      return;
    }

    closeSession();
    showOverlay('Baglanti kuruluyor...');

    state.socket = window.io({ transports: ['websocket'], reconnection: true });

    state.socket.on('connect', () => {
      setStatus('Baglanti istegi gonderildi...');
      state.socket.emit('session:request', {
        targetCode,
        viewerName,
        credential,
      });
    });

    state.socket.on('session:accepted', async ({ hostSocketId, hostInfo }) => {
      state.hostSocketId = hostSocketId;
      setStatus(`${hostInfo?.deviceName || 'Uzak bilgisayar'} ile baglaniyor...`);
      await createViewerPeer();
    });

    state.socket.on('session:rejected', ({ reason }) => {
      showOverlay(reason || 'Baglanti reddedildi');
      setStatus(reason || 'Baglanti reddedildi');
    });

    state.socket.on('session:ended', ({ reason }) => {
      closeSession(reason || 'Oturum host tarafindan sonlandirildi.', 'Oturum sonlandirildi');
    });

    state.socket.on('signal:relay', async ({ from, payload }) => {
      try {
        if (state.hostSocketId && from !== state.hostSocketId) {
          return;
        }

        if (payload.description?.type === 'answer') {
          if (state.peerConnection?.signalingState === 'have-local-offer') {
            await state.peerConnection.setRemoteDescription(payload.description);
          }
          return;
        }

        if (payload.candidate && state.peerConnection) {
          await state.peerConnection.addIceCandidate(payload.candidate);
        }
      }
      catch (error) {
        setStatus(`Sinyal hatasi: ${error.message}`);
      }
    });
  }

  refs.connectButton.addEventListener('click', connect);
  refs.disconnectButton.addEventListener('click', closeSession);

  refs.fullscreenButton.addEventListener('click', async () => {
    if (!document.fullscreenElement) {
      if (refs.remoteSurface.requestFullscreen) {
        await refs.remoteSurface.requestFullscreen();
      }
      else if (refs.remoteSurface.webkitRequestFullscreen) {
        refs.remoteSurface.webkitRequestFullscreen();
      }
    }
    else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
      else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  });

  window.addEventListener('beforeunload', () => closeSession());
  installControlListeners();
})();