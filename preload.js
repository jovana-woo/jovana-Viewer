const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  openFolder: () => ipcRenderer.invoke('open-folder-dialog'),

  readFolder: (folderPath) => ipcRenderer.invoke('read-folder', folderPath),
  readImage: (filePath) => ipcRenderer.invoke('read-image', filePath),
  readZipList: (filePath) => ipcRenderer.invoke('read-zip-list', filePath),
  readZipImage: (filePath, entryName) => ipcRenderer.invoke('read-zip-image', filePath, entryName),
  getFileType: (filePath) => ipcRenderer.invoke('get-file-type', filePath),
  readDirEntries: (dirPath) => ipcRenderer.invoke('read-dir-entries', dirPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  saveImage: (filePath, dataUrl) => ipcRenderer.invoke('save-image', filePath, dataUrl),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_, val) => cb(val))
});
