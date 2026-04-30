// ── 상태 ──────────────────────────────────────────────────
const state = {
  pages: [],
  current: 0,
  doubleView: true,
  fitMode: 'page',
  zoom: 1.0,
  rotation: 0,
  rtl: false,
  fileName: '',
  progressKey: '',
  sourcePath: '',
  sourceType: '',
  autoSwitchingBook: false
};

const zipBrowseState = { zipPath: null, prefix: null, history: [] };

// ── 진행상황 저장 ─────────────────────────────────────────
function saveProgress(key, idx) {
  try { localStorage.setItem('pg:' + key, idx); } catch {}
}
function loadProgress(key) {
  try { const v = localStorage.getItem('pg:' + key); return v !== null ? parseInt(v) : 0; } catch { return 0; }
}

function saveReadingDirection(isRtl) {
  try { localStorage.setItem('reading-direction-rtl', isRtl ? '1' : '0'); } catch {}
}

function loadReadingDirection() {
  try { return localStorage.getItem('reading-direction-rtl') === '1'; } catch { return false; }
}

// ── 최근 파일 ─────────────────────────────────────────────
function saveRecent(path, name, type) {
  try {
    let recents = JSON.parse(localStorage.getItem('recents') || '[]');
    recents = recents.filter(r => r.path !== path);
    recents.unshift({ path, name, type, ts: Date.now() });
    localStorage.setItem('recents', JSON.stringify(recents.slice(0, 8)));
  } catch {}
}
function buildRecentList() {
  try {
    const recents = JSON.parse(localStorage.getItem('recents') || '[]');
    const section = document.getElementById('recent-section');
    const list = document.getElementById('recent-list');
    if (!recents.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    list.innerHTML = '';
    recents.forEach(r => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      const icon = r.type === 'folder' ? '📁' : r.type === 'zip' ? '🗜' : '🖼';
      const dir = r.path.substring(0, Math.max(r.path.lastIndexOf('/'), r.path.lastIndexOf('\\')) + 1)
        .split(/[\\/]/).filter(Boolean).pop() || '';
      const iconEl = document.createElement('span');
      iconEl.className = 'recent-item-icon';
      iconEl.textContent = icon;
      const nameEl = document.createElement('span');
      nameEl.className = 'recent-item-name';
      nameEl.textContent = r.name || '';
      const dirEl = document.createElement('span');
      dirEl.className = 'recent-item-dir';
      dirEl.textContent = dir;
      item.appendChild(iconEl);
      item.appendChild(nameEl);
      item.appendChild(dirEl);
      item.title = r.path;
      item.addEventListener('click', () => loadPath(r.path));
      list.appendChild(item);
    });
  } catch {}
}

// ── DOM ───────────────────────────────────────────────────
const viewer        = document.getElementById('viewer');
const viewerInner   = document.getElementById('viewer-inner');
const dropZone      = document.getElementById('drop-zone');
const pagesContainer= document.getElementById('pages-container');
const pageLeft      = document.getElementById('page-left');
const pageRight     = document.getElementById('page-right');
const fileList      = document.getElementById('file-list');
const pageCounter   = document.getElementById('page-counter');
const zoomLevel     = document.getElementById('zoom-level');
const statusFile    = document.getElementById('status-file');
const statusPages   = document.getElementById('status-pages');
const statusMode    = document.getElementById('status-mode');
const statusZoom    = document.getElementById('status-zoom');
const pageInfo      = document.getElementById('page-info');
const tabTitle      = document.getElementById('tab-title');
const aboutModal    = document.getElementById('about-modal');
const btnRtl        = document.getElementById('btn-rtl');

function syncReadingDirectionUI() {
  btnRtl.classList.toggle('active', state.rtl);
  btnRtl.textContent = state.rtl ? '우→좌' : '좌→우';
  btnRtl.title = state.rtl ? '읽기 방향: 우→좌 (일본)' : '읽기 방향: 좌→우 (한국)';
}

// ── 탐색기 ────────────────────────────────────────────────
const explorerState = { path: null, parent: null, currentFile: null, files: [],
  zipMode: false, zipPath: null, zipPrefix: null };

function toggleSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

document.getElementById('section-explorer-header').addEventListener('click', (e) => {
  if (!e.target.closest('.icon-btn')) toggleSection('section-explorer');
});
document.getElementById('section-pages-header').addEventListener('click', () => {
  toggleSection('section-pages');
});

document.getElementById('btn-up').addEventListener('click', () => {
  if (explorerState.zipMode) {
    if (explorerState.zipPrefix) {
      const parts = explorerState.zipPrefix.split('/');
      parts.pop();
      enterZipDir(explorerState.zipPath, parts.join('/'));
    } else {
      explorerState.zipMode = false;
      if (explorerState.path) browseDir(explorerState.path);
    }
  } else if (explorerState.parent) {
    browseDir(explorerState.parent);
  }
});

let bulkParsed = [];

function openBulkRenameBar() {
  if (!explorerState.path || !explorerState.files.length) return;
  document.getElementById('bulk-rename-bar').style.display = '';

  // 파일 아이템마다 체크박스 삽입
  document.querySelectorAll('#explorer-list .explorer-file').forEach(item => {
    if (item.querySelector('.bulk-cb')) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'bulk-cb';
    cb.checked = true;
    cb.addEventListener('change', updateBulkPreview);
    cb.addEventListener('click', e => e.stopPropagation());
    item.insertBefore(cb, item.firstChild);
  });

  updateBulkPreview();
}

