const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anydeksApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setServerUrl: (value) => ipcRenderer.invoke('config:set-server-url', value),
  setNetworkConfig: (value) => ipcRenderer.invoke('config:set-network', value),
  setFixedPassword: (value) => ipcRenderer.invoke('config:set-fixed-password', value),
  setLicenseKey: (value) => ipcRenderer.invoke('config:set-license-key', value),
  getSecretState: () => ipcRenderer.invoke('config:get-secret-state'),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check-now'),
  validateCredential: (value) => ipcRenderer.invoke('auth:validate-credential', value),
  getDisplayInfo: () => ipcRenderer.invoke('desktop:get-display-info'),
  listDesktopSources: () => ipcRenderer.invoke('desktop:list-sources'),
  setDesktopSource: (value) => ipcRenderer.invoke('desktop:set-source', value),
  performInput: (payload) => ipcRenderer.invoke('input:perform', payload),
  saveIncomingFile: (payload) => ipcRenderer.invoke('files:save', payload),
});