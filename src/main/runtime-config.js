const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_CONFIG = {
  appVersion: '0.1.0',
  githubRepo: 'SelimCa/seck-uzak-masaustu-destek',
  licenseFile: 'licenses.json',
};

function getWorkspaceRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, '../..');
}

function getVersionConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(getWorkspaceRoot(), 'version.json'), 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  }
  catch {
    return { ...DEFAULT_CONFIG };
  }
}

function hasGithubRepo() {
  const repo = String(getVersionConfig().githubRepo || '').trim();
  return repo.includes('/') && !repo.includes('GITHUB_KULLANICISI');
}

module.exports = {
  getVersionConfig,
  hasGithubRepo,
};