function updateBulkPreview() {
  const checkedItems = [...document.querySelectorAll('#explorer-list .explorer-file')]
    .filter(item => item.querySelector('.bulk-cb')?.checked);

  if (!checkedItems.length) {
    document.getElementById('bulk-rename-hint').textContent = '파일을 선택하세요';
    document.getElementById('bulk-rename-input').value = '';
    bulkParsed = [];
    return;
  }

  const parsed = checkedItems.map(item => {
    const f = item.dataset.filename;
    const m = f.match(/^(.*?)(\d.*)$/);  // 첫 번째 숫자 이후를 suffix로 통째로 보존
    return m ? { original: f, prefix: m[1], suffix: m[2] } : null;
  }).filter(Boolean);

  bulkParsed = parsed;

  if (!parsed.length) {
    document.getElementById('bulk-rename-hint').textContent = '숫자가 포함된 파일이 없습니다';
    return;
  }

  const commonPrefix = parsed.reduce((acc, p) => {
    let i = 0;
    while (i < acc.length && i < p.prefix.length && acc[i] === p.prefix[i]) i++;
    return acc.slice(0, i);
  }, parsed[0].prefix);

  document.getElementById('bulk-rename-hint').textContent =
    `${parsed.length}개 파일  ·  예시: (새이름)${parsed[0].suffix}`;
  const input = document.getElementById('bulk-rename-input');
  input.value = commonPrefix.trimEnd();
}

async function applyBulkRename() {
  if (!bulkParsed.length) { closeBulkRenameBar(); return; }
  const trimmed = document.getElementById('bulk-rename-input').value.trimEnd();
  const sep = explorerState.path.includes('/') ? '/' : '\\';
  const base = explorerState.path.replace(/[/\\]+$/, '');
  let failed = 0;
  for (const p of bulkParsed) {
    const newName = trimmed + p.suffix;
    const fullPath = base + sep + p.original;
    const res = await window.api.renameFile(fullPath, newName);
    if (!res.success) failed++;
  }
  closeBulkRenameBar();
  if (failed > 0) alert(`${failed}개 파일 이름 변경 실패`);
  browseDir(explorerState.path);
}

function closeBulkRenameBar() {
  document.getElementById('bulk-rename-bar').style.display = 'none';
  document.querySelectorAll('#explorer-list .bulk-cb').forEach(cb => cb.remove());
  bulkParsed = [];
}

document.getElementById('btn-bulk-rename').addEventListener('click', openBulkRenameBar);
document.getElementById('bulk-rename-confirm').addEventListener('click', applyBulkRename);
document.getElementById('bulk-rename-cancel').addEventListener('click', closeBulkRenameBar);
document.getElementById('bulk-rename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyBulkRename();
  if (e.key === 'Escape') closeBulkRenameBar();
  e.stopPropagation();
});

async function browseDir(dirPath) {
  const result = await window.api.readDirEntries(dirPath);
  explorerState.path = dirPath;
  explorerState.parent = result.parent;
  explorerState.files = result.files;
  explorerState.zipMode = false;
  document.getElementById('btn-bulk-rename').style.display = result.files.length ? '' : 'none';

  const pathLabel = document.getElementById('explorer-path-label');
  const folderName = dirPath.split(/[\\/]/).filter(Boolean).pop() || dirPath;
  pathLabel.textContent = folderName;
  pathLabel.title = dirPath;
  document.getElementById('btn-up').disabled = !result.parent;

  const list = document.getElementById('explorer-list');
  list.innerHTML = '';

  if (!result.dirs.length && !result.files.length) {
    list.innerHTML = '<div class="empty-hint">지원 파일 없음</div>';
    return;
  }

  function makeSep(dirPath) {
    return dirPath.includes('/') ? '/' : '\\';
  }

  function makeActions(fullPath, name, isDir) {
    const wrap = document.createElement('div');
    wrap.className = 'explorer-actions';
    wrap.addEventListener('click', e => e.stopPropagation());

    // 이름 변경 버튼
    const renBtn = document.createElement('button');
    renBtn.className = 'explorer-action-btn';
    renBtn.title = '이름 변경';
    renBtn.textContent = '✏';
    renBtn.addEventListener('click', async () => {
      const nameEl = wrap.closest('.explorer-item').querySelector('.explorer-name');
      const old = nameEl.textContent;
      const input = document.createElement('input');
      input.className = 'explorer-rename-input';
      input.value = old;
      nameEl.replaceWith(input);
      input.select();
      const commit = async () => {
        const newName = input.value.trim();
        if (newName && newName !== old) {
          const res = await window.api.renameFile(fullPath, newName);
          if (res.success) {
            browseDir(dirPath);
          } else {
            alert('이름 변경 실패: ' + res.error);
            input.replaceWith(nameEl);
          }
        } else {
          input.replaceWith(nameEl);
        }
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') input.replaceWith(nameEl);
        e.stopPropagation();
      });
      input.addEventListener('blur', commit);
      input.focus();
    });
    wrap.appendChild(renBtn);

    // 삭제 버튼
    const delBtn = document.createElement('button');
    delBtn.className = 'explorer-action-btn explorer-del-btn';
    delBtn.title = isDir ? '폴더 삭제' : '파일 삭제';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', async () => {
      const label = isDir ? `폴더 "${name}"` : `파일 "${name}"`;
      if (!confirm(`${label}을(를) 휴지통으로 이동할까요?`)) return;
      const res = await window.api.deleteFile(fullPath);
      if (res.success) browseDir(dirPath);
      else alert('삭제 실패: ' + res.error);
    });
    wrap.appendChild(delBtn);

    return wrap;
  }

  result.dirs.forEach(dir => {
    const item = document.createElement('div');
    item.className = 'explorer-item explorer-dir';
    const sep = makeSep(dirPath);
    const fullPath = dirPath.replace(/[/\\]+$/, '') + sep + dir;
    const iconEl = document.createElement('span');
    iconEl.className = 'explorer-icon';
    iconEl.textContent = '📁';
    const nameEl = document.createElement('span');
    nameEl.className = 'explorer-name';
    nameEl.textContent = dir;
    item.appendChild(iconEl);
    item.appendChild(nameEl);
    item.title = dir;
    item.appendChild(makeActions(fullPath, dir, true));
    item.addEventListener('click', () => {
      browseDir(fullPath);
      loadPath(fullPath);
      const sec = document.getElementById('section-pages');
      if (sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
    });
    list.appendChild(item);
  });

  result.files.forEach(file => {
    const ext = file.split('.').pop().toLowerCase();
    const icon = ['zip','cbz','cbr','rar'].includes(ext) ? '🗜' : '🖼';
    const item = document.createElement('div');
    item.className = 'explorer-item explorer-file';
    const sep = makeSep(dirPath);
    const fullPath = dirPath.replace(/[/\\]+$/, '') + sep + file;
    if (explorerState.currentFile && fullPath.toLowerCase() === explorerState.currentFile.toLowerCase()) {
      item.classList.add('active');
    }
    item.dataset.filename = file;
    const iconEl = document.createElement('span');
    iconEl.className = 'explorer-icon';
    iconEl.textContent = icon;
    const nameEl = document.createElement('span');
    nameEl.className = 'explorer-name';
    nameEl.textContent = file;
    item.appendChild(iconEl);
    item.appendChild(nameEl);
    item.title = file;
    item.appendChild(makeActions(fullPath, file, false));
    item.addEventListener('click', () => {
      loadPath(fullPath);
      const sec = document.getElementById('section-pages');
      if (sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
    });
    list.appendChild(item);
  });

  // 현재 열린 파일로 스크롤
  const activeItem = list.querySelector('.explorer-item.active');
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
}

// ── 파일 열기 ─────────────────────────────────────────────
const openDropdown = document.getElementById('open-dropdown');

document.getElementById('btn-open-file').addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  openDropdown.style.top = rect.bottom + 4 + 'px';
  openDropdown.style.left = rect.left + 'px';
  openDropdown.classList.toggle('visible');
});
document.getElementById('open-dropdown-file').addEventListener('click', async () => {
  openDropdown.classList.remove('visible');
  const filePath = await window.api.openFile();
  if (filePath) await loadPath(filePath);
});
document.getElementById('open-dropdown-folder').addEventListener('click', async () => {
  openDropdown.classList.remove('visible');
  const folderPath = await window.api.openFolder();
  if (folderPath) await loadPath(folderPath);
});
document.addEventListener('click', () => openDropdown.classList.remove('visible'));


