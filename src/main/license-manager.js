const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const { getVersionConfig, hasGithubRepo } = require('./runtime-config');

function normalizeDeviceCode(deviceCode) {
  const digits = String(deviceCode || '').replace(/[^0-9]/g, '');
  if (digits.length !== 9) {
    return String(deviceCode || '').trim();
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

function getCachePath() {
  return path.join(app.getPath('userData'), 'license-cache.json');
}

function resolveWebhookUrl(webhookUrl, signalServerUrl) {
  const rawWebhookUrl = String(webhookUrl || '').trim();
  const rawSignalServerUrl = String(signalServerUrl || '').trim();

  if (!rawWebhookUrl && !rawSignalServerUrl) {
    return '';
  }

  if (/^https?:\/\//i.test(rawWebhookUrl)) {
    return rawWebhookUrl;
  }

  if (!rawSignalServerUrl) {
    return '';
  }

  const baseUrl = rawSignalServerUrl.endsWith('/') ? rawSignalServerUrl : `${rawSignalServerUrl}/`;
  const pathName = rawWebhookUrl || '/license-request';
  return new URL(pathName, baseUrl).toString();
}

function isLocalWebhookTarget(webhookUrl, signalServerUrl) {
  const rawWebhookUrl = String(webhookUrl || '').trim();
  const rawSignalServerUrl = String(signalServerUrl || '').trim();

  if (/^https?:\/\//i.test(rawWebhookUrl)) {
    return false;
  }

  if (!rawSignalServerUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(rawSignalServerUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
  }
  catch {
    return false;
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(getCachePath(), 'utf8'));
  }
  catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getCachePath(), JSON.stringify(data, null, 2), 'utf8');
  }
  catch {
  }
}

async function fetchJson(url, headers = {}, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  }
  finally {
    clearTimeout(timer);
  }
}

function buildLicenseUrls() {
  const versionConfig = getVersionConfig();
  const repo = String(versionConfig.githubRepo || '').trim();
  const fileName = String(versionConfig.licenseFile || 'licenses.json').trim() || 'licenses.json';
  const cacheBuster = Date.now();

  return [
    `https://raw.githubusercontent.com/${repo}/main/${fileName}?_=${cacheBuster}`,
    `https://raw.githubusercontent.com/${repo}/master/${fileName}?_=${cacheBuster}`,
    `https://cdn.jsdelivr.net/gh/${repo}@main/${fileName}?_=${cacheBuster}`,
    `https://cdn.jsdelivr.net/gh/${repo}@master/${fileName}?_=${cacheBuster}`,
    `https://api.github.com/repos/${repo}/contents/${fileName}?ref=main`,
    `https://api.github.com/repos/${repo}/contents/${fileName}?ref=master`,
  ];
}

async function fetchLicenseIndex() {
  if (!hasGithubRepo()) {
    return null;
  }

  for (const url of buildLicenseUrls()) {
    try {
      const payload = await fetchJson(url, {
        'User-Agent': 'Seck-Uzak-Masaustu-License',
        Accept: 'application/vnd.github+json',
        'Cache-Control': 'no-cache',
      }, 6000);

      if (url.includes('api.github.com/repos/')) {
        if (!payload.content) {
          continue;
        }

        const decoded = Buffer.from(String(payload.content).replace(/\n/g, ''), 'base64').toString('utf8');
        return JSON.parse(decoded);
      }

      return payload;
    }
    catch {
    }
  }

  return null;
}

