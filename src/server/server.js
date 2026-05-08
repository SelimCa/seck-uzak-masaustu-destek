const express = require('express');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const hosts = new Map();
const webClientPath = path.join(__dirname, '../web');
const appDataDir = path.join(process.env.APPDATA || os.homedir(), 'Seck Uzak Masaustu Destek');
const licenseRequestStorePath = path.join(appDataDir, 'license_requests.json');
const serverEvents = new EventEmitter();
let startedServer = null;

app.use(express.json({ limit: '256kb' }));
app.use('/web', express.static(webClientPath));

function readLicenseRequests() {
  try {
    return JSON.parse(fs.readFileSync(licenseRequestStorePath, 'utf8'));
  }
  catch {
    return { requests: [] };
  }
}

function writeLicenseRequests(payload) {
  fs.mkdirSync(path.dirname(licenseRequestStorePath), { recursive: true });
  fs.writeFileSync(licenseRequestStorePath, JSON.stringify(payload, null, 2), 'utf8');
}

function verifyAdminKey(value) {
  try {
    const { getVersionConfig } = require('../main/runtime-config');
    return String(value || '').trim() === String(getVersionConfig().adminAccessKey || '').trim();
  }
  catch {
    return false;
  }
}

async function forwardToDiscord(requestItem) {
  const discordWebhookUrl = String(process.env.SECK_DISCORD_WEBHOOK_URL || '').trim();
  if (!discordWebhookUrl) {
    return false;
  }

  const response = await fetch(discordWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: [
        'Yeni lisans talebi alindi.',
        `Bilgisayar Kodu: ${requestItem.deviceCode}`,
        `Bilgisayar Adi: ${requestItem.deviceName || '-'}`,
        `Surum: ${requestItem.appVersion || '-'}`,
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook hatasi: HTTP ${response.status}`);
  }

  return true;
}

async function forwardToTelegram(requestItem) {
  const botToken = String(process.env.SECK_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.SECK_TELEGRAM_CHAT_ID || '').trim();
  if (!botToken || !chatId) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: [
        'Yeni lisans talebi alindi.',
        `Bilgisayar Kodu: ${requestItem.deviceCode}`,
        `Bilgisayar Adi: ${requestItem.deviceName || '-'}`,
        `Surum: ${requestItem.appVersion || '-'}`,
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram webhook hatasi: HTTP ${response.status}`);
  }

  return true;
}

app.get('/', (_request, response) => {
  response.redirect('/web');
});

app.get('/health', (_request, response) => {
  response.json({ ok: true, hosts: hosts.size });
});

app.get('/license-requests', (request, response) => {
  const adminKey = request.headers['x-admin-key'] || request.query.adminKey;
  if (!verifyAdminKey(adminKey)) {
    response.status(403).json({ ok: false, message: 'Yonetici yetkisi gerekli.' });
    return;
  }

  const current = readLicenseRequests();
  response.json({
    ok: true,
    requests: Array.isArray(current.requests) ? current.requests : [],
  });
});

app.put('/license-requests', (request, response) => {
  const adminKey = request.headers['x-admin-key'] || request.body?.adminKey;
  if (!verifyAdminKey(adminKey)) {
    response.status(403).json({ ok: false, message: 'Yonetici yetkisi gerekli.' });
    return;
  }

  const requests = Array.isArray(request.body?.requests) ? request.body.requests : [];
  writeLicenseRequests({ requests });
  response.json({ ok: true, requests });
});

app.post('/license-request', async (request, response) => {
  const deviceCode = String(request.body?.deviceCode || '').trim();
  const deviceName = String(request.body?.deviceName || '').trim();
  const appVersion = String(request.body?.appVersion || '').trim();

  if (!deviceCode) {
    response.status(400).json({ ok: false, message: 'deviceCode gerekli.' });
    return;
  }

  const requestItem = {
    deviceCode,
    deviceName,
    appVersion,
    requestedAt: request.body?.requestedAt || new Date().toISOString(),
    sourceIp: request.headers['x-forwarded-for'] || request.socket.remoteAddress || '',
    status: 'pending',
  };

  const current = readLicenseRequests();
  const requests = Array.isArray(current.requests) ? current.requests : [];
  const existingIndex = requests.findIndex((item) => item.deviceCode === deviceCode);

  if (existingIndex >= 0) {
    requests[existingIndex] = {
      ...requests[existingIndex],
      ...requestItem,
      updatedAt: new Date().toISOString(),
    };
  }
  else {
    requests.unshift(requestItem);
  }

  writeLicenseRequests({ requests });
  serverEvents.emit('license-request', requestItem);

  try {
    await forwardToDiscord(requestItem);
    await forwardToTelegram(requestItem);
  }
  catch (error) {
    console.error('License request forward failed:', error.message);
  }

  response.json({
    ok: true,
    message: 'Lisans talebi alindi. Onaydan sonra Lisansi Yenile ile aktif olur.',
  });
});