async function loadPath(filePath) {
  // 쓰기 계열 IPC(delete/rename/save)의 허용 루트를 현재 열람 경로로 등록
  await window.api.setActiveRoot(filePath);
  const type = await window.api.getFileType(filePath);
  explorerState.currentFile = type !== 'folder' ? filePath : null;
  const folder = type === 'folder' ? filePath
    : filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
  await browseDir(folder);
  if (type === 'zip') {
    await loadZip(filePath);
  } else if (type === 'folder') {
    await loadFolder(filePath);
  } else if (type === 'image') {
    await loadImageFile(filePath);
  }
}

async function loadZip(filePath) {
  const zipName = filePath.split(/[\\/]/).pop();
  zipBrowseState.zipPath = filePath;
  zipBrowseState.prefix = '';
  zipBrowseState.history = [];
  state.fileName = zipName;
  state.sourcePath = filePath;
  state.sourceType = 'zip';
  saveRecent(filePath, zipName, 'zip');
  tabTitle.textContent = zipName;
  await enterZipDir(filePath, '');
}

async function enterZipDir(zipPath, prefix) {
  zipBrowseState.prefix = prefix;
  const dir = await window.api.readZipDir(zipPath, prefix);

  if (dir.folders.length > 0) {
    browseZipDir(zipPath, prefix, dir.folders);
  }

  if (dir.images.length > 0) {
    const zipName = zipPath.split(/[\\/]/).pop();
    const folderLabel = prefix ? prefix.split('/').pop() : '';
    const displayName = folderLabel ? zipName + ' / ' + folderLabel : zipName;
    await loadZipImages(zipPath, dir.images, displayName);
  } else if (dir.folders.length > 0) {
    showZipFolderPicker(zipPath, prefix, dir.folders);
  } else if (!prefix) {
    // 루트에서 이미지/폴더 없음 → inner zip 폴백 (readZipList)
    const entries = await window.api.readZipList(zipPath);
    if (!entries.length) {
      alert('ZIP 파일에서 이미지를 찾을 수 없습니다.\n(CBR/RAR 형식은 지원하지 않습니다)');
      return;
    }
    await loadZipImages(zipPath, entries, zipPath.split(/[\\/]/).pop());
  } else {
    alert('이 폴더에 이미지가 없습니다.');
  }
}

function showZipFolderPicker(zipPath, prefix, folders) {
  dropZone.style.display = 'none';
  pagesContainer.style.display = 'none';

  const picker = document.getElementById('zip-folder-picker');
  picker.style.display = 'flex';
  picker.innerHTML = '';

  const zipName = zipPath.split(/[\\/]/).pop();

  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'zip-breadcrumb';

  if (zipBrowseState.history.length > 0) {
    const backBtn = document.createElement('button');
    backBtn.className = 'zip-back-btn';
    backBtn.textContent = '← 뒤로';
    backBtn.addEventListener('click', () => {
      const prev = zipBrowseState.history.pop();
      enterZipDir(zipPath, prev);
    });
    breadcrumb.appendChild(backBtn);
  }

  const pathLabel = document.createElement('span');
  pathLabel.className = 'zip-breadcrumb-path';
  pathLabel.textContent = zipName + (prefix ? ' / ' + prefix : '');
  breadcrumb.appendChild(pathLabel);
  picker.appendChild(breadcrumb);

  const grid = document.createElement('div');
  grid.className = 'zip-folder-grid';

  folders.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'zip-folder-card';

    const icon = document.createElement('div');
    icon.className = 'zip-folder-icon';
    icon.textContent = '📁';

    const name = document.createElement('div');
    name.className = 'zip-folder-name';
    name.textContent = folder;
    name.title = folder;

    card.appendChild(icon);
    card.appendChild(name);
    card.addEventListener('click', () => {
      const newPrefix = prefix ? prefix + '/' + folder : folder;
      zipBrowseState.history.push(prefix);
      enterZipDir(zipPath, newPrefix);
    });
    grid.appendChild(card);
  });

  picker.appendChild(grid);
  updateUI();
}

