const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, Notification, screen, shell, Tray, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  generateDeviceCode,
  generateRollingPassword,
  generateSalt,
  generateSecret,
  hashFixedPassword,
  normalizeCode,
  secondsUntilPasswordRefresh,
  verifyFixedPassword,
} = require('../shared/auth');
const { InputController } = require('./input-controller');
const {
  approveLicenseRequest,
  deleteLicense,
  deleteLicenseRequest,
  getAdminDashboard,
  upsertLicense,
  verifyAdminAccessKey,
} = require('./license-admin');
const { refreshLicenseStatus, submitLicenseRequest } = require('./license-manager');
const { getVersionConfig } = require('./runtime-config');
const { checkForAppUpdates, initUpdater } = require('./updater');
const { serverEvents, startSignalServer } = require('../server/server');

const versionConfig = getVersionConfig();
const AUTO_NETWORK = {
  signalServerUrl: process.env.SECK_SIGNAL_SERVER_URL || String(versionConfig.signalServerUrl || '').trim() || 'http://127.0.0.1:3131',
  turnServerUrl: process.env.SECK_TURN_SERVER_URL || String(versionConfig.turnServerUrl || '').trim() || '',
  turnUsername: process.env.SECK_TURN_USERNAME || String(versionConfig.turnUsername || '').trim() || '',
  turnPassword: process.env.SECK_TURN_PASSWORD || String(versionConfig.turnPassword || '').trim() || '',
};

const inputController = new InputController();
let mainWindow;
let tray;
let isQuitting = false;
let preferredDesktopSourceId = null;
let lastLicenseNotificationAt = 0;
let licenseState = {
  ok: true,
  code: 'booting',
  message: 'Lisans kontrol ediliyor...',
  licensedTo: '',
  expires: '',
  isDevMode: false,
};
const startInBackground = process.argv.includes('--background');
const APP_ICON_PATH = path.join(__dirname, '../assets/icons/app-icon.ico');
const TRAY_ICON_PATH = path.join(__dirname, '../assets/icons/tray-icon.png');
const SIGNAL_SERVER_PORT = Number(process.env.ANYDEKS_SIGNAL_PORT || 3131);
let embeddedSignalServer = null;

function revealMainWindow({ openAdminPanel = false } = {}) {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();

  if (openAdminPanel) {
    mainWindow.webContents.send('admin:open-panel');
  }
}

function showLicenseRequestNotification(requestItem) {
  if (!config?.adminAuthorized) {
    return;
  }

  const now = Date.now();
  if (now - lastLicenseNotificationAt < 2500) {
    return;
  }

  lastLicenseNotificationAt = now;
  const title = 'Yeni Lisans Talebi';
  const body = [
    `Bilgisayar Kodu: ${requestItem.deviceCode}`,
    `Bilgisayar Adi: ${requestItem.deviceName || '-'}`,
  ].join('\n');

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: APP_ICON_PATH,
      silent: false,
    });

    notification.on('click', () => {
      revealMainWindow({ openAdminPanel: true });
    });

    notification.show();
  }

  if (tray?.displayBalloon) {
    tray.displayBalloon({
      iconType: 'info',
      title,
      content: body,
      largeIcon: true,
    });
  }

  if (tray) {
    tray.removeAllListeners('balloon-click');
    tray.once('balloon-click', () => revealMainWindow({ openAdminPanel: true }));
  }

  if (mainWindow && !mainWindow.isVisible()) {
    revealMainWindow();
  }
}

async function resolveDesktopCaptureSource() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });

  if (!sources.length) {
    throw new Error('Paylasilacak ekran bulunamadi.');
  }

  const preferredSource = preferredDesktopSourceId
    ? sources.find((source) => source.id === preferredDesktopSourceId)
    : null;

  if (preferredSource) {
    return preferredSource;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  return sources.find((source) => String(source.display_id || '') === String(primaryDisplay.id)) || sources[0];
}

function configureDisplayMediaHandling() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const source = await resolveDesktopCaptureSource();
      callback({
        video: source,
        audio: false,
      });
    }
    catch (error) {
      console.error('Desktop capture source could not be resolved:', error.message);
      callback({ video: null, audio: false });
    }
  }, {
    useSystemPicker: false,
  });
}

