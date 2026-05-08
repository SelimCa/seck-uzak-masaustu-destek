const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen, shell, Tray, session } = require('electron');
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
const { refreshLicenseStatus } = require('./license-manager');
const { getVersionConfig } = require('./runtime-config');
const { checkForAppUpdates, initUpdater } = require('./updater');
const { startSignalServer } = require('../server/server');

const AUTO_NETWORK = {
  signalServerUrl: process.env.SECK_SIGNAL_SERVER_URL || 'http://127.0.0.1:3131',
  turnServerUrl: process.env.SECK_TURN_SERVER_URL || '',
  turnUsername: process.env.SECK_TURN_USERNAME || '',
  turnPassword: process.env.SECK_TURN_PASSWORD || '',
};

const inputController = new InputController();
let mainWindow;
let tray;
let isQuitting = false;
let preferredDesktopSourceId = null;
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
const DEPRECATED_REMOTE_SIGNAL_URL = 'http://85.105.250.108:3131';
let embeddedSignalServer = null;

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

  // Migrate legacy hardcoded remote endpoint to local embedded server.
  if (candidate === DEPRECATED_REMOTE_SIGNAL_URL) {
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
      licenseKey: String(parsed.licenseKey || '').trim().toUpperCase(),
      turnServerUrl: AUTO_NETWORK.turnServerUrl,
      turnUsername: AUTO_NETWORK.turnUsername,
      turnPassword: AUTO_NETWORK.turnPassword,
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
    licenseKey: '',
    turnServerUrl: AUTO_NETWORK.turnServerUrl,
    turnUsername: AUTO_NETWORK.turnUsername,
    turnPassword: AUTO_NETWORK.turnPassword,
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
    licenseKey: config.licenseKey,
    licenseStatus: licenseState,
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
  licenseState = await refreshLicenseStatus(config.licenseKey);
  saveConfig();
  app.setLoginItemSettings({
    openAtLogin: Boolean(config.startupEnabled),
    openAsHidden: true,
    args: ['--background'],
  });
  createWindow();
  initUpdater(mainWindow);
  createTray();
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

ipcMain.handle('config:set-license-key', async (_event, licenseKey) => {
  config.licenseKey = String(licenseKey || '').trim().toUpperCase();
  saveConfig();
  licenseState = await refreshLicenseStatus(config.licenseKey);
  return publicConfig();
});

ipcMain.handle('config:get-secret-state', () => ({
  rollingSecret: config.rollingSecret,
  fixedPasswordHash: config.fixedPasswordHash,
  fixedPasswordSalt: config.fixedPasswordSalt,
}));

ipcMain.handle('license:get-status', async () => {
  licenseState = await refreshLicenseStatus(config.licenseKey);
  return licenseState;
});

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
  inputController.send(payload);
  return true;
});

ipcMain.handle('files:save', (_event, { fileName, bytes }) => {
  const safeName = String(fileName || 'gelen-dosya.bin').replace(/[<>:"/\\|?*]+/g, '_');
  const targetDir = path.join(app.getPath('downloads'), 'Seck Uzak Masaustu Gelenler');
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, safeName);
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return { filePath };
});