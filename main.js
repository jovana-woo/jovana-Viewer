const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');

let mainWindow;

const LIMITS = {
  MAX_IMAGE_BYTES: 200 * 1024 * 1024,     // 200MB per image
  MAX_NESTED_ZIP_BYTES: 512 * 1024 * 1024, // 권.zip 통째 읽기 상한
  MAX_DATA_URL_LENGTH: 300 * 1024 * 1024, // 300MB (base64 string)
  MAX_ZIP_ENTRIES: 50000
};

const innerZipCache = new Map(); // 'outerPath::innerName' → JSZip
let zipOpQueue = Promise.resolve();
const allowedRoots = [];
const MAX_ALLOWED_ROOTS = 8;

function runZipOp(task) {
  const next = zipOpQueue.then(task, task);
  zipOpQueue = next.then(() => {}, () => {});
  return next;
}

function zipCacheKey(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
  try {
    return path.resolve(filePath);
  } catch {
    return filePath;
  }
}

/** yauzl CD/스트림은 Worker 전용 — 메인 프로세스 힙 분리 */
let zipWorker = null;
let zipWorkerMsgId = 0;
const zipWorkerPending = new Map();
let workerZipKey = null;
let workerZipNames = [];

function spawnZipWorker() {
  if (zipWorker) return zipWorker;
  const wpath = path.join(__dirname, 'zip-reader-worker.js');
  zipWorker = new Worker(wpath);
  zipWorker.on('message', msg => {
    const { id } = msg;
    const p = zipWorkerPending.get(id);
    if (!p) return;
    zipWorkerPending.delete(id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error || 'zip worker'));
  });
  zipWorker.on('error', err => {
    for (const [, pr] of zipWorkerPending) pr.reject(err);
    zipWorkerPending.clear();
    try {
      zipWorker.terminate();
    } catch {}
    zipWorker = null;
    workerZipKey = null;
    workerZipNames = [];
  });
  return zipWorker;
}

function zipWorkerSend(payload) {
  return new Promise((resolve, reject) => {
    const id = ++zipWorkerMsgId;
    zipWorkerPending.set(id, { resolve, reject });
    spawnZipWorker().postMessage({ id, ...payload });
  });
}

async function zipWorkerForceClose() {
  if (!zipWorker) {
    workerZipKey = null;
    workerZipNames = [];
    return;
  }
  try {
    await zipWorkerSend({ op: 'close' });
  } catch {}
  workerZipKey = null;
  workerZipNames = [];
}

async function zipWorkerEnsureOpen(absPath) {
  const key = zipCacheKey(absPath);
  if (workerZipKey === key && workerZipNames.length) return;
  try {
    const res = await zipWorkerSend({ op: 'open', path: key });
    workerZipKey = key;
    workerZipNames = Array.isArray(res.names) ? res.names : [];
  } catch (e) {
    workerZipKey = null;
    workerZipNames = [];
    throw e;
  }
}

async function zipWorkerReadBuffer(absPath, entryName, maxBytes) {
  const key = zipCacheKey(absPath);
  if (workerZipKey !== key) await zipWorkerEnsureOpen(absPath);
  const res = await zipWorkerSend({ op: 'read', name: entryName, maxBytes });
  return Buffer.from(res.buffer);
}

/** inner zip(JSZip) 안에서 한 단계 폴더·이미지 목록 — read-zip-image용 `innerEntry::path` 키 */
async function listInnerZipOneLevel(outerPath, innerZipEntry, innerRelPrefix, imgExts) {
  const inner = await getInnerZip(outerPath, innerZipEntry);
  const pfx = innerRelPrefix ? (innerRelPrefix.endsWith('/') ? innerRelPrefix : innerRelPrefix + '/') : '';
  const folders = new Set();
  const images = [];
  const innerPre = innerZipEntry + '::';
  for (const n of Object.keys(inner.files)) {
    const f = inner.files[n];
    if (f.dir) continue;
    const norm = n.replace(/\\/g, '/');
    if (pfx && !norm.startsWith(pfx)) continue;
    const after = pfx ? norm.slice(pfx.length) : norm;
    if (!after) continue;
    const si = after.indexOf('/');
    if (si === -1) {
      if (imgExts.includes(path.extname(after).toLowerCase())) images.push(innerPre + norm);
    } else {
      folders.add(after.slice(0, si));
    }
  }
  const sortNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return {
    folders: [...folders].sort(sortNum),
    images: images.sort(sortNum)
  };
}