function resolveSignalServerUrl(rawUrl) {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) {
    return AUTO_NETWORK.signalServerUrl;
  }

  try {
    const parsedCandidate = new URL(candidate);
    const parsedAutoNetwork = new URL(AUTO_NETWORK.signalServerUrl);
    const isLocalCandidate = ['127.0.0.1', 'localhost', '::1'].includes(parsedCandidate.hostname);
    const isRemoteAutoNetwork = !['127.0.0.1', 'localhost', '::1'].includes(parsedAutoNetwork.hostname);

    if (isLocalCandidate && isRemoteAutoNetwork) {
      return AUTO_NETWORK.signalServerUrl;
    }
  }
  catch {
  }

  if (candidate.replace(/\/$/, '') === AUTO_NETWORK.signalServerUrl.replace(/\/$/, '')) {
    return AUTO_NETWORK.signalServerUrl;
  }

  return candidate;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function resolveDeviceCode(rawCode) {
  const digits = normalizeCode(rawCode);
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }

  return generateDeviceCode();
}

function loadConfig() {
  const filePath = getConfigPath();

  if (!fs.existsSync(filePath)) {
    return createDefaultConfig();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      signalServerUrl: resolveSignalServerUrl(parsed.signalServerUrl),
      deviceCode: resolveDeviceCode(parsed.deviceCode),
      deviceName: parsed.deviceName || os.hostname(),
      rollingSecret: parsed.rollingSecret || generateSecret(),
      fixedPasswordHash: parsed.fixedPasswordHash || '',
      fixedPasswordSalt: parsed.fixedPasswordSalt || '',
      turnServerUrl: AUTO_NETWORK.turnServerUrl,
      turnUsername: AUTO_NETWORK.turnUsername,
      turnPassword: AUTO_NETWORK.turnPassword,
      adminAuthorized: Boolean(parsed.adminAuthorized),
      permissionsPrompted: Boolean(parsed.permissionsPrompted),
      startupEnabled: parsed.startupEnabled === undefined ? true : Boolean(parsed.startupEnabled),
      firewallRuleAdded: Boolean(parsed.firewallRuleAdded),
    };
  }
  catch {
    return createDefaultConfig();
  }
}

function createDefaultConfig() {
  return {
    signalServerUrl: resolveSignalServerUrl(''),
    deviceCode: generateDeviceCode(),
    deviceName: os.hostname(),
    rollingSecret: generateSecret(),
    fixedPasswordHash: '',
    fixedPasswordSalt: '',
    turnServerUrl: AUTO_NETWORK.turnServerUrl,
    turnUsername: AUTO_NETWORK.turnUsername,
    turnPassword: AUTO_NETWORK.turnPassword,
    adminAuthorized: false,
    permissionsPrompted: false,
    startupEnabled: true,
    firewallRuleAdded: false,
  };
}

let config = loadConfig();

function saveConfig() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

function publicConfig() {
  const versionConfig = getVersionConfig();
  return {
    appVersion: versionConfig.appVersion || app.getVersion(),
    signalServerUrl: config.signalServerUrl,
    turnServerUrl: config.turnServerUrl,
    turnUsername: config.turnUsername,
    turnPassword: config.turnPassword,
    deviceCode: config.deviceCode,
    deviceName: config.deviceName,
    licenseStatus: licenseState,
    adminAuthorized: Boolean(config.adminAuthorized),
    hasFixedPassword: Boolean(config.fixedPasswordHash),
    rollingPassword: generateRollingPassword(config.rollingSecret),
    rollingPasswordTtl: secondsUntilPasswordRefresh(),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 780,
    backgroundColor: '#0d1117',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();

    // If tray creation failed for any reason, keep app reachable via taskbar.
    if (tray) {
      mainWindow.hide();
      return;
    }

    mainWindow.minimize();
  });

  if (startInBackground) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.hide();
    });
  }
}

function createTray() {
  if (tray) {
    return;
  }

  const fallbackIcon = fs.existsSync(TRAY_ICON_PATH)
    ? TRAY_ICON_PATH
    : (fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : process.execPath);

  try {
    tray = new Tray(fallbackIcon);
  }
  catch {
    tray = new Tray(process.execPath);
  }

  tray.setToolTip('Seck Uzak Masaustu Destek');

  const rebuildTrayMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? 'Pencereyi Gizle' : 'Pencereyi Ac',
        click: () => {
          if (!mainWindow) {
            return;
          }

          if (mainWindow.isVisible()) {
            mainWindow.hide();
          }
          else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Windows Acilisinda Calistir',
        type: 'checkbox',
        checked: Boolean(config.startupEnabled),
        click: (menuItem) => {
          const enabled = Boolean(menuItem.checked);
          config.startupEnabled = enabled;
          app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true,
            args: ['--background'],
          });
          saveConfig();
          rebuildTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Cikis',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(menu);
  };

  tray.on('double-click', () => {
    if (!mainWindow) {
      return;
    }

    mainWindow.show();
    mainWindow.focus();
  });

  rebuildTrayMenu();
}