async function loadZipImages(zipPath, entries, displayName) {
  state.pages = entries.map(e => ({ type: 'zip', zipPath, entry: e }));
  state.rotation = 0;
  const progressKey = zipPath + (zipBrowseState.prefix ? '::' + zipBrowseState.prefix : '');
  state.progressKey = progressKey;
  state.current = Math.min(loadProgress(progressKey), entries.length - 1);
  state.fileName = displayName || zipPath.split(/[\\/]/).pop();
  tabTitle.textContent = state.fileName;

  // 사이드바: 상위 레벨 폴더 목록으로 갱신하고 현재 폴더 하이라이트
  const curPrefix = zipBrowseState.prefix;
  if (curPrefix) {
    const slashIdx = curPrefix.lastIndexOf('/');
    const parentPrefix = slashIdx >= 0 ? curPrefix.slice(0, slashIdx) : '';
    const currentFolder = curPrefix.slice(slashIdx + 1);
    const parentDir = await window.api.readZipDir(zipPath, parentPrefix);
    if (parentDir.folders.length > 0) {
      browseZipDir(zipPath, parentPrefix, parentDir.folders, currentFolder);
    }
  }

  buildSidebar();
  await render();
}

async function loadFolder(folderPath) {
  const files = await window.api.readFolder(folderPath);
  if (!files.length) return;
  state.pages = files.map(f => ({ type: 'file', src: f }));
  state.rotation = 0;
  state.progressKey = folderPath;
  state.current = Math.min(loadProgress(folderPath), files.length - 1);
  state.fileName = folderPath.split(/[\\/]/).pop();
  state.sourcePath = folderPath;
  state.sourceType = 'folder';
  saveRecent(folderPath, state.fileName, 'folder');
  tabTitle.textContent = state.fileName;
  buildSidebar();
  await render();
}

async function loadImageFile(filePath) {
  const folder = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
  const files = await window.api.readFolder(folder);
  if (files.length) {
    state.pages = files.map(f => ({ type: 'file', src: f }));
    state.current = files.indexOf(filePath);
    if (state.current < 0) state.current = 0;
  } else {
    state.pages = [{ type: 'file', src: filePath }];
    state.current = 0;
  }
  state.rotation = 0;
  state.progressKey = folder;
  state.fileName = filePath.split(/[\\/]/).pop();
  state.sourcePath = filePath;
  state.sourceType = 'image';
  saveRecent(filePath, state.fileName, 'image');
  tabTitle.textContent = state.fileName;
  buildSidebar();
  await render();
}

