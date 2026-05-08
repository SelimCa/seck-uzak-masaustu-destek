const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { app } = require('electron');

const { getVersionConfig } = require('./runtime-config');
const {
  readLicenseRequests,
  writeLicenseRequests,
} = require('../server/server');

function normalizeDeviceCode(deviceCode) {
  const digits = String(deviceCode || '').replace(/[^0-9]/g, '');
  if (digits.length !== 9) {
    return String(deviceCode || '').trim();
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

function getWorkspaceRoot() {
  return app.isPackaged ? process.cwd() : path.join(__dirname, '../..');
}

function getLocalLicenseFilePath() {
  return path.join(getWorkspaceRoot(), 'licenses.json');
}

function getGitHubToken() {
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  }
  catch {
    return '';
  }
}

function readLocalLicenseStore() {
  const filePath = getLocalLicenseFilePath();
  if (!fs.existsSync(filePath)) {
    return { devices: {} };
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeLocalLicenseStore(data) {
  const filePath = getLocalLicenseFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return { source: 'local' };
}

async function readGitHubLicenseStore() {
  const token = getGitHubToken();
  const { githubRepo, licenseFile } = getVersionConfig();
  if (!token || !githubRepo) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${licenseFile}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Seck-Uzak-Masaustu-Admin',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub licenses.json okunamadi: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const decoded = Buffer.from(String(payload.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  return {
    data: JSON.parse(decoded),
    sha: payload.sha,
    source: 'github',
  };
}

async function writeGitHubLicenseStore(data, commitMessage) {
  const token = getGitHubToken();
  const { githubRepo, licenseFile } = getVersionConfig();
  if (!token || !githubRepo) {
    return null;
  }

  const current = await readGitHubLicenseStore();
  const response = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${licenseFile}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Seck-Uzak-Masaustu-Admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64'),
      sha: current.sha,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub licenses.json yazilamadi: HTTP ${response.status}`);
  }

  return { source: 'github' };
}

async function readLicenseStore() {
  const githubStore = await readGitHubLicenseStore().catch(() => null);
  if (githubStore) {
    return githubStore;
  }

  return {
    data: readLocalLicenseStore(),
    sha: '',
    source: 'local',
  };
}

async function writeLicenseStore(data, commitMessage) {
  const githubResult = await writeGitHubLicenseStore(data, commitMessage).catch(() => null);
  if (githubResult) {
    return githubResult;
  }

  return writeLocalLicenseStore(data);
}

function verifyAdminAccessKey(accessKey) {
  return String(accessKey || '').trim() === String(getVersionConfig().adminAccessKey || '').trim();
}

function sortRequests(requests) {
  return [...requests].sort((left, right) => {
    return new Date(right.updatedAt || right.requestedAt || 0).getTime() - new Date(left.updatedAt || left.requestedAt || 0).getTime();
  });
}

function sortLicenses(devices) {
  return Object.entries(devices || {})
    .map(([deviceCode, info]) => ({
      deviceCode,
      name: info?.name || '',
      active: Boolean(info?.active),
      expires: info?.expires || '',
    }))
    .sort((left, right) => left.deviceCode.localeCompare(right.deviceCode, 'tr'));
}

function getRemoteRequestUrl(signalServerUrl) {
  const baseUrl = String(signalServerUrl || '').trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    return '';
  }

  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('/license-requests', normalizedBaseUrl).toString();
}

async function readRemoteRequestStore(signalServerUrl) {
  const requestUrl = getRemoteRequestUrl(signalServerUrl);
  if (!requestUrl) {
    return null;
  }

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Seck-Uzak-Masaustu-Admin',
      'x-admin-key': String(getVersionConfig().adminAccessKey || '').trim(),
    },
  });

  if (!response.ok) {
    throw new Error(`Uzak lisans talepleri okunamadi: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return {
    requests: Array.isArray(payload.requests) ? payload.requests : [],
    source: 'remote',
  };
}

async function writeRemoteRequestStore(signalServerUrl, requests) {
  const requestUrl = getRemoteRequestUrl(signalServerUrl);
  if (!requestUrl) {
    return null;
  }

  const response = await fetch(requestUrl, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Seck-Uzak-Masaustu-Admin',
      'x-admin-key': String(getVersionConfig().adminAccessKey || '').trim(),
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    throw new Error(`Uzak lisans talepleri guncellenemedi: HTTP ${response.status}`);
  }

  return { source: 'remote' };
}

async function readRequestStore(signalServerUrl) {
  const remoteStore = await readRemoteRequestStore(signalServerUrl).catch(() => null);
  if (remoteStore) {
    return remoteStore;
  }

  return {
    requests: Array.isArray(readLicenseRequests().requests) ? readLicenseRequests().requests : [],
    source: 'local',
  };
}

async function writeRequestStore(signalServerUrl, requests) {
  const remoteResult = await writeRemoteRequestStore(signalServerUrl, requests).catch(() => null);
  if (remoteResult) {
    return remoteResult;
  }

  writeLicenseRequests({ requests });
  return { source: 'local' };
}

async function getAdminDashboard({ signalServerUrl } = {}) {
  const licenseStore = await readLicenseStore();
  const requestStore = await readRequestStore(signalServerUrl);
  return {
    source: licenseStore.source,
    requests: sortRequests(Array.isArray(requestStore.requests) ? requestStore.requests : []),
    licenses: sortLicenses(licenseStore.data?.devices || {}),
  };
}

async function upsertLicense({ deviceCode, name, expires, active }) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);
  if (!normalizedDeviceCode) {
    throw new Error('Bilgisayar kodu zorunlu.');
  }

  const licenseStore = await readLicenseStore();
  const nextData = {
    ...licenseStore.data,
    devices: {
      ...(licenseStore.data?.devices || {}),
      [normalizedDeviceCode]: {
        name: String(name || '').trim() || normalizedDeviceCode,
        active: active !== false,
        expires: String(expires || '').trim(),
      },
    },
  };

  await writeLicenseStore(nextData, `Lisans guncellendi: ${normalizedDeviceCode}`);
  return getAdminDashboard();
}

