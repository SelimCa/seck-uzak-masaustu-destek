const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const { hasGithubRepo } = require('./runtime-config');

let ownerWindow = null;
let initialized = false;
let manualCheckRequested = false;
let isDownloadingUpdate = false;
let lastProgressBucket = -1;

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

function setWindowProgress(value) {
  const window = getDialogWindow();

  if (!window) {
    return;
  }

  window.setProgressBar(value);
}

function showDownloadNotification(body) {
  const window = getDialogWindow();

  if (window && !window.isVisible()) {
    window.showInactive();
  }

  if (!app.isPackaged) {
    return;
  }

  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      new Notification({
        title: 'Guncelleme',
        body,
        silent: true,
      }).show();
    }
  }
  catch {
  }
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
      if (isDownloadingUpdate) {
        return;
      }

      isDownloadingUpdate = true;
      lastProgressBucket = -1;
      setWindowProgress(0.02);
      showDownloadNotification(`v${info.version} indirilmeye basladi. Tamamlaninca kurulum sorulacak.`);

      try {
        await autoUpdater.downloadUpdate();
      }
      catch (error) {
        isDownloadingUpdate = false;
        setWindowProgress(-1);

        await dialog.showMessageBox(getDialogWindow(), {
          type: 'warning',
          buttons: ['Tamam'],
          defaultId: 0,
          title: 'Guncelleme hatasi',
          message: 'Guncelleme indirilemedi.',
          detail: sanitizeUpdaterErrorMessage(error),
        });
      }
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (!isDownloadingUpdate) {
      return;
    }

    const percent = Number(progress?.percent || 0);
    const normalized = Math.max(0.02, Math.min(percent / 100, 1));
    setWindowProgress(normalized);

    const progressBucket = Math.floor(percent / 25);
    if (progressBucket > lastProgressBucket) {
      lastProgressBucket = progressBucket;
      showDownloadNotification(`Guncelleme indiriliyor: %${Math.round(percent)}`);
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
    isDownloadingUpdate = false;
    setWindowProgress(-1);
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
    isDownloadingUpdate = false;
    setWindowProgress(-1);

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