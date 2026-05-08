const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const { hasGithubRepo } = require('./runtime-config');

let ownerWindow = null;
let initialized = false;
let manualCheckRequested = false;

function sanitizeUpdaterErrorMessage(error) {
  const rawMessage = String(error?.message || '').trim();

  if (!rawMessage) {
    return 'Sunucuya ulasilamadi. Internet baglantisini ve guncelleme paketlerini kontrol et.';
  }

  if (rawMessage.includes('status 404') || rawMessage.includes('Cannot download')) {
    return 'Guncelleme paketi sunucuda bulunamadi. Biraz sonra tekrar dene.';
  }

  if (/github|https?:\/\//i.test(rawMessage)) {
    return 'Guncelleme sunucusuna baglanilamadi. Daha sonra tekrar dene.';
  }

  return rawMessage;
}

function normalizeReleaseNotes(notes) {
  if (Array.isArray(notes)) {
    return notes.map((item) => item.note || '').filter(Boolean).join('\n\n');
  }

  return String(notes || '').trim();
}

function getDialogWindow() {
  return ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : null;
}

function initUpdater(window) {
  ownerWindow = window;

  if (initialized || !hasGithubRepo() || !app.isPackaged) {
    return initialized;
  }

  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox(getDialogWindow(), {
      type: 'info',
      buttons: ['Guncellemeyi indir', 'Sonra'],
      defaultId: 0,
      cancelId: 1,
      title: 'Yeni surum hazir',
      message: `Yeni surum bulundu: v${info.version}`,
      detail: normalizeReleaseNotes(info.releaseNotes) || 'Programi kapatmadan guncellemeyi indirebilirsin.',
    });

    if (result.response === 0) {
      await autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-not-available', async () => {
    if (!manualCheckRequested) {
      return;
    }

    manualCheckRequested = false;
    await dialog.showMessageBox(getDialogWindow(), {
      type: 'info',
      buttons: ['Tamam'],
      defaultId: 0,
      title: 'Guncelleme yok',
      message: 'Bu cihazda zaten en guncel surum kurulu.',
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    manualCheckRequested = false;
    const result = await dialog.showMessageBox(getDialogWindow(), {
      type: 'question',
      buttons: ['Simdi kur ve yeniden baslat', 'Daha sonra'],
      defaultId: 0,
      cancelId: 1,
      title: 'Guncelleme indirildi',
      message: `v${info.version} indirildi. Kurulum simdi baslatilsin mi?`,
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', async (error) => {
    if (!manualCheckRequested) {
      return;
    }

    manualCheckRequested = false;
    await dialog.showMessageBox(getDialogWindow(), {
      type: 'warning',
      buttons: ['Tamam'],
      defaultId: 0,
      title: 'Guncelleme hatasi',
      message: 'Guncelleme kontrolu basarisiz oldu.',
      detail: sanitizeUpdaterErrorMessage(error),
    });
  });

  return true;
}

async function checkForAppUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    return { ok: false, message: 'Guncelleme kontrolu yalnizca kurulu surumde calisir.' };
  }

  if (!initialized || !hasGithubRepo()) {
    return { ok: false, message: 'GitHub repo ayari yapilmadigi icin guncelleme kapali.' };
  }

  manualCheckRequested = manual;
  await autoUpdater.checkForUpdates();
  return { ok: true };
}

module.exports = {
  initUpdater,
  checkForAppUpdates,
};