io.on('connection', (socket) => {
  socket.on('host:register', ({ deviceCode, deviceName, localNetworkAdapters, wakeOnLanReady }) => {
    if (!deviceCode) {
      return;
    }

    hosts.set(deviceCode, {
      socketId: socket.id,
      deviceName,
      localNetworkAdapters: Array.isArray(localNetworkAdapters) ? localNetworkAdapters : [],
      wakeOnLanReady: Boolean(wakeOnLanReady),
      registeredAt: Date.now(),
    });

    socket.data.deviceCode = deviceCode;
    io.to(socket.id).emit('host:registered', { deviceCode });
  });

  socket.on('session:request', ({ targetCode, viewerName, credential }) => {
    if (socket.data.deviceCode && targetCode === socket.data.deviceCode) {
      io.to(socket.id).emit('session:rejected', {
        reason: 'Bu bilgisayar kendi koduna baglanamaz. Diger bilgisayarin kodunu gir.',
      });
      return;
    }

    const host = hosts.get(targetCode);

    if (!host) {
      io.to(socket.id).emit('session:rejected', {
        reason: 'Hedef bilgisayar çevrimdışı veya kod yanlış.',
      });
      return;
    }

    if (host.socketId === socket.id) {
      io.to(socket.id).emit('session:rejected', {
        reason: 'Bu bilgisayar kendi oturumuna baglanamaz. Diger bilgisayarin kodunu gir.',
      });
      return;
    }

    io.to(host.socketId).emit('session:request', {
      viewerSocketId: socket.id,
      viewerName,
      credential,
    });
  });

  socket.on('session:response', ({ viewerSocketId, accepted, reason, hostInfo }) => {
    io.to(viewerSocketId).emit(accepted ? 'session:accepted' : 'session:rejected', {
      reason,
      hostInfo,
      hostSocketId: socket.id,
    });
  });

  socket.on('signal:relay', ({ to, payload }) => {
    io.to(to).emit('signal:relay', {
      from: socket.id,
      payload,
    });
  });

  socket.on('discover:request', ({ networkPrefixes }) => {
    const prefixes = Array.isArray(networkPrefixes) ? networkPrefixes.filter(Boolean) : [];
    const discoveredHosts = Array.from(hosts.entries())
      .filter(([, host]) => host.socketId !== socket.id)
      .filter(([, host]) => {
        if (!prefixes.length) {
          return true;
        }

        return (host.localNetworkAdapters || []).some((adapter) => prefixes.includes(adapter.prefix));
      })
      .map(([deviceCode, host]) => ({
        deviceCode,
        deviceName: host.deviceName || '',
        registeredAt: host.registeredAt,
        wakeOnLanReady: Boolean(host.wakeOnLanReady),
        localNetworkAdapters: host.localNetworkAdapters || [],
      }));

    io.to(socket.id).emit('discover:result', {
      hosts: discoveredHosts,
    });
  });

  socket.on('session:end', ({ to, reason }) => {
    if (!to) {
      return;
    }

    io.to(to).emit('session:ended', {
      from: socket.id,
      reason,
    });
  });

  socket.on('disconnect', () => {
    const { deviceCode } = socket.data;
    if (deviceCode && hosts.get(deviceCode)?.socketId === socket.id) {
      hosts.delete(deviceCode);
    }
  });
});

function startSignalServer({ port } = {}) {
  if (startedServer) {
    return Promise.resolve(startedServer);
  }

  const resolvedPort = Number(port || process.env.ANYDEKS_SIGNAL_PORT || 3131);

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error?.code === 'EADDRINUSE') {
        console.warn(`Anydeks signal server port ${resolvedPort} is already in use. Assuming another instance is running.`);
        startedServer = null;
        resolve(null);
        return;
      }

      reject(error);
    };

    server.once('error', onError);
    server.listen(resolvedPort, () => {
      server.removeListener('error', onError);
      startedServer = server;
      console.log(`Anydeks signal server listening on http://0.0.0.0:${resolvedPort}`);
      resolve(server);
    });
  });
}

module.exports = {
  readLicenseRequests,
  serverEvents,
  startSignalServer,
  writeLicenseRequests,
};

if (require.main === module) {
  startSignalServer().catch((error) => {
    console.error('Failed to start signal server:', error.message);
    process.exit(1);
  });
}