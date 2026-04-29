// ── 상태 ──────────────────────────────────────────────────
const state = {
  pages: [],          // { src: 'path or zip:entry', type: 'file'|'zip', zipPath: '' }
  current: 0,         // 현재 페이지 인덱스 (0-based)
  doubleView: true,   // 두 장 보기
  fitMode: 'page',    // 'width' | 'height' | 'page'
  zoom: 1.0,
  rotation: 0,        // 0, 90, 180, 270
  rtl: false,         // 오른쪽→왼쪽 읽기
  fileName: ''
};

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

// ── 탐색기 ────────────────────────────────────────────────
const explorerState = { path: null, parent: null };

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
  if (explorerState.parent) browseDir(explorerState.parent);
});

async function browseDir(dirPath) {
  const result = await window.api.readDirEntries(dirPath);
  explorerState.path = dirPath;
  explorerState.parent = result.parent;

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
    item.innerHTML = `<span class="explorer-icon">📁</span><span class="explorer-name">${dir}</span>`;
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
    item.innerHTML = `<span class="explorer-icon">${icon}</span><span class="explorer-name">${file}</span>`;
    item.title = file;
    item.appendChild(makeActions(fullPath, file, false));
    item.addEventListener('click', () => {
      loadPath(fullPath);
      const sec = document.getElementById('section-pages');
      if (sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
    });
    list.appendChild(item);
  });
}

// ── 파일 열기 ─────────────────────────────────────────────
document.getElementById('btn-open-file').addEventListener('click', async () => {
  const filePath = await window.api.openFile();
  if (filePath) await loadPath(filePath);
});

document.getElementById('btn-open-folder').addEventListener('click', async () => {
  const folderPath = await window.api.openFolder();
  if (folderPath) await loadPath(folderPath);
});

async function loadPath(filePath) {
  const type = await window.api.getFileType(filePath);
  const folder = type === 'folder' ? filePath
    : filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
  browseDir(folder);
  if (type === 'zip') {
    await loadZip(filePath);
  } else if (type === 'folder') {
    await loadFolder(filePath);
  } else if (type === 'image') {
    await loadImageFile(filePath);
  }
}

async function loadZip(filePath) {
  const entries = await window.api.readZipList(filePath);
  if (!entries.length) {
    alert('ZIP 파일에서 이미지를 찾을 수 없습니다.\n(CBR/RAR 형식은 지원하지 않습니다)');
    return;
  }
  state.pages = entries.map(e => ({ type: 'zip', zipPath: filePath, entry: e }));
  state.current = 0;
  state.fileName = filePath.split(/[\\/]/).pop();
  tabTitle.textContent = state.fileName;
  buildSidebar();
  await render();
}

async function loadFolder(folderPath) {
  const files = await window.api.readFolder(folderPath);
  if (!files.length) return;
  state.pages = files.map(f => ({ type: 'file', src: f }));
  state.current = 0;
  state.fileName = folderPath.split(/[\\/]/).pop();
  tabTitle.textContent = state.fileName;
  buildSidebar();
  await render();
}

async function loadImageFile(filePath) {
  // 같은 폴더의 이미지 모두 불러오기
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
  state.fileName = filePath.split(/[\\/]/).pop();
  tabTitle.textContent = state.fileName;
  buildSidebar();
  await render();
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
  if (!state.pages.length) {
    dropZone.style.display = 'flex';
    pagesContainer.style.display = 'none';
    updateUI();
    return;
  }

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

  applyTransform();
  updateUI();
  highlightSidebar();
  viewer.scrollTo(0, 0);
}