function evaluateLicense(deviceCode, data) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);

  if (!normalizedDeviceCode) {
    return {
      ok: false,
      code: 'missing',
      message: 'Bilgisayar kodu bulunamadi. Lisans kontrolu yapilamadi.',
      licensedTo: '',
      expires: '',
      deviceCode: '',
      isDevMode: false,
    };
  }

  const devices = data?.devices || {};
  const record = devices[normalizedDeviceCode];

  if (!record) {
    return {
      ok: false,
      code: 'not-found',
      message: `Bu bilgisayar kodu icin lisans bulunamadi: ${normalizedDeviceCode}`,
      licensedTo: '',
      expires: '',
      deviceCode: normalizedDeviceCode,
      isDevMode: false,
    };
  }

  if (!record.active) {
    return {
      ok: false,
      code: 'inactive',
      message: 'Bu bilgisayar icin lisans yonetici tarafinda devre disi birakilmis.',
      licensedTo: record.name || '',
      expires: record.expires || '',
      deviceCode: normalizedDeviceCode,
      isDevMode: false,
    };
  }

  if (record.expires) {
    const today = new Date();
    const expiry = new Date(record.expires);
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    if (!Number.isNaN(expiry.getTime()) && today > expiry) {
      return {
        ok: false,
        code: 'expired',
        message: `Bu lisansin suresi dolmus: ${record.expires}`,
        licensedTo: record.name || '',
        expires: record.expires || '',
        deviceCode: normalizedDeviceCode,
        isDevMode: false,
      };
    }
  }

  return {
    ok: true,
    code: 'valid',
    message: `Lisans aktif${record.name ? `: ${record.name}` : ''}.`,
    licensedTo: record.name || '',
    expires: record.expires || '',
    deviceCode: normalizedDeviceCode,
    isDevMode: false,
  };
}

async function refreshLicenseStatus(deviceCode) {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);

  if (!hasGithubRepo()) {
    return {
      ok: true,
      code: 'dev',
      message: 'Gelistirici modu: GitHub repo ayari yapilmadigi icin lisans zorunlu degil.',
      licensedTo: 'Gelistirici Modu',
      expires: '',
      deviceCode: normalizedDeviceCode,
      isDevMode: true,
    };
  }

  const cachedIndex = readCache();
  if (cachedIndex) {
    const cachedStatus = evaluateLicense(normalizedDeviceCode, cachedIndex);
    if (cachedStatus.ok) {
      void fetchLicenseIndex().then((liveIndex) => {
        if (liveIndex) {
          writeCache(liveIndex);
        }
      });
      return cachedStatus;
    }
  }

  const liveIndex = await fetchLicenseIndex();
  if (liveIndex) {
    writeCache(liveIndex);
    return evaluateLicense(normalizedDeviceCode, liveIndex);
  }

  if (cachedIndex) {
    return {
      ...evaluateLicense(normalizedDeviceCode, cachedIndex),
      message: 'Lisans sunucusuna ulasilamadi. Son bilinen lisans kaydi kullanildi.',
    };
  }

  return {
    ok: false,
    code: 'offline',
    message: 'Lisans sunucusuna ulasilamadi. Internet baglantisini ve GitHub dosyalarini kontrol et.',
    licensedTo: '',
    expires: '',
    deviceCode: normalizedDeviceCode,
    isDevMode: false,
  };
}

async function submitLicenseRequest({ deviceCode, deviceName, appVersion, signalServerUrl, allowLocalSubmission = false }) {
  const { licenseRequestWebhookUrl } = getVersionConfig();

  if (!allowLocalSubmission && isLocalWebhookTarget(licenseRequestWebhookUrl, signalServerUrl)) {
    return {
      ok: false,
      message: 'Lisans talebi yerel bilgisayara gidiyor. Bildirimin yoneticiye dusmesi icin ortak sinyal sunucusu adresi kullanilmali.',
    };
  }

  const webhookUrl = resolveWebhookUrl(licenseRequestWebhookUrl, signalServerUrl);

  if (!webhookUrl) {
    return {
      ok: false,
      message: 'Lisans talep webhook adresi cozulmedi. Public sunucu adresini kontrol et.',
    };
  }

  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Seck-Uzak-Masaustu-LicenseRequest',
    },
    body: JSON.stringify({
      event: 'license_request',
      deviceCode: normalizedDeviceCode,
      deviceName: String(deviceName || '').trim(),
      appVersion: String(appVersion || '').trim(),
      requestedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook istegi basarisiz: HTTP ${response.status}`);
  }

  return {
    ok: true,
    message: 'Lisans talebi gonderildi.',
  };
}

module.exports = {
  refreshLicenseStatus,
  submitLicenseRequest,
};