async function approveLicenseRequest({ deviceCode, name, expires, signalServerUrl }) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);
  const dashboard = await upsertLicense({
    deviceCode: normalizedDeviceCode,
    name,
    expires,
    active: true,
  });

  const requestStore = await readRequestStore(signalServerUrl);
  const requests = Array.isArray(requestStore.requests) ? requestStore.requests : [];
  const updatedRequests = requests.map((requestItem) => {
    if (requestItem.deviceCode !== normalizedDeviceCode) {
      return requestItem;
    }

    return {
      ...requestItem,
      status: 'approved',
      updatedAt: new Date().toISOString(),
    };
  });
  await writeRequestStore(signalServerUrl, updatedRequests);

  return {
    ...dashboard,
    requests: sortRequests(updatedRequests),
  };
}

async function deleteLicense(deviceCode) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);
  const licenseStore = await readLicenseStore();
  const nextDevices = { ...(licenseStore.data?.devices || {}) };
  delete nextDevices[normalizedDeviceCode];

  await writeLicenseStore({
    ...licenseStore.data,
    devices: nextDevices,
  }, `Lisans silindi: ${normalizedDeviceCode}`);

  return getAdminDashboard();
}

async function deleteLicenseRequest(deviceCode, signalServerUrl) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);
  const requestStore = await readRequestStore(signalServerUrl);
  const requests = Array.isArray(requestStore.requests) ? requestStore.requests : [];
  const updatedRequests = requests.filter((requestItem) => requestItem.deviceCode !== normalizedDeviceCode);
  await writeRequestStore(signalServerUrl, updatedRequests);
  return sortRequests(updatedRequests);
}

module.exports = {
  approveLicenseRequest,
  deleteLicense,
  deleteLicenseRequest,
  getAdminDashboard,
  upsertLicense,
  verifyAdminAccessKey,
};