function applyTransform() {
  const rot = `rotate(${state.rotation}deg)`;
  pageLeft.style.transform = rot;
  pageRight.style.transform = rot;

  if (state.fitMode === 'page') {
    const vw = viewer.clientWidth - 40;
    const vh = viewer.clientHeight - 40;
    const count = (state.doubleView && state.current + 1 < state.pages.length) ? 2 : 1;
    const maxW = Math.floor((vw - (count > 1 ? 4 : 0)) / count);
    pageLeft.style.width = maxW + 'px';
    pageLeft.style.height = '';
    pageLeft.style.maxWidth = '';
    pageLeft.style.maxHeight = vh + 'px';
    if (pageRight.style.display !== 'none') {
      pageRight.style.width = maxW + 'px';
      pageRight.style.height = '';
      pageRight.style.maxWidth = '';
      pageRight.style.maxHeight = vh + 'px';
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
    const vh = viewer.clientHeight - 40;
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
}

// ── 사이드바 썸네일 ───────────────────────────────────────
function buildSidebar() {
  fileList.innerHTML = '';
  state.pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.idx = i;

    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = i + 1;

    const name = document.createElement('span');
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.style.flex = '1';
    const label = page.type === 'zip'
      ? page.entry.split('/').pop()
      : page.src.split(/[\\/]/).pop();
    name.textContent = label;
    name.title = label;

    // 삭제 버튼 (zip 내부 파일은 삭제 불가)
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
        // pages 배열에서 제거하고 current 보정
        state.pages.splice(i, 1);
        if (state.current >= state.pages.length) {
          state.current = Math.max(0, state.pages.length - 1);
        }
        buildSidebar();
        if (state.pages.length > 0) render();
        else {
          dropZone.style.display = 'flex';
          pagesContainer.style.display = 'none';
          updateUI();
        }
      } else {
        alert('삭제 실패: ' + result.error);
      }
    });

    item.appendChild(num);
    item.appendChild(name);
    item.appendChild(delBtn);
    item.addEventListener('click', () => {
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
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

// ── 네비게이션 ────────────────────────────────────────────
function goNext() {
  const step = state.doubleView ? 2 : 1;
  if (state.current + step < state.pages.length) {
    state.current = Math.min(state.current + step, state.pages.length - 1);
    render();
  }
}
function goPrev() {
  const step = state.doubleView ? 2 : 1;
  if (state.current - step >= 0) {
    state.current = Math.max(state.current - step, 0);
    render();
  }
}

document.getElementById('btn-next').addEventListener('click', goNext);
document.getElementById('btn-prev').addEventListener('click', goPrev);

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
    state.current = 0; render();
  } else if (e.key === 'End') {
    state.current = Math.max(state.pages.length - (state.doubleView ? 2 : 1), 0);
    render();
  } else if (e.key === 'F11') {
    toggleFullscreen();
  } else if (e.key === 'Escape') {
    window.api.exitFullscreen();
  } else if (e.key === 'r' || e.key === 'R') {
    rotate();
  } else if (e.key === '+' || e.key === '=') {
    zoomIn();
  } else if (e.key === '-') {
    zoomOut();
  }
});

// 클릭으로 페이지 넘기기
viewer.addEventListener('click', (e) => {
  if (!state.pages.length) return;
  const vw = viewer.clientWidth;
  if (e.clientX < vw / 2) {
    state.rtl ? goNext() : goPrev();
  } else {
    state.rtl ? goPrev() : goNext();
  }
});

// ── 도구모음 버튼 ─────────────────────────────────────────
document.getElementById('btn-fit-width').addEventListener('click', () => setFit('width'));
document.getElementById('btn-fit-height').addEventListener('click', () => setFit('height'));
document.getElementById('btn-fit-page').addEventListener('click', () => setFit('page'));
document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
document.getElementById('btn-rotate').addEventListener('click', rotate);

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

document.getElementById('btn-rtl').addEventListener('click', () => {
  state.rtl = !state.rtl;
  document.getElementById('btn-rtl').classList.toggle('active', state.rtl);
  render();
});

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

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
}

async function toggleFullscreen() {
  await window.api.toggleFullscreen();
}

// ── 마우스 휠 줌 ──────────────────────────────────────────
viewer.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  }
}, { passive: false });

// ── 드래그 앤 드롭 ────────────────────────────────────────
const overlay = document.createElement('div');
overlay.id = 'global-drop-overlay';
overlay.textContent = '파일을 드롭하세요';
document.body.appendChild(overlay);

let dragCounter = 0;
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  overlay.classList.add('visible');
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('visible'); }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  overlay.classList.remove('visible');
  const file = e.dataTransfer.files[0];
  if (file) await loadPath(file.path);
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
