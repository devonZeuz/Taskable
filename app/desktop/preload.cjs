const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskableDesktop', {
  isDesktop: true,
  getState: () => ipcRenderer.invoke('desktop:getState'),
  toggleCompact: () => ipcRenderer.invoke('desktop:toggleCompact'),
  openCompact: () => ipcRenderer.invoke('desktop:openCompact'),
  closeCompact: () => ipcRenderer.invoke('desktop:closeCompact'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('desktop:setAlwaysOnTop', Boolean(enabled)),
  openFull: (payload) => ipcRenderer.invoke('desktop:openFull', payload),
  focusMain: () => ipcRenderer.invoke('desktop:focusMain'),
  openTask: (taskId) => ipcRenderer.invoke('desktop:openTask', taskId),
  onStateChange: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', handler);
    return () => ipcRenderer.removeListener('desktop:state', handler);
  },
});
