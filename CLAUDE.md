# Jovana Viewer — 설계 문서

만화책 뷰어 데스크탑 앱. VS Code Catppuccin Macchiato 테마 기반.

## 기술 스택

- **Electron 25** (Node.js 18 내장) + 순수 HTML/CSS/JS (프레임워크 없음)
- **JSZip** — zip/cbz 압축 파일 내 이미지 읽기
- **electron-builder** — setup.exe 인스톨러 생성

## 파일 구조

```
직박구리/
├── main.js          # Electron 메인 프로세스 (IPC 핸들러, 창 생성)
├── preload.js       # contextBridge — 렌더러에 api 객체 노출
├── index.html       # UI 골격 (사이드바 + 뷰어 + 탭바 + 상태바)
├── styles.css       # Catppuccin Macchiato 컬러 변수 + 레이아웃
├── renderer.js      # 렌더러 로직 (상태 관리, 렌더링, 이벤트)
├── assets/
│   └── icon.ico     # 앱 아이콘 (16x16 mauve 색상으로 자동 생성됨)
└── package.json     # 빌드 설정 포함
```

## 아키텍처

### 프로세스 분리 (Electron 표준)

```
메인 프로세스 (main.js)          렌더러 프로세스 (renderer.js)
  ├── 파일 시스템 접근               ├── UI 상태 관리
  ├── 다이얼로그 열기                ├── 이미지 렌더링
  └── IPC 핸들러                    └── 키보드/마우스 이벤트
         ↕ preload.js (window.api)
```

### IPC API (preload.js → main.js)

| 함수                            | 설명                                   |
| ------------------------------- | -------------------------------------- |
| `api.openFile()`                | 파일 열기 다이얼로그                   |
| `api.openFolder()`              | 폴더 열기 다이얼로그                   |
| `api.readFolder(path)`          | 폴더 내 이미지 파일 목록 반환          |
| `api.readImage(path)`           | 이미지 파일 → base64 data URL          |
| `api.readZipList(path)`         | zip 내 이미지 엔트리 목록              |
| `api.readZipImage(path, entry)` | zip 내 특정 이미지 → base64            |
| `api.getFileType(path)`         | 'zip' / 'folder' / 'image' / 'unknown' |

## 상태 (renderer.js `state` 객체)

```js
{
  pages: [],        // { type:'file'|'zip', src, zipPath, entry }
  current: 0,       // 현재 페이지 인덱스 (0-based)
  doubleView: true, // 두 장 보기
  fitMode: 'page',  // 'width' | 'height' | 'page' | 'manual'
  zoom: 1.0,        // fitMode='manual' 일 때만 사용
  rotation: 0,      // 0, 90, 180, 270
  rtl: false,       // 오른쪽→왼쪽 (일본 만화)
  fileName: ''      // 현재 열린 파일명 (표시용)
}
```

## 지원 파일 형식

- **이미지 직접 열기**: jpg, jpeg, png, webp, gif, bmp
  → 같은 폴더의 모든 이미지를 자동으로 시리즈로 불러옴
- **폴더 열기**: 폴더 내 이미지 파일 전체 로드
- **압축 파일**: zip, cbz (JSZip으로 처리) / cbr, rar (목록만 — 실제 추출은 zip과 동일 시도)

## 주요 기능

- **두 장 보기 / 한 장 보기** 토글
- **RTL 모드** (일본 만화 오른쪽→왼쪽)
- **맞춤 모드**: 페이지 맞춤 / 너비 맞춤 / 높이 맞춤 / 수동 줌
- **회전**: 90도씩 회전
- **사이드바 썸네일**: 파일명 + 페이지 번호, 클릭으로 이동
- **사이드바 리사이즈**: 드래그로 너비 조절 (140~400px)
- **드래그 앤 드롭**: 파일/폴더를 뷰어에 드롭
- **키보드**: ←→ 또는 PgUp/PgDn 페이지 이동, +/- 줌, R 회전, F11 전체화면
- **마우스 클릭**: 화면 왼쪽/오른쪽 클릭으로 페이지 이동
- **Ctrl+휠**: 줌 인/아웃

## Catppuccin Macchiato 주요 컬러

| 변수         | 값      | 용도                                            |
| ------------ | ------- | ----------------------------------------------- |
| `--base`     | #24273a | 뷰어 배경                                       |
| `--mantle`   | #1e2030 | 사이드바 배경                                   |
| `--crust`    | #181926 | 탭바/상태바 배경                                |
| `--surface0` | #363a4f | 호버/활성 배경                                  |
| `--mauve`    | #c6a0f6 | 강조색 (상태바, 활성 버튼, 사이드바 인디케이터) |
| `--text`     | #cad3f5 | 기본 텍스트                                     |

## 개발 실행 방법

```bash
# Windows 터미널(cmd/PowerShell/VS Code 터미널)에서:
cd "C:\Users\우창개발\Desktop\Jovana Viewer"
npm start
```

> ⚠️ Claude Code 내부 bash에서는 ELECTRON_RUN_AS_NODE=1 충돌로 실행 불가.
> 반드시 일반 Windows 터미널에서 실행할 것.

## 빌드 (exe 인스톨러)

```bash
npm run build
# → dist/Jovana Viewer Setup 1.0.0.exe 생성
```

## 알려진 이슈 / TODO

- cbr/rar 형식: JSZip이 실제로 파싱 못할 수 있음 (별도 라이브러리 필요)
- 썸네일에 실제 이미지 미리보기 없음 (파일명만 표시)
- 북마크 기능 미구현
- 최근 파일 목록 미구현
- cbr/rar 삭제: zip과 동일하게 삭제 불가 처리됨 (zip 내부 파일 삭제 불가)