async function getInnerZip(outerPath, innerName) {
  const key = zipCacheKey(outerPath) + '::' + innerName;
  if (!innerZipCache.has(key)) {
    const data = await zipWorkerReadBuffer(outerPath, innerName, LIMITS.MAX_NESTED_ZIP_BYTES);
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
    if (innerZipCache.size > 1) innerZipCache.delete(innerZipCache.keys().next().value);
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

/** Windows 등에서 shell.trashItem이 일시 실패(Abort)할 때 재시도 */
async function moveFileToOsTrash(absPath) {
  const tries = 4;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 120 * i));
    try {
      await shell.trashItem(absPath);
      return { ok: true };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr };
}

function formatTrashError(err) {
  const m = (err && err.message) || String(err || '');
  if (/abort/i.test(m)) {
    return '휴지통으로 보낼 수 없습니다. 지금 보고 있는 페이지면 다른 쪽으로 넘긴 뒤 다시 시도하거나, 다른 프로그램·탐색기에서 이 파일을 닫아 주세요. OneDrive 폴더는 동기가 끝난 뒤에 시도해 보세요.';
  }
  return m || '휴지통 이동에 실패했습니다.';
}

/** 삭제 경로가 현재 zip 워커가 연 파일이거나 그 하위면 닫기 */
async function closeZipWorkerIfDeletingPath(absPath) {
  if (!workerZipKey) return;
  const absCmp = toCmpPath(normalizePath(absPath));
  const wkCmp = toCmpPath(workerZipKey);
  if (wkCmp === absCmp || wkCmp.startsWith(absCmp + path.sep)) {
    await zipWorkerForceClose();
  }
}

function purgeInnerZipCacheForDeletedPath(absPath) {
  const absCmp = toCmpPath(normalizePath(absPath));
  const sep = path.sep;
  for (const k of [...innerZipCache.keys()]) {
    const idx = k.indexOf('::');
    const outer = idx >= 0 ? k.slice(0, idx) : k;
    let oCmp;
    try {
      oCmp = toCmpPath(normalizePath(outer));
    } catch {
      continue;
    }
    if (oCmp === absCmp || oCmp.startsWith(absCmp + sep)) innerZipCache.delete(k);
  }
}

function formatPermanentDeleteError(err) {
  const code = err && err.code;
  const m = (err && err.message) || String(err || '');
  const uni = m.match(/unlink\s+[''](.+)['']/i) || m.match(/rmdir\s+[''](.+)['']/i);
  let fname = '';
  if (uni) {
    try {
      fname = path.basename(uni[1].replace(/^\\\\\?\\/, ''));
    } catch {}
  }
  if (code === 'EBUSY' || /EBUSY|resource busy|locked/i.test(m)) {
    return (
      '다른 프로그램이나 Windows 탐색기가 이 파일을 잡고 있어 지울 수 없습니다.' +
      (fname ? ` 문제 파일: ${fname}` : '') +
      ' 탐색기에서 해당 폴더 창을 닫거나, 미리보기·속성 창을 닫고, 백신 실시간 검사를 잠시 끈 뒤 다시 시도해 보세요. ' +
      '`.bat` 파일은 더블클릭으로 실행 중이면 안 됩니다.'
    );
  }
  if (code === 'EPERM' || code === 'EACCES' || /EPERM|EACCES/i.test(m)) {
    return '권한이 없거나 접근이 거부되었습니다. 다른 프로그램을 종료하거나, 관리자 권한으로 앱을 실행한 뒤 다시 시도해 주세요.';
  }
  return m || '삭제에 실패했습니다.';
}

/** 영구 삭제: 폴더는 Node 내장 재시도, 파일은 EBUSY 시 수동 재시도 */
async function removePathPermanentlyWithRetry(absPath) {
  const st = fs.lstatSync(absPath);
  if (st.isDirectory()) {
    let lastErr = null;
    for (let round = 0; round < 5; round++) {
      if (round > 0) await new Promise(r => setTimeout(r, 350 * round));
      try {
        fs.rmSync(absPath, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
        return;
      } catch (e) {
        lastErr = e;
        const c = e && e.code;
        if (c !== 'EBUSY' && c !== 'ENOTEMPTY' && c !== 'EPERM' && c !== 'EACCES') throw e;
      }
    }
    throw lastErr || new Error('rm dir failed');
  }
  let lastErr = null;
  for (let i = 0; i < 14; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 100 + i * 75));
    try {
      fs.rmSync(absPath, { force: true });
      return;
    } catch (e) {
      lastErr = e;
      const c = e && e.code;
      if (c !== 'EBUSY' && c !== 'EPERM' && c !== 'EACCES') throw e;
    }
  }
  throw lastErr;
}