function browseZipDir(zipPath, prefix, folders, activeFolder) {
  explorerState.zipMode = true;
  explorerState.zipPath = zipPath;
  explorerState.zipPrefix = prefix;
  explorerState.files = [];
  document.getElementById('btn-bulk-rename').style.display = 'none';

  const zipName = zipPath.split(/[\\/]/).pop();
  const pathLabel = document.getElementById('explorer-path-label');
  pathLabel.textContent = prefix ? prefix.split('/').pop() : zipName;
  pathLabel.title = zipName + (prefix ? ' / ' + prefix : '');
  document.getElementById('btn-up').disabled = false;

  const list = document.getElementById('explorer-list');
  list.innerHTML = '';

  folders.forEach(folder => {
    const item = document.createElement('div');
    item.className = 'explorer-item explorer-dir';
    if (folder === activeFolder) item.classList.add('active');
    const iconEl = document.createElement('span');
    iconEl.className = 'explorer-icon';
    iconEl.textContent = '📁';
    const nameEl = document.createElement('span');
    nameEl.className = 'explorer-name';
    nameEl.textContent = folder;
    item.title = folder;
    item.appendChild(iconEl);
    item.appendChild(nameEl);
    item.addEventListener('click', () => {
      const newPrefix = prefix ? prefix + '/' + folder : folder;
      enterZipDir(zipPath, newPrefix);
      const sec = document.getElementById('section-pages');
      if (sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
    });
    list.appendChild(item);
  });

  const activeItem = list.querySelector('.explorer-item.active');
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
}

// ── 이미지 로드 ───────────────────────────────────────────
async function loadPageImage(page) {
  if (!page) return '';
  if (page.type === 'file') {
    return await window.api.readImage(page.src) || '';
  } else {
    return await window.api.readZipImage(page.zipPath, page.entry) || '';
  }
}

// ── 렌더링 ────────────────────────────────────────────────
async function render() {
  document.getElementById('zip-folder-picker').style.display = 'none';
  if (!state.pages.length) {
    dropZone.style.display = 'flex';
    pagesContainer.style.display = 'none';
    viewer.style.cursor = '';
    updateUI();
    return;
  }
  viewer.style.cursor = 'grab';

  dropZone.style.display = 'none';
  pagesContainer.style.display = 'flex';

  const idx = state.current;

  if (state.doubleView && idx + 1 < state.pages.length) {
    let leftIdx = state.rtl ? idx + 1 : idx;
    let rightIdx = state.rtl ? idx : idx + 1;
    const [leftSrc, rightSrc] = await Promise.all([
      loadPageImage(state.pages[leftIdx]),
      loadPageImage(state.pages[rightIdx])
    ]);
    pageLeft.src = leftSrc;
    pageLeft.style.display = 'block';
    pageRight.src = rightSrc;
    pageRight.style.display = 'block';
  } else {
    const src = await loadPageImage(state.pages[idx]);
    pageLeft.src = src;
    pageLeft.style.display = 'block';
    pageRight.src = '';
    pageRight.style.display = 'none';
  }

  // 이미지 디코딩 완료 후 한 번 더 맞춤을 적용해 비율/크기 오차를 줄임
  const reflowOnLoad = (imgEl) => {
    if (!imgEl || !imgEl.src || imgEl.style.display === 'none') return;
    imgEl.onload = () => {
      if (state.pages.length) applyTransform();
    };
  };
  reflowOnLoad(pageLeft);
  reflowOnLoad(pageRight);

  applyTransform();
  updateUI();
  highlightSidebar();
  viewer.scrollTo(0, 0);
  if (state.progressKey) saveProgress(state.progressKey, state.current);
}

function applyTransform() {
  const rot = `rotate(${state.rotation}deg)`;
  pageLeft.style.transform = rot;
  pageRight.style.transform = rot;

  // 맞춤 모드에서는 스크롤 없이 한 화면에 고정, 수동 줌에서만 스크롤 허용
  viewer.style.overflow = state.fitMode === 'manual' ? 'auto' : 'hidden';
  pagesContainer.style.padding = state.fitMode === 'manual' ? '16px' : '0';
  pagesContainer.style.paddingTop = '';
  pagesContainer.style.paddingBottom = '';

  const fitImageToBounds = (imgEl, maxW, maxH) => {
    if (!imgEl || imgEl.style.display === 'none') return;
    const naturalW = imgEl.naturalWidth || 0;
    const naturalH = imgEl.naturalHeight || 0;

    if (!naturalW || !naturalH) {
      // 아직 이미지 메타가 없으면 기존 방식으로 임시 적용
      imgEl.style.width = maxW + 'px';
      imgEl.style.height = '';
      imgEl.style.maxWidth = '';
      imgEl.style.maxHeight = maxH + 'px';
      return;
    }

    // 페이지 맞춤에서는 원본보다 과도한 확대를 막고 비율 유지
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
    imgEl.style.width = Math.floor(naturalW * scale) + 'px';
    imgEl.style.height = Math.floor(naturalH * scale) + 'px';
    imgEl.style.maxWidth = '';
    imgEl.style.maxHeight = '';
  };

  if (state.fitMode === 'page') {
    const vw = viewer.clientWidth - 40;
    const vh = viewer.clientHeight - 40;
    const count = (state.doubleView && state.current + 1 < state.pages.length) ? 2 : 1;
    const maxW = Math.floor((vw - (count > 1 ? 4 : 0)) / count);
    fitImageToBounds(pageLeft, maxW, vh);
    if (pageRight.style.display !== 'none') {
      fitImageToBounds(pageRight, maxW, vh);
    }
  } else if (state.fitMode === 'width') {
    const vw = viewer.clientWidth - 40;
    const count = (state.doubleView && state.current + 1 < state.pages.length) ? 2 : 1;
    const w = Math.floor((vw - (count > 1 ? 4 : 0)) / count);
    pageLeft.style.width = w + 'px';
    pageLeft.style.height = '';
    pageLeft.style.maxWidth = '';
    pageLeft.style.maxHeight = '';
    if (pageRight.style.display !== 'none') {
      pageRight.style.width = w + 'px';
      pageRight.style.height = '';
      pageRight.style.maxWidth = '';
      pageRight.style.maxHeight = '';
    }
  } else if (state.fitMode === 'height') {
    pagesContainer.style.paddingTop = '0';
    pagesContainer.style.paddingBottom = '0';
    const vh = viewer.clientHeight;
    pageLeft.style.width = '';
    pageLeft.style.height = vh + 'px';
    pageLeft.style.maxWidth = '';
    pageLeft.style.maxHeight = '';
    if (pageRight.style.display !== 'none') {
      pageRight.style.width = '';
      pageRight.style.height = vh + 'px';
      pageRight.style.maxWidth = '';
      pageRight.style.maxHeight = '';
    }
  } else {
    // 수동 줌

    pageLeft.style.width = '';
    pageLeft.style.height = '';
    pageLeft.style.maxWidth = 'none';
    pageLeft.style.maxHeight = 'none';
    pageLeft.style.transform = `scale(${state.zoom}) ${rot}`;
    if (pageRight.style.display !== 'none') {
      pageRight.style.width = '';
      pageRight.style.height = '';
      pageRight.style.maxWidth = 'none';
      pageRight.style.maxHeight = 'none';
      pageRight.style.transform = `scale(${state.zoom}) ${rot}`;
    }
  }
}

function updateUI() {
  const total = state.pages.length;
  const cur = state.current + 1;
  const end = state.doubleView ? Math.min(cur + 1, total) : cur;
  const label = total ? `${cur}${state.doubleView && end > cur ? '-' + end : ''} / ${total}` : '—';

  pageCounter.textContent = label;
  statusPages.textContent = label;
  statusFile.textContent = state.fileName || '파일 없음';
  statusMode.textContent = state.doubleView ? '두 장 보기' : '한 장 보기';
  statusZoom.textContent = state.fitMode !== 'manual'
    ? state.fitMode === 'page' ? '맞춤' : state.fitMode === 'width' ? '너비' : '높이'
    : Math.round(state.zoom * 100) + '%';
  zoomLevel.textContent = state.fitMode !== 'manual'
    ? '맞춤'
    : Math.round(state.zoom * 100) + '%';
  pageInfo.textContent = total ? `${cur} / ${total}` : '—';

  document.getElementById('btn-prev').disabled = cur <= 1;
  document.getElementById('btn-next').disabled = cur >= total;
  updateSaveBtn();
}

function resetTransientZoom() {
  if (state.fitMode !== 'manual') return;
  state.fitMode = 'page';
  state.zoom = 1;
  ['width','height','page'].forEach(m => {
    document.getElementById('btn-fit-' + m).classList.toggle('active', m === 'page');
  });
}

// ── 사이드바 썸네일 ───────────────────────────────────────
let thumbObserver = null;

async function makeThumbnail(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 28; canvas.height = 36;
      const ctx = canvas.getContext('2d');
      const aspect = img.width / img.height;
      const target = 28 / 36;
      let sx, sy, sw, sh;
      if (aspect > target) { sh = img.height; sw = sh * target; sx = (img.width - sw) / 2; sy = 0; }
      else { sw = img.width; sh = sw / target; sx = 0; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 28, 36);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

function buildSidebar() {
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const thumb = entry.target;
      const idx = parseInt(thumb.dataset.idx);
      const page = state.pages[idx];
      if (!page) continue;
      // 안정성 우선: zip/cbz는 썸네일 디코딩을 생략하여 과부하/크래시를 방지
      if (page.type === 'zip') {
        thumbObserver.unobserve(thumb);
        thumb.removeAttribute('src');
        thumb.style.background = 'var(--surface1)';
        continue;
      }
      thumbObserver.unobserve(thumb);
      const raw = await loadPageImage(page);
      if (raw) thumb.src = await makeThumbnail(raw);
    }
  }, { root: fileList, rootMargin: '120px' });

  fileList.innerHTML = '';
  state.pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.idx = i;

    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = i + 1;

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.dataset.idx = i;
    thumbObserver.observe(thumb);

    const name = document.createElement('span');
    name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
    const label = page.type === 'zip'
      ? page.entry.split('/').pop()
      : page.src.split(/[\\/]/).pop();
    name.textContent = label;
    name.title = label;

    const delBtn = document.createElement('button');
    delBtn.className = 'file-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = page.type === 'zip' ? 'zip 내부 파일은 삭제 불가' : '휴지통으로 이동';
    delBtn.disabled = page.type === 'zip';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (page.type === 'zip') return;
      const fileName = page.src.split(/[\\/]/).pop();
      if (!confirm(`"${fileName}" 을 휴지통으로 이동하시겠습니까?`)) return;
      const result = await window.api.deleteFile(page.src);
      if (result.success) {
        state.pages.splice(i, 1);
        if (state.current >= state.pages.length) state.current = Math.max(0, state.pages.length - 1);
        buildSidebar();
        if (state.pages.length > 0) render();
        else { dropZone.style.display = 'flex'; pagesContainer.style.display = 'none'; updateUI(); }
      } else {
        alert('삭제 실패: ' + result.error);
      }
    });

    item.appendChild(num);
    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(delBtn);
    item.addEventListener('click', () => {
      resetTransientZoom();
      state.current = i;
      render();
    });
    fileList.appendChild(item);
  });
}

