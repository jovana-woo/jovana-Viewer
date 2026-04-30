const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const LIMITS = {
  MAX_IMAGE_BYTES: 200 * 1024 * 1024,     // 200MB per image
  MAX_DATA_URL_LENGTH: 300 * 1024 * 1024, // 300MB (base64 string)
  MAX_ZIP_ENTRIES: 50000
};

// outer zip: yauzl 기반 (파일 전체를 메모리에 올리지 않음 → 크기 제한 없음)
const outerZipCache = new Map(); // filePath → { zipfile, entryMap: Map<name, entry> }
const innerZipCache = new Map(); // 'outerPath::innerName' → JSZip
const allowedRoots = [];
const MAX_ALLOWED_ROOTS = 8;

function decodeZipName(buf) {
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

async function getOuterZip(filePath) {
  if (outerZipCache.has(filePath)) return outerZipCache.get(filePath);
  console.log('[YAUZL] 열기 시작:', path.basename(filePath));
  const { zipfile, entryMap } = await new Promise((resolve, reject) => {
    const yauzl = require('yauzl');
    const timer = setTimeout(() => reject(new Error('Zip open timed out (60s)')), 60000);
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zf) => {
      if (err) { clearTimeout(timer); return reject(err); }
      console.log('[YAUZL] 파일 열림, 엔트리 스캔 중...');
      const map = new Map();
      zf.readEntry();
      zf.on('entry', entry => {
        const name = decodeZipName(entry.fileName);
        if (!name.endsWith('/') && !name.endsWith('\\')) {
          entry._name = name;
          map.set(name, entry);
        }
        zf.readEntry();
      });
      zf.on('end', () => { clearTimeout(timer); console.log('[YAUZL] 완료, 엔트리 수:', map.size); resolve({ zipfile: zf, entryMap: map }); });
      zf.on('error', e => { clearTimeout(timer); reject(e); });
    });
  });
  if (entryMap.size > LIMITS.MAX_ZIP_ENTRIES) {
    zipfile.close();
    throw new Error('Zip has too many entries');
  }
  if (outerZipCache.size >= 3) {
    const oldKey = outerZipCache.keys().next().value;
    try { outerZipCache.get(oldKey).zipfile.close(); } catch {}
    outerZipCache.delete(oldKey);
  }
  const cached = { zipfile, entryMap };
  outerZipCache.set(filePath, cached);
  return cached;
}

function readYauzlEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

