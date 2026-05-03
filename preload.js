const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  openFolder: () => ipcRenderer.invoke('open-folder-dialog'),

  readFolder: (folderPath, options) => ipcRenderer.invoke('read-folder', folderPath, options || {}),
  inspectFolder: (folderPath) => ipcRenderer.invoke('inspect-folder', folderPath),
  readImage: (filePath) => ipcRenderer.invoke('read-image', filePath),
  readZipList: (filePath) => ipcRenderer.invoke('read-zip-list', filePath),
  readZipDir: (filePath, prefix) => ipcRenderer.invoke('read-zip-dir', filePath, prefix),
  readZipImage: (filePath, entryName) => ipcRenderer.invoke('read-zip-image', filePath, entryName),
  getFileType: (filePath) => ipcRenderer.invoke('get-file-type', filePath),
  setActiveRoot: (targetPath) => ipcRenderer.invoke('set-active-root', targetPath),
  readDirEntries: (dirPath) => ipcRenderer.invoke('read-dir-entries', dirPath),
  deleteFile: (filePath, opts) => ipcRenderer.invoke('delete-file', filePath, opts || {}),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  saveImage: (filePath, dataUrl) => ipcRenderer.invoke('save-image', filePath, dataUrl),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_, val) => cb(val))
});