function highlightSidebar() {
  document.querySelectorAll('.file-item').forEach(el => {
    const i = parseInt(el.dataset.idx);
    const active = state.doubleView
      ? (i === state.current || i === state.current + 1)
      : i === state.current;
    el.classList.toggle('active', active);
  });
  // 스크롤 하이라이트된 항목으로
  const activeEl = fileList.querySelector('.file-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'center', inline: 'nearest' });
}

// ── 네비게이션 ────────────────────────────────────────────
function goNext() {
  if (state.autoSwitchingBook) return;
  const step = state.doubleView ? 2 : 1;
  if (state.current + step < state.pages.length) {
    resetTransientZoom();
    state.current = Math.min(state.current + step, state.pages.length - 1);
    render();
  }
}
function goPrev() {
  if (state.autoSwitchingBook) return;
  const step = state.doubleView ? 2 : 1;
  if (state.current - step >= 0) {
    resetTransientZoom();
    state.current = Math.max(state.current - step, 0);
    render();
  }
}

document.getElementById('btn-next').addEventListener('click', goNext);
document.getElementById('btn-prev').addEventListener('click', goPrev);

async function autoOpenNextBook() {
  if (state.autoSwitchingBook) return;
  state.autoSwitchingBook = true;
  try {
    if (!state.sourcePath) return;
    const src = state.sourcePath;
    const slash = Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\'));
    if (slash <= 0) return;

    const parentPath = src.slice(0, slash);
    const currentName = src.slice(slash + 1);
    if (!parentPath || !currentName) return;

    const dir = await window.api.readDirEntries(parentPath);
    const isFolderSource = state.sourceType === 'folder';
    const isArchiveSource = state.sourceType === 'zip';
    const archiveExt = ['zip', 'cbz', 'cbr', 'rar'];
    const list = isFolderSource
      ? dir.dirs
      : isArchiveSource
      ? dir.files.filter((n) => archiveExt.includes((n.split('.').pop() || '').toLowerCase()))
      : dir.files;
    const idx = list.findIndex(n => n.toLowerCase() === currentName.toLowerCase());
    if (idx < 0 || idx + 1 >= list.length) return;

    const nextName = list[idx + 1];
    const sep = parentPath.includes('/') ? '/' : '\\';
    const nextPath = parentPath.replace(/[/\\]+$/, '') + sep + nextName;
    await loadPath(nextPath);
  } catch (e) {
    console.error('autoOpenNextBook failed:', e);
  } finally {
    state.autoSwitchingBook = false;
  }
}

async function autoOpenPrevBook() {
  if (state.autoSwitchingBook) return;
  state.autoSwitchingBook = true;
  try {
    if (!state.sourcePath) return;
    const src = state.sourcePath;
    const slash = Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\'));
    if (slash <= 0) return;

    const parentPath = src.slice(0, slash);
    const currentName = src.slice(slash + 1);
    if (!parentPath || !currentName) return;

    const dir = await window.api.readDirEntries(parentPath);
    const isFolderSource = state.sourceType === 'folder';
    const isArchiveSource = state.sourceType === 'zip';
    const archiveExt = ['zip', 'cbz', 'cbr', 'rar'];
    const list = isFolderSource
      ? dir.dirs
      : isArchiveSource
      ? dir.files.filter((n) => archiveExt.includes((n.split('.').pop() || '').toLowerCase()))
      : dir.files;
    const idx = list.findIndex(n => n.toLowerCase() === currentName.toLowerCase());
    if (idx <= 0) return;

    const prevName = list[idx - 1];
    const sep = parentPath.includes('/') ? '/' : '\\';
    const prevPath = parentPath.replace(/[/\\]+$/, '') + sep + prevName;
    await loadPath(prevPath);

    if (!state.pages.length) return;
    resetTransientZoom();
    const lastStart = Math.max(state.pages.length - (state.doubleView ? 2 : 1), 0);
    state.current = lastStart;
    await render();
  } catch (e) {
    console.error('autoOpenPrevBook failed:', e);
  } finally {
    state.autoSwitchingBook = false;
  }
}

// 페이지 카운터 클릭 → 페이지 점프
pageCounter.addEventListener('click', () => {
  if (!state.pages.length) return;
  const total = state.pages.length;
  const input = document.createElement('input');
  input.id = 'page-jump-input';
  input.type = 'number';
  input.min = 1;
  input.max = total;
  input.value = state.current + 1;
  pageCounter.replaceWith(input);
  input.select();
  const commit = (jump) => {
    input.replaceWith(pageCounter);
    if (jump) {
      let val = Math.max(1, Math.min(total, parseInt(input.value) || state.current + 1));
      resetTransientZoom();
      state.current = val - 1;
      if (state.doubleView && state.current % 2 !== 0) state.current = Math.max(0, state.current - 1);
      render();
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commit(false));
});

// ── 키보드 ────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Space/Backspace가 버튼 활성화나 스크롤에 먹히는 걸 막기 위해 여기서 차단
  if ((e.key === ' ' || e.key === 'Backspace') && e.target.tagName !== 'INPUT') {
    e.preventDefault();
  }
}, { capture: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault(); goNext();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Backspace') {
    e.preventDefault(); goPrev();
  } else if (e.key === 'Home') {
    resetTransientZoom();
    state.current = 0; render();
  } else if (e.key === 'End') {
    resetTransientZoom();
    state.current = Math.max(state.pages.length - (state.doubleView ? 2 : 1), 0);
    render();
  } else if (e.key === 'F11') {
    toggleFullscreen();
  } else if (e.key === 'Escape') {
    if (aboutModal && aboutModal.style.display !== 'none') {
      aboutModal.style.display = 'none';
      return;
    }
    window.api.exitFullscreen();
  } else if (e.key === 'r' || e.key === 'R') {
    rotate();
  } else if (e.key === '+' || e.key === '=') {
    zoomIn();
  } else if (e.key === '-') {
    zoomOut();
  }
});