async function collectImagePathsRecursive(folderPath, maxFiles) {
  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
  const rootResolved = path.resolve(folderPath);
  const sep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  const out = [];
  const stack = [folderPath];
  let tick = 0;
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.')) continue;
        let r;
        try {
          r = path.resolve(full);
        } catch {
          continue;
        }
        if (r !== rootResolved && !r.startsWith(sep)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.has(ext)) out.push(full);
      }
    }
    tick++;
    if (tick % 64 === 0) await new Promise(r => setImmediate(r));
  }
  out.sort((a, b) => {
    const ra = path.relative(rootResolved, a) || path.basename(a);
    const rb = path.relative(rootResolved, b) || path.basename(b);
    return ra.localeCompare(rb, undefined, { numeric: true });
  });
  return out;
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

app.on('before-quit', () => {
  try {
    if (zipWorker) {
      try {
        zipWorker.terminate();
      } catch {}
      zipWorker = null;
    }
    innerZipCache.clear();
  } catch {}
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

// 폴더 내 이미지 목록 읽기 (options.recursiveImages: 압축 풀린 트리 전체)
ipcMain.handle('read-folder', async (_, folderPath, options = {}) => {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    if (!isSafePathInput(folderPath)) return [];
    const st = safeStat(folderPath);
    if (!st || !st.isDirectory()) return [];
    const maxList = Math.min(
      Number(options.maxFiles) > 0 ? Number(options.maxFiles) : LIMITS.MAX_ZIP_ENTRIES,
      LIMITS.MAX_ZIP_ENTRIES
    );
    if (options && options.recursiveImages) {
      return collectImagePathsRecursive(folderPath, maxList);
    }
    const files = fs
      .readdirSync(folderPath)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(f => path.join(folderPath, f));
    return files;
  } catch {
    return [];
  }
});

// 폴더 내 직계 이미지/하위 폴더 유무 점검
ipcMain.handle('inspect-folder', async (_, folderPath) => {
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    if (!isSafePathInput(folderPath)) {
      return { hasDirectImages: false, hasSubdirs: false, imageCount: 0 };
    }
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    let imageCount = 0;
    let hasSubdirs = false;
    for (const entry of entries) {
      if (entry.isFile() && imgExts.includes(path.extname(entry.name).toLowerCase())) {
        imageCount += 1;
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        hasSubdirs = true;
      }
      if (imageCount > 0 && hasSubdirs) break;
    }
    return {
      hasDirectImages: imageCount > 0,
      hasSubdirs,
      imageCount
    };
  } catch {
    return { hasDirectImages: false, hasSubdirs: false, imageCount: 0 };
  }
});

