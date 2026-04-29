const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// zip 캐시 (대용량 파일 반복 읽기 방지)
const zipCache = new Map();    // filePath → JSZip
const innerZipCache = new Map(); // 'outerPath::innerName' → JSZip

async function getZip(filePath) {
  if (!zipCache.has(filePath)) {
    const JSZip = require('jszip');
    const data = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(data);
    zipCache.set(filePath, zip);
    if (zipCache.size > 3) zipCache.delete(zipCache.keys().next().value);
  }
  return zipCache.get(filePath);
}

async function getInnerZip(outerPath, innerName) {
  const key = outerPath + '::' + innerName;
  if (!innerZipCache.has(key)) {
    const outer = await getZip(outerPath);
    const data = await outer.files[innerName].async('arraybuffer');
    const JSZip = require('jszip');
    const inner = await JSZip.loadAsync(data);
    innerZipCache.set(key, inner);
    if (innerZipCache.size > 10) innerZipCache.delete(innerZipCache.keys().next().value);
  }
  return innerZipCache.get(key);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#24273a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen-changed', false));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 파일/폴더 열기 다이얼로그
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '지원 파일', extensions: ['zip', 'cbz', 'cbr', 'rar', 'jpg', 'jpeg', 'png', 'webp', 'gif'] },
      { name: '압축 파일', extensions: ['zip', 'cbz', 'cbr', 'rar'] },
      { name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
    ]
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// 폴더 내 이미지 목록 읽기
ipcMain.handle('read-folder', async (_, folderPath) => {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    const files = fs.readdirSync(folderPath)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(f => path.join(folderPath, f));
    return files;
  } catch {
    return [];
  }
});

// 이미지 파일을 base64로 읽기
ipcMain.handle('read-image', async (_, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// zip 파일 내 이미지 목록 읽기 (중첩 zip 지원)
ipcMain.handle('read-zip-list', async (_, filePath) => {
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const zipExts = ['.zip', '.cbz'];
  try {
    const zip = await getZip(filePath);
    const allEntries = Object.keys(zip.files).filter(n => !zip.files[n].dir);

    // 1) 최상위에 이미지가 있으면 그대로 반환
    const topImages = allEntries
      .filter(n => imgExts.includes(path.extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (topImages.length > 0) return topImages;

    // 2) 내부에 zip/cbz 파일이 있으면 각각 열어서 이미지 수집
    const innerZips = allEntries
      .filter(n => zipExts.includes(path.extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const result = [];
    for (const innerName of innerZips) {
      try {
        const inner = await getInnerZip(filePath, innerName);
        const imgs = Object.keys(inner.files)
          .filter(n => !inner.files[n].dir && imgExts.includes(path.extname(n).toLowerCase()))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        imgs.forEach(img => result.push(innerName + '::' + img));
      } catch {}
    }
    return result;
  } catch {
    return [];
  }
});

// zip 파일 내 특정 이미지 읽기 (중첩 zip 지원: 'inner.zip::image.jpg')
ipcMain.handle('read-zip-image', async (_, filePath, entryName) => {
  try {
    let file;
    let entryForExt = entryName;
    if (entryName.includes('::')) {
      const sep = entryName.indexOf('::');
      const innerZipName = entryName.slice(0, sep);
      const innerEntry  = entryName.slice(sep + 2);
      const inner = await getInnerZip(filePath, innerZipName);
      file = inner.files[innerEntry];
      entryForExt = innerEntry;
    } else {
      const zip = await getZip(filePath);
      file = zip.files[entryName];
    }
    if (!file) return null;
    const imgData = await file.async('base64');
    const ext = path.extname(entryForExt).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${imgData}`;
  } catch {
    return null;
  }
});

// 전체화면 토글
ipcMain.handle('toggle-fullscreen', () => {
  const isFull = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFull);
  return !isFull;
});

ipcMain.handle('exit-fullscreen', () => {
  mainWindow.setFullScreen(false);
  return false;
});

ipcMain.handle('is-fullscreen', () => {
  return mainWindow.isFullScreen();
});

// 파일 삭제 (휴지통으로 이동)
ipcMain.handle('delete-file', async (_, filePath) => {
  try {
    await shell.trashItem(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 파일/폴더 이름 변경
ipcMain.handle('rename-file', async (_, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 디렉토리 내 폴더/파일 목록 읽기
ipcMain.handle('read-dir-entries', async (_, dirPath) => {
  const supportedExts = ['.zip', '.cbz', '.cbr', '.rar', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const files = entries
      .filter(e => e.isFile() && supportedExts.includes(path.extname(e.name).toLowerCase()))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const parent = path.dirname(dirPath);
    return { dirs, files, parent: parent !== dirPath ? parent : null };
  } catch {
    return { dirs: [], files: [], parent: null };
  }
});

// 이미지 파일 저장 (회전 후 덮어쓰기)
ipcMain.handle('save-image', async (_, filePath, dataUrl) => {
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 파일 드롭 처리
ipcMain.handle('get-file-type', async (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const zipExts = ['.zip', '.cbz', '.cbr', '.rar'];
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  if (zipExts.includes(ext)) return 'zip';
  if (imgExts.includes(ext)) return 'image';
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return 'folder';
  } catch {}
  return 'unknown';
});