async function ensureEmbeddedSignalServer() {
  try {
    embeddedSignalServer = await startSignalServer({ port: SIGNAL_SERVER_PORT });
  }
  catch (error) {
    console.error('Embedded signal server could not start:', error.message);
  }
}

function requestFirewallRuleWithElevation() {
  return new Promise((resolve) => {
    const command = "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"New-NetFirewallRule -DisplayName ''SeckUzakDestek3131'' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3131 -Profile Any\"'";
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      detached: false,
    });

    child.on('exit', () => resolve(true));
    child.on('error', () => resolve(false));
  });
}

async function ensureFirstRunPermissions() {
  if (config.permissionsPrompted) {
    return;
  }

  const startupChoice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Evet', 'Hayir'],
    defaultId: 0,
    cancelId: 1,
    title: 'Acilis Izni',
    message: 'Bilgisayar acildiginda uygulama arka planda otomatik calissin mi?',
  });

  config.startupEnabled = startupChoice.response === 0;
  app.setLoginItemSettings({
    openAtLogin: config.startupEnabled,
    openAsHidden: true,
    args: ['--background'],
  });

  const firewallChoice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Evet', 'Hayir'],
    defaultId: 0,
    cancelId: 1,
    title: 'Firewall Izni',
    message: 'Uzak baglanti icin Windows guvenlik duvarina TCP 3131 izin kurali eklensin mi?\n(Yonetici onayi sorulabilir)',
  });

  if (firewallChoice.response === 0) {
    config.firewallRuleAdded = await requestFirewallRuleWithElevation();
    if (!config.firewallRuleAdded) {
      dialog.showMessageBox({
        type: 'info',
        buttons: ['Tamam', 'Talimat Ac'],
        defaultId: 0,
        cancelId: 0,
        title: 'Firewall Kurali',
        message: 'Firewall kurali otomatik eklenemedi. Gerekirse yonetici PowerShell ile manuel ekleyebilirsin.',
      }).then((result) => {
        if (result.response === 1) {
          shell.openExternal('https://learn.microsoft.com/windows/security/operating-system-security/network-security/windows-firewall/create-an-outbound-port-rule');
        }
      });
    }
  }

  config.permissionsPrompted = true;
  saveConfig();
}

app.whenReady().then(async () => {
  await ensureEmbeddedSignalServer();
  configureDisplayMediaHandling();
  app.setAppUserModelId('com.seck.uzakmasaustu');
  licenseState = await refreshLicenseStatus(config.deviceCode);
  saveConfig();
  app.setLoginItemSettings({
    openAtLogin: Boolean(config.startupEnabled),
    openAsHidden: true,
    args: ['--background'],
  });
  createWindow();
  initUpdater(mainWindow);
  createTray();
  serverEvents.on('license-request', showLicenseRequestNotification);
  ensureFirstRunPermissions();
  void checkForAppUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  serverEvents.removeListener('license-request', showLicenseRequestNotification);

  if (embeddedSignalServer) {
    embeddedSignalServer.close();
    embeddedSignalServer = null;
  }

  inputController.stop();
});

ipcMain.handle('config:get', () => publicConfig());

ipcMain.handle('config:set-server-url', (_event, serverUrl) => {
  config.signalServerUrl = resolveSignalServerUrl(serverUrl);
  saveConfig();
  return publicConfig();
});

ipcMain.handle('config:set-network', (_event, payload) => {
  config.signalServerUrl = String(payload?.signalServerUrl || '').trim() || 'http://127.0.0.1:3131';
  config.turnServerUrl = String(payload?.turnServerUrl || '').trim();
  config.turnUsername = String(payload?.turnUsername || '').trim();
  config.turnPassword = String(payload?.turnPassword || '').trim();
  saveConfig();
  return publicConfig();
});

