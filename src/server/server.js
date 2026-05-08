const express = require('express');
const http = require('node:http');
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
let startedServer = null;

app.use('/web', express.static(webClientPath));

app.get('/', (_request, response) => {
  response.redirect('/web');
});

app.get('/health', (_request, response) => {
  response.json({ ok: true, hosts: hosts.size });
});

io.on('connection', (socket) => {
  socket.on('host:register', ({ deviceCode, deviceName }) => {
    if (!deviceCode) {
      return;
    }

    hosts.set(deviceCode, {
      socketId: socket.id,
      deviceName,
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
  startSignalServer,
};

if (require.main === module) {
  startSignalServer().catch((error) => {
    console.error('Failed to start signal server:', error.message);
    process.exit(1);
  });
}