// 이미지 파일 읽기 (작은 파일은 data URL, 큰 파일은 file:// 로 렌더러 부담 감소)
const READ_IMAGE_DATA_URL_MAX = 1.5 * 1024 * 1024;
ipcMain.handle('read-image', async (_, filePath) => {
  try {
    if (!isSafePathInput(filePath)) return null;
    const abs = path.resolve(filePath);
    const st = safeStat(abs);
    if (!st || !st.isFile() || st.size > LIMITS.MAX_IMAGE_BYTES) return null;
    if (st.size > READ_IMAGE_DATA_URL_MAX) {
      return pathToFileURL(abs).href;
    }
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase().replace('.', '');
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
  return runZipOp(async () => {
  try {
    if (!isSafePathInput(filePath)) return [];
    await zipWorkerEnsureOpen(filePath);
    const allNames = workerZipNames;

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
    for (const innerName of innerZips.slice(0, 3)) {
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
});

// zip 파일 내 특정 이미지 읽기 (중첩 zip 지원: 'inner.zip::image.jpg')
ipcMain.handle('read-zip-image', async (_, filePath, entryName) => {
  return runZipOp(async () => {
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
      await zipWorkerEnsureOpen(filePath);
      let buf;
      try {
        buf = await zipWorkerReadBuffer(filePath, entryName, LIMITS.MAX_IMAGE_BYTES);
      } catch {
        return null;
      }
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

// 파일 삭제 (기본: 휴지통, opts.permanent === true 이면 영구 삭제 — 렌더러에서 추가 확인 후만 호출)
ipcMain.handle('delete-file', async (_, filePath, opts = {}) => {
  const permanent = opts && opts.permanent === true;
  try {
    if (!isSafePathInput(filePath)) return { success: false, error: 'Invalid path' };
    const absPath = normalizePath(filePath);
    if (!isWithinAllowedRoots(absPath)) return { success: false, error: 'Path is outside allowed root' };
    await closeZipWorkerIfDeletingPath(absPath);
    if (permanent) {
      await removePathPermanentlyWithRetry(absPath);
    } else {
      const tr = await moveFileToOsTrash(absPath);
      if (!tr.ok) return { success: false, error: formatTrashError(tr.err) };
    }
    purgeInnerZipCacheForDeletedPath(absPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: permanent ? formatPermanentDeleteError(e) : formatTrashError(e) };
  }
});

// 파일/폴더 이름 변경
ipcMain.handle('rename-file', async (_, oldPath, newName) => {
  try {
    if (!isSafePathInput(oldPath)) return { success: false, error: 'Invalid path' };
    if (!isSafeNewName(newName)) return { success: false, error: 'Invalid file name' };
    const absOld = normalizePath(oldPath);
    if (!isWithinAllowedRoots(absOld)) return { success: false, error: 'Path is outside allowed root' };
    const dir = path.dirname(absOld);
    const newPath = path.join(dir, newName.trim());
    const zkey = zipCacheKey(absOld);
    if (workerZipKey === zkey) await zipWorkerForceClose();
    fs.renameSync(absOld, newPath);
    for (const k of [...innerZipCache.keys()]) {
      if (k.startsWith(zkey + '::')) innerZipCache.delete(k);
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

// zip 내부 디렉토리 탐색 (한 레벨씩; 내부 .zip/.cbz는 가상 폴더로 진입 시 JSZip으로 나열)
ipcMain.handle('read-zip-dir', async (_, filePath, prefix) => {
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const zipExts = ['.zip', '.cbz'];
  return runZipOp(async () => {
  try {
    if (!isSafePathInput(filePath)) return { folders: [], images: [] };
    await zipWorkerEnsureOpen(filePath);
    const names = workerZipNames;
    const pfxRaw = typeof prefix === 'string' ? prefix.replace(/\\/g, '/') : '';

    const zipEntries = names
      .filter(n => zipExts.includes(path.extname(n).toLowerCase()))
      .sort((a, b) => b.length - a.length);

    for (const ze of zipEntries) {
      if (pfxRaw === ze) {
        return await listInnerZipOneLevel(filePath, ze, '', imgExts);
      }
      if (pfxRaw.startsWith(ze + '/')) {
        const innerRel = pfxRaw.slice(ze.length + 1);
        return await listInnerZipOneLevel(filePath, ze, innerRel, imgExts);
      }
    }

    const pfx = pfxRaw ? (pfxRaw.endsWith('/') ? pfxRaw : pfxRaw + '/') : '';
    const folders = new Set();
    const images = [];
    const zipExtSet = new Set(zipExts);
    for (const name of names) {
      if (!name.startsWith(pfx)) continue;
      const rel = name.slice(pfx.length);
      if (!rel) continue;
      const slashIdx = rel.indexOf('/');
      if (slashIdx === -1) {
        const ext = path.extname(rel).toLowerCase();
        if (imgExts.includes(ext)) images.push(name);
        else if (zipExtSet.has(ext)) folders.add(rel);
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
});

// 파일 드롭 처리
ipcMain.handle('get-file-type', async (_, filePath) => {
  if (!isSafePathInput(filePath)) return 'unknown';
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return 'folder';
  } catch {}
  const ext = path.extname(filePath).toLowerCase();
  const zipExts = ['.zip', '.cbz', '.cbr', '.rar'];
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  if (zipExts.includes(ext)) return 'zip';
  if (imgExts.includes(ext)) return 'image';
  return 'unknown';
});