ipcMain.handle('config:set-fixed-password', (_event, password) => {
  const cleanPassword = String(password || '').trim();

  if (!cleanPassword) {
    config.fixedPasswordHash = '';
    config.fixedPasswordSalt = '';
  }
  else {
    const salt = generateSalt();
    config.fixedPasswordSalt = salt;
    config.fixedPasswordHash = hashFixedPassword(cleanPassword, salt);
  }

  saveConfig();
  return publicConfig();
});

ipcMain.handle('config:get-secret-state', () => ({
  rollingSecret: config.rollingSecret,
  fixedPasswordHash: config.fixedPasswordHash,
  fixedPasswordSalt: config.fixedPasswordSalt,
}));

ipcMain.handle('admin:authorize', (_event, accessKey) => {
  config.adminAuthorized = verifyAdminAccessKey(accessKey);
  saveConfig();
  return {
    ok: config.adminAuthorized,
    adminAuthorized: config.adminAuthorized,
    message: config.adminAuthorized ? 'Yonetici modu aktif edildi.' : 'Yonetici anahtari hatali.',
  };
});

ipcMain.handle('admin:get-dashboard', async () => {
  if (!config.adminAuthorized) {
    throw new Error('Yonetici modu aktif degil.');
  }

  return getAdminDashboard({
    signalServerUrl: config.signalServerUrl,
  });
});

ipcMain.handle('admin:approve-request', async (_event, payload) => {
  if (!config.adminAuthorized) {
    throw new Error('Yonetici modu aktif degil.');
  }

  return approveLicenseRequest({
    ...(payload || {}),
    signalServerUrl: config.signalServerUrl,
  });
});

ipcMain.handle('admin:delete-request', (_event, deviceCode) => {
  if (!config.adminAuthorized) {
    throw new Error('Yonetici modu aktif degil.');
  }

  return deleteLicenseRequest(deviceCode, config.signalServerUrl);
});

ipcMain.handle('admin:upsert-license', async (_event, payload) => {
  if (!config.adminAuthorized) {
    throw new Error('Yonetici modu aktif degil.');
  }

  return upsertLicense(payload || {});
});

ipcMain.handle('admin:delete-license', async (_event, deviceCode) => {
  if (!config.adminAuthorized) {
    throw new Error('Yonetici modu aktif degil.');
  }

  return deleteLicense(deviceCode);
});

ipcMain.handle('license:get-status', async () => {
  licenseState = await refreshLicenseStatus(config.deviceCode);
  return licenseState;
});

ipcMain.handle('license:refresh', async () => {
  licenseState = await refreshLicenseStatus(config.deviceCode);
  return publicConfig();
});

ipcMain.handle('license:request', async () => submitLicenseRequest({
  deviceCode: config.deviceCode,
  deviceName: config.deviceName,
  appVersion: getVersionConfig().appVersion || app.getVersion(),
  signalServerUrl: config.signalServerUrl,
  allowLocalSubmission: Boolean(config.adminAuthorized),
}));

ipcMain.handle('updates:check-now', async () => checkForAppUpdates({ manual: true }));

ipcMain.handle('auth:validate-credential', (_event, credential) => {
  const cleanCredential = String(credential || '').trim();
  const currentRollingPassword = generateRollingPassword(config.rollingSecret);

  if (cleanCredential && cleanCredential === currentRollingPassword) {
    return { ok: true, via: 'rolling' };
  }

  if (
    cleanCredential &&
    config.fixedPasswordHash &&
    verifyFixedPassword(cleanCredential, config.fixedPasswordSalt, config.fixedPasswordHash)
  ) {
    return { ok: true, via: 'fixed' };
  }

  return { ok: false };
});

ipcMain.handle('desktop:get-display-info', () => {
  const primary = screen.getPrimaryDisplay();
  return {
    width: primary.size.width,
    height: primary.size.height,
    scaleFactor: primary.scaleFactor,
  };
});

ipcMain.handle('desktop:list-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
  }));
});

ipcMain.handle('desktop:set-source', (_event, sourceId) => {
  preferredDesktopSourceId = String(sourceId || '').trim() || null;
  return { ok: true, sourceId: preferredDesktopSourceId };
});

ipcMain.handle('input:perform', (_event, payload) => {
  return inputController.send(payload);
});

ipcMain.handle('files:save', (_event, { fileName, bytes }) => {
  const safeName = String(fileName || 'gelen-dosya.bin').replace(/[<>:"/\\|?*]+/g, '_');
  const targetDir = path.join(app.getPath('downloads'), 'Seck Uzak Masaustu Gelenler');
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, safeName);
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return { filePath };
});