async function getInnerZip(outerPath, innerName) {
  const key = outerPath + '::' + innerName;
  if (!innerZipCache.has(key)) {
    const { zipfile, entryMap } = await getOuterZip(outerPath);
    const entry = entryMap.get(innerName);
    if (!entry) throw new Error('Inner zip entry not found');
    const data = await readYauzlEntry(zipfile, entry);
    const JSZip = require('jszip');
    const decodeFileName = bytes => {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return new TextDecoder('euc-kr').decode(bytes); }
    };
    const inner = await JSZip.loadAsync(data, { decodeFileName });
    if (Object.keys(inner.files).length > LIMITS.MAX_ZIP_ENTRIES) {
      throw new Error('Inner zip has too many entries');
    }
    innerZipCache.set(key, inner);
    if (innerZipCache.size > 10) innerZipCache.delete(innerZipCache.keys().next().value);
  }
  return innerZipCache.get(key);
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function isSafePathInput(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isSafeNewName(newName) {
  if (!isSafePathInput(newName)) return false;
  const trimmed = newName.trim();
  if (path.basename(trimmed) !== trimmed) return false;
  if (trimmed.includes('..')) return false;
  if (/[\\/]/.test(trimmed)) return false;
  if (trimmed.includes(':')) return false;
  return true;
}

function normalizePath(p) {
  return path.resolve(p);
}

function toCmpPath(p) {
  const normalized = normalizePath(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function addAllowedRoot(candidatePath) {
  const resolved = normalizePath(candidatePath);
  const cmp = toCmpPath(resolved);
  const idx = allowedRoots.findIndex(r => toCmpPath(r) === cmp);
  if (idx >= 0) allowedRoots.splice(idx, 1);
  allowedRoots.unshift(resolved);
  if (allowedRoots.length > MAX_ALLOWED_ROOTS) allowedRoots.pop();
}

function isWithinAllowedRoots(targetPath) {
  if (!allowedRoots.length) return false;
  const targetCmp = toCmpPath(targetPath);
  return allowedRoots.some(root => {
    const rootCmp = toCmpPath(root);
    return targetCmp === rootCmp || targetCmp.startsWith(rootCmp + path.sep);
  });
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

// 현재 열람 루트 등록 (쓰기 동작 범위 제한용)
ipcMain.handle('set-active-root', async (_, targetPath) => {
  try {
    if (!isSafePathInput(targetPath)) return { success: false, error: 'Invalid path' };
    const st = safeStat(targetPath);
    if (!st) return { success: false, error: 'Path not found' };
    const root = st.isDirectory() ? targetPath : path.dirname(targetPath);
    addAllowedRoot(root);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
    if (!isSafePathInput(filePath)) return null;
    const st = safeStat(filePath);
    if (!st || !st.isFile() || st.size > LIMITS.MAX_IMAGE_BYTES) return null;
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
    if (!isSafePathInput(filePath)) return [];
    const { entryMap } = await getOuterZip(filePath);
    const allNames = [...entryMap.keys()];

    // 1) 이미지 파일 찾기 (깊이 무관)
    const images = allNames
      .filter(n => imgExts.includes(path.extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (images.length > 0) return images;

    // 2) 내부 zip/cbz 파일이 있으면 각각 열어서 이미지 수집
    const innerZips = allNames
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
    if (!isSafePathInput(filePath) || !isSafePathInput(entryName)) return null;
    let imgData, entryForExt;
    if (entryName.includes('::')) {
      const sep = entryName.indexOf('::');
      const innerZipName = entryName.slice(0, sep);
      const innerEntry = entryName.slice(sep + 2);
      const inner = await getInnerZip(filePath, innerZipName);
      const file = inner.files[innerEntry];
      if (!file) return null;
      if (typeof file._data?.uncompressedSize === 'number' && file._data.uncompressedSize > LIMITS.MAX_IMAGE_BYTES) return null;
      imgData = await file.async('base64');
      entryForExt = innerEntry;
    } else {
      const { zipfile, entryMap } = await getOuterZip(filePath);
      const entry = entryMap.get(entryName);
      if (!entry) return null;
      if (entry.uncompressedSize > LIMITS.MAX_IMAGE_BYTES) return null;
      const buf = await readYauzlEntry(zipfile, entry);
      imgData = buf.toString('base64');
      entryForExt = entryName;
    }
    if (imgData.length > LIMITS.MAX_DATA_URL_LENGTH) return null;
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
    if (!isSafePathInput(filePath)) return { success: false, error: 'Invalid path' };
    if (!isWithinAllowedRoots(filePath)) return { success: false, error: 'Path is outside allowed root' };
    await shell.trashItem(filePath);
    if (outerZipCache.has(filePath)) {
      try { outerZipCache.get(filePath).zipfile.close(); } catch {}
      outerZipCache.delete(filePath);
    }
    for (const k of [...innerZipCache.keys()]) {
      if (k.startsWith(filePath + '::')) innerZipCache.delete(k);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 파일/폴더 이름 변경
ipcMain.handle('rename-file', async (_, oldPath, newName) => {
  try {
    if (!isSafePathInput(oldPath)) return { success: false, error: 'Invalid path' };
    if (!isSafeNewName(newName)) return { success: false, error: 'Invalid file name' };
    if (!isWithinAllowedRoots(oldPath)) return { success: false, error: 'Path is outside allowed root' };
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName.trim());
    fs.renameSync(oldPath, newPath);
    if (outerZipCache.has(oldPath)) {
      try { outerZipCache.get(oldPath).zipfile.close(); } catch {}
      outerZipCache.delete(oldPath);
    }
    for (const k of [...innerZipCache.keys()]) {
      if (k.startsWith(oldPath + '::')) innerZipCache.delete(k);
    }
    return { success: true, newPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 디렉토리 내 폴더/파일 목록 읽기
ipcMain.handle('read-dir-entries', async (_, dirPath) => {
  const supportedExts = ['.zip', '.cbz', '.cbr', '.rar', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    if (!isSafePathInput(dirPath)) return { dirs: [], files: [], parent: null };
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
    if (!isSafePathInput(filePath)) return { success: false, error: 'Invalid path' };
    if (!isWithinAllowedRoots(filePath)) return { success: false, error: 'Path is outside allowed root' };
    if (typeof dataUrl !== 'string' || dataUrl.length === 0 || dataUrl.length > LIMITS.MAX_DATA_URL_LENGTH) {
      return { success: false, error: 'Invalid image data' };
    }
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    if (base64.length > LIMITS.MAX_DATA_URL_LENGTH) return { success: false, error: 'Image too large' };
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// zip 내부 디렉토리 탐색 (한 레벨씩)
ipcMain.handle('read-zip-dir', async (_, filePath, prefix) => {
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    if (!isSafePathInput(filePath)) return { folders: [], images: [] };
    const { entryMap } = await getOuterZip(filePath);
    const pfx = prefix ? (prefix.endsWith('/') ? prefix : prefix + '/') : '';
    const folders = new Set();
    const images = [];
    for (const name of entryMap.keys()) {
      if (!name.startsWith(pfx)) continue;
      const rel = name.slice(pfx.length);
      if (!rel) continue;
      const slashIdx = rel.indexOf('/');
      if (slashIdx === -1) {
        if (imgExts.includes(path.extname(rel).toLowerCase())) images.push(name);
      } else {
        folders.add(rel.slice(0, slashIdx));
      }
    }
    return {
      folders: [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      images: images.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    };
  } catch {
    return { folders: [], images: [] };
  }
});

// 파일 드롭 처리
ipcMain.handle('get-file-type', async (_, filePath) => {
  if (!isSafePathInput(filePath)) return 'unknown';
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