// 단일 클릭하면 확대 (페이지 이동 없음)
viewer.addEventListener('click', (e) => {
  if (panMoved) return;
  if (e.detail !== 1) return; // 더블클릭 중복 확대 방지
  if (!state.pages.length) return;
  if (state.fitMode === 'manual' && state.zoom > 1) return;

  const rect = viewer.getBoundingClientRect();
  const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const clickY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  const ratioX = rect.width ? (clickX / rect.width) : 0.5;
  const ratioY = rect.height ? (clickY / rect.height) : 0.5;

  state.fitMode = 'manual';
  state.zoom = 1.35;
  ['width','height','page'].forEach(m => document.getElementById('btn-fit-' + m).classList.remove('active'));
  applyTransform();
  updateUI();

  requestAnimationFrame(() => {
    const targetX = ratioX * viewer.scrollWidth - viewer.clientWidth / 2;
    const targetY = ratioY * viewer.scrollHeight - viewer.clientHeight / 2;
    viewer.scrollTo(Math.max(0, targetX), Math.max(0, targetY));
  });
});

// 더블클릭하면 현재 페이지를 원본 보기(페이지 맞춤)로 복귀
viewer.addEventListener('dblclick', (e) => {
  e.preventDefault();
  if (!state.pages.length) return;
  resetTransientZoom();
  applyTransform();
  updateUI();
});

// ── 도구모음 버튼 ─────────────────────────────────────────
document.getElementById('btn-fit-width').addEventListener('click', () => setFit('width'));
document.getElementById('btn-fit-height').addEventListener('click', () => setFit('height'));
document.getElementById('btn-fit-page').addEventListener('click', () => setFit('page'));
document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
document.getElementById('btn-rotate').addEventListener('click', rotate);
document.getElementById('btn-save-rotation').addEventListener('click', saveRotation);

document.getElementById('btn-single').addEventListener('click', () => {
  state.doubleView = false;
  document.getElementById('btn-single').classList.add('active');
  document.getElementById('btn-double').classList.remove('active');
  statusMode.textContent = '한 장 보기';
  render();
});
document.getElementById('btn-double').addEventListener('click', () => {
  state.doubleView = true;
  document.getElementById('btn-double').classList.add('active');
  document.getElementById('btn-single').classList.remove('active');
  statusMode.textContent = '두 장 보기';
  render();
});

btnRtl.addEventListener('click', () => {
  state.rtl = !state.rtl;
  saveReadingDirection(state.rtl);
  syncReadingDirectionUI();
  render();
});

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.getElementById('btn-about').addEventListener('click', () => {
  if (aboutModal) aboutModal.style.display = 'flex';
});
document.getElementById('about-close').addEventListener('click', () => {
  if (aboutModal) aboutModal.style.display = 'none';
});
if (aboutModal) {
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) aboutModal.style.display = 'none';
  });
}

// OS 레벨 전체화면 상태 동기화
window.api.onFullscreenChanged((isFull) => {
  document.body.classList.toggle('fullscreen', isFull);
  document.getElementById('btn-fullscreen').classList.toggle('active', isFull);
  if (state.pages.length) applyTransform();
});

function setFit(mode) {
  state.fitMode = mode;
  ['width','height','page'].forEach(m => {
    document.getElementById('btn-fit-' + m).classList.toggle('active', m === mode);
  });
  applyTransform();
  updateUI();
}

function zoomIn() {
  state.fitMode = 'manual';
  state.zoom = Math.min(state.zoom * 1.2, 5);
  ['width','height','page'].forEach(m => document.getElementById('btn-fit-' + m).classList.remove('active'));
  applyTransform();
  updateUI();
}

