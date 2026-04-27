'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData:         ()      => ipcRenderer.invoke('get-data'),
  saveQuarters:    (q)     => ipcRenderer.invoke('save-quarters', q),
  saveLabels:      (l)     => ipcRenderer.invoke('save-labels', l),
  saveSyncURL:     (url)   => ipcRenderer.invoke('save-sync-url', url),
  setBusinessDays: (val)   => ipcRenderer.invoke('set-business-days', val),
  syncFromWeb:     ()      => ipcRenderer.invoke('sync-from-web'),
  setLaunchLogin:  (val)   => ipcRenderer.invoke('set-launch-at-login', val),
  resizeWindow:    (h)     => ipcRenderer.invoke('resize-window', h),
  openEmail:       ()      => ipcRenderer.invoke('open-email'),
  quit:            ()      => ipcRenderer.invoke('quit'),
  onUpdate:        (cb)    => ipcRenderer.on('update', (_, data) => cb(data))
});

contextBridge.exposeInMainWorld('trayApi', {
  onRender:        (cb)         => ipcRenderer.on('render-tray-icon', (_, data) => cb(data)),
  reportRendered:  (id, dataUrl) => ipcRenderer.invoke('tray-icon-rendered', { id, dataUrl })
});
