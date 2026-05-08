const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const { getVersionConfig, hasGithubRepo } = require('./runtime-config');

function getCachePath() {
  return path.join(app.getPath('userData'), 'license-cache.json');
}

function normalizeLicenseKey(licenseKey) {
  return String(licenseKey || '').trim().toUpperCase();
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

function evaluateLicense(licenseKey, data) {
  const normalizedKey = normalizeLicenseKey(licenseKey);

  if (!normalizedKey) {
    return {
      ok: false,
      code: 'missing',
      message: 'Lisans anahtari girilmemis. Uzak baglanti ozellikleri kilitli.',
      licensedTo: '',
      expires: '',
      isDevMode: false,
    };
  }

  const licenses = data?.licenses || {};
  const record = licenses[normalizedKey];

  if (!record) {
    return {
      ok: false,
      code: 'not-found',
      message: 'Girilen lisans anahtari kayitlarda bulunamadi.',
      licensedTo: '',
      expires: '',
      isDevMode: false,
    };
  }

  if (!record.active) {
    return {
      ok: false,
      code: 'inactive',
      message: 'Bu lisans yonetici tarafinda devre disi birakilmis.',
      licensedTo: record.name || '',
      expires: record.expires || '',
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
    isDevMode: false,
  };
}

async function refreshLicenseStatus(licenseKey) {
  const normalizedKey = normalizeLicenseKey(licenseKey);

  if (!hasGithubRepo()) {
    return {
      ok: true,
      code: 'dev',
      message: 'Gelistirici modu: GitHub repo ayari yapilmadigi icin lisans zorunlu degil.',
      licensedTo: 'Gelistirici Modu',
      expires: '',
      isDevMode: true,
    };
  }

  const cachedIndex = readCache();
  if (cachedIndex) {
    const cachedStatus = evaluateLicense(normalizedKey, cachedIndex);
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
    return evaluateLicense(normalizedKey, liveIndex);
  }

  if (cachedIndex) {
    return {
      ...evaluateLicense(normalizedKey, cachedIndex),
      message: 'Lisans sunucusuna ulasilamadi. Son bilinen lisans kaydi kullanildi.',
    };
  }

  return {
    ok: false,
    code: 'offline',
    message: 'Lisans sunucusuna ulasilamadi. Internet baglantisini ve GitHub dosyalarini kontrol et.',
    licensedTo: '',
    expires: '',
    isDevMode: false,
  };
}

module.exports = {
  refreshLicenseStatus,
};