function zoomOut() {
  state.fitMode = 'manual';
  state.zoom = Math.max(state.zoom / 1.2, 0.1);
  ['width','height','page'].forEach(m => document.getElementById('btn-fit-' + m).classList.remove('active'));
  applyTransform();
  updateUI();
}

function rotate() {
  state.rotation = (state.rotation + 90) % 360;
  applyTransform();
  updateSaveBtn();
}

function updateSaveBtn() {
  const btn = document.getElementById('btn-save-rotation');
  const page = state.pages[state.current];
  const canSave = state.rotation !== 0 && !!page && page.type === 'file';
  btn.disabled = !canSave;
  btn.classList.toggle('active', canSave);
}

async function saveRotation() {
  if (state.rotation === 0) return;
  const pagesToSave = [];
  const p1 = state.pages[state.current];
  if (p1 && p1.type === 'file') pagesToSave.push(p1);
  if (state.doubleView && state.current + 1 < state.pages.length) {
    const p2 = state.pages[state.current + 1];
    if (p2 && p2.type === 'file') pagesToSave.push(p2);
  }
  if (!pagesToSave.length) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const angle = state.rotation * Math.PI / 180;
  const swapped = state.rotation % 180 !== 0;

  for (const page of pagesToSave) {
    const src = await window.api.readImage(page.src);
    if (!src) continue;
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = src; });
    canvas.width  = swapped ? img.height : img.width;
    canvas.height = swapped ? img.width  : img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    const ext = page.src.split('.').pop().toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, 0.95);
    const res = await window.api.saveImage(page.src, dataUrl);
    if (!res.success) { alert('저장 실패: ' + res.error); return; }
  }

  state.rotation = 0;
  await render();
  updateSaveBtn();
}

async function toggleFullscreen() {
  await window.api.toggleFullscreen();
}

// ── 마우스 휠 줌 ──────────────────────────────────────────
viewer.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  } else {
    e.preventDefault();
    if (e.deltaY < 0) goPrev(); else goNext();
  }
}, { passive: false });

// ── 마우스 드래그 팬(Pan) ─────────────────────────────────
let panning = false;
let panStartX = 0, panStartY = 0;
let panScrollX = 0, panScrollY = 0;
let panMoved = false;
const PAN_THRESHOLD = 5;

viewer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!(state.fitMode === 'manual' && state.zoom > 1)) return;
  panning = true;
  panMoved = false;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panScrollX = viewer.scrollLeft;
  panScrollY = viewer.scrollTop;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!panning) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  if (!panMoved && (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD)) {
    panMoved = true;
    viewer.style.cursor = 'grabbing';
  }
  if (panMoved) {
    viewer.scrollLeft = panScrollX - dx;
    viewer.scrollTop = panScrollY - dy;
  }
});

document.addEventListener('mouseup', () => {
  if (panning) {
    panning = false;
    viewer.style.cursor = state.pages.length ? 'grab' : '';
  }
  // 다음 클릭 확대가 막히지 않도록 드래그 플래그를 항상 정리
  panMoved = false;
});

// ── 사이드바 수직 리사이즈 (탐색기/페이지 구분) ───────────
const sidebarVResizer = document.getElementById('sidebar-v-resizer');
const sectionExplorer = document.getElementById('section-explorer');
let isVResizing = false;

// 오른쪽 끝 근처(12px)에서 드래그하면 가로+세로 동시 조절
sidebarVResizer.addEventListener('mousemove', (e) => {
  const nearRight = Math.abs(e.clientX - sidebar.getBoundingClientRect().right) < 12;
  sidebarVResizer.style.cursor = nearRight ? 'move' : 'row-resize';
  resizer.classList.toggle('corner-hover', nearRight);
  sidebarVResizer.classList.toggle('corner-hover', nearRight);
});
sidebarVResizer.addEventListener('mouseleave', () => {
  sidebarVResizer.style.cursor = '';
  resizer.classList.remove('corner-hover');
  sidebarVResizer.classList.remove('corner-hover');
});

sidebarVResizer.addEventListener('mousedown', (e) => {
  isVResizing = true;
  sidebarVResizer.classList.add('dragging');
  // 오른쪽 끝 근처면 가로 리사이즈도 함께 시작
  const nearRight = Math.abs(e.clientX - sidebar.getBoundingClientRect().right) < 12;
  if (nearRight) {
    isResizing = true;
    resizer.classList.add('dragging');
  }
  // 두 섹션 모두 강제 펼치기
  document.getElementById('section-explorer').classList.remove('collapsed');
  document.getElementById('section-pages').classList.remove('collapsed');
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isVResizing) return;
  const sidebarEl = document.getElementById('sidebar');
  const rect = sidebarEl.getBoundingClientRect();
  const footerH = document.getElementById('sidebar-footer').offsetHeight;
  const available = sidebarEl.clientHeight - footerH;
  const newH = Math.max(60, Math.min(available - 60, e.clientY - rect.top));
  sectionExplorer.style.flex = 'none';
  sectionExplorer.style.height = newH + 'px';
  document.getElementById('section-pages').style.flex = '1';
  document.getElementById('section-pages').style.height = '';
});
document.addEventListener('mouseup', () => {
  if (isVResizing) {
    isVResizing = false;
    sidebarVResizer.classList.remove('dragging');
    isResizing = false;
    resizer.classList.remove('dragging');
  }
});

// ── 사이드바 리사이즈 ─────────────────────────────────────
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('dragging');
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newW = Math.max(140, Math.min(400, e.clientX));
  sidebar.style.width = newW + 'px';
  document.documentElement.style.setProperty('--sidebar-width', newW + 'px');
});
document.addEventListener('mouseup', () => {
  isResizing = false;
  resizer.classList.remove('dragging');
});

// ── 리사이즈 시 맞춤 재적용 ──────────────────────────────
window.addEventListener('resize', () => {
  if (state.pages.length) applyTransform();
});

// ── 초기화 ────────────────────────────────────────────────
state.rtl = loadReadingDirection();
syncReadingDirectionUI();
buildRecentList();
