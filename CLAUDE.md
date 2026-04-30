# Jovana Viewer — 설계 문서

만화책 뷰어 데스크탑 앱. VS Code Catppuccin Macchiato 테마 기반.

## 기술 스택

- **Electron 25** (Node.js 18 내장) + 순수 HTML/CSS/JS (프레임워크 없음)
- **JSZip** — zip/cbz 압축 파일 내 이미지 읽기
- **electron-builder** — setup.exe 인스톨러 생성

## 파일 구조

```
Jovana Viewer/
├── main.js          # Electron 메인 프로세스 (IPC 핸들러, 창 생성)
├── preload.js       # contextBridge — 렌더러에 api 객체 노출
├── index.html       # UI 골격 (사이드바 + 뷰어 + 탭바 + 상태바)
├── styles.css       # Catppuccin Macchiato 컬러 변수 + 레이아웃
├── renderer.js      # 렌더러 로직 (상태 관리, 렌더링, 이벤트)
├── assets/
│   └── icon.ico     # 앱 아이콘 (16x16 mauve 색상으로 자동 생성됨)
├── package.json     # 빌드 설정 포함 (NSIS x64 스크립트 포함)
├── LICENSE.txt      # 저작권/상업적 배포 금지 라이선스
└── RELEASE_CHECKLIST.md # 최종 배포 전 체크리스트
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
  pages: [],          // { type:'file'|'zip', src, zipPath, entry }
  current: 0,         // 현재 페이지 인덱스 (0-based)
  doubleView: true,   // 두 장 보기
  fitMode: 'page',    // 'width' | 'height' | 'page' | 'manual'
  zoom: 1.0,          // fitMode='manual' 일 때만 사용
  rotation: 0,        // 0, 90, 180, 270
  rtl: false,         // 오른쪽→왼쪽 (일본 만화)
  fileName: '',       // 현재 열린 파일명 (표시용)
  progressKey: '',    // 책/폴더별 진행상황 저장 키
  sourcePath: '',     // 현재 콘텐츠 원본 경로
  sourceType: '',     // 'folder' | 'zip' | 'image'
  autoSwitchingBook: false
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
  - 버튼 라벨이 현재 방향으로 표시됨: `우→좌` / `좌→우`
  - 읽기 방향 설정은 localStorage에 저장되어 앱 재실행 후에도 유지됨
- **맞춤 모드**: 페이지 맞춤 / 너비 맞춤 / 높이 맞춤 / 수동 줌
- **회전**: 90도씩 회전
- **회전 저장**: 현재 페이지(두 장 보기면 2페이지) 회전 결과를 파일에 덮어쓰기 저장
- **사이드바 썸네일**: 실제 이미지 썸네일(지연 로딩) + 파일명 + 페이지 번호
  - zip/cbz 목록에서는 안정성 우선으로 썸네일 디코딩을 생략(플레이스홀더)
- **사이드바 리사이즈**: 드래그로 너비 조절 (140~400px)
- **사이드바 수직 분할 리사이즈**: 탐색기/페이지 섹션 높이 조절
- **탐색기(Explorer)**: 폴더 이동, 상위 폴더, 파일/폴더 이름 변경, 휴지통 삭제
- **일괄 이름 변경(Bulk Rename)**: 숫자 접미사 패턴 유지하며 선택 파일 일괄 리네임
- **최근 파일 목록**: 최근 연 항목(최대 8개) 저장 및 재열기
- **진행상황 저장**: 책/폴더별 마지막 읽은 페이지 복원
- **드래그 앤 드롭**: 파일/폴더를 뷰어에 드롭
- **키보드**: ←→ 또는 PgUp/PgDn 페이지 이동, +/- 줌, R 회전, F11 전체화면
- **추가 키보드**: Home/End 이동, Space/Backspace 이동, Esc 전체화면 해제
- **마우스 클릭**:
  - 단일 클릭: 현재 포인트 중심으로 1.35x 확대
  - 더블 클릭: 원본 보기(페이지 맞춤) 복귀
- **마우스 드래그 팬**: 확대 상태에서만 드래그 이동
- **마우스 휠**: Ctrl+휠 줌 인/아웃, 일반 휠 페이지 이동
- **페이지 점프**: 페이지 카운터 클릭 후 숫자 입력으로 이동
- **사이드바 활성 항목 스크롤**: 현재 페이지 항목을 가능한 중앙(`center`)에 정렬
- **정보 모달(About)**:
  - 툴바 `ⓘ` 버튼으로 열기
  - 제작자 표기: `Jovana/조동연/`
  - 저작권 및 상업적 무단 배포 금지 안내 포함

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

# 최종 배포용(고정): NSIS x64
npm run build:nsis:x64
```

### 배포 메타데이터

- `author`: `Jovana/조동연/`
- `license`: `SEE LICENSE IN LICENSE.txt`
- 라이선스 고지: `LICENSE.txt` 참조
- 최종 점검: `RELEASE_CHECKLIST.md` 참조

## 보안 점검 항목 (기능 유지 조건)

아래 항목은 현재 UX/기능을 바꾸지 않고, 비정상 입력/악성 파일에만 방어선을 추가하는 목적이다.

- **경로 검증 (rename/save/delete)**:
  - `rename-file`의 `newName`은 파일명만 허용 (`path.basename(newName) === newName`)
  - `..`, `/`, `\`, 드라이브 문자(`:`) 등 경로 이동/절대경로 패턴 차단
  - 빈 문자열/공백 이름 차단
- **IPC 입력 검증**:
  - `filePath`, `entryName`, `dataUrl` 타입/길이/필수값 검사
  - 검증 실패 시 즉시 `{ success:false }` 또는 `null` 반환
- **대용량 파일 방어 (DoS 완화)**:
  - zip 파일 최대 크기, 엔트리 수, 단일 엔트리 압축해제 크기 상한 설정
  - 이미지 base64 변환 전 버퍼 크기 상한 설정
  - 제한 초과 시 명확한 에러 메시지 반환(앱 크래시 방지)
- **렌더러 DOM 주입 방지**:
  - 파일명/경로 UI 표시 시 `innerHTML` 대신 `textContent` 기반 렌더링
  - 사용자/파일 시스템 문자열은 HTML로 해석하지 않음
- **권한 최소화 원칙**:
  - 파일 쓰기/삭제 계열 IPC는 "현재 사용자가 연 콘텐츠 범위" 내에서만 허용
  - 시스템/민감 경로에 대한 무분별한 작업 차단
- **오류/로그 정보 최소화**:
  - 사용자 노출 에러 메시지에서 절대경로 과다 노출 방지
  - 디버그 로그에도 불필요한 로컬 경로/개인정보 기록 지양

### 체크리스트 (릴리즈 전)

- [o] 악성 파일명(`..`, 슬래시 포함) 리네임 시도가 거부되는가
- [o] 초대형 zip/cbz 로드 시 앱이 멈추지 않고 안전하게 실패하는가
- [o] 특수문자 파일명 표시 시 UI가 깨지거나 HTML이 삽입되지 않는가
- [o] 삭제/저장 IPC에 비정상 입력 검증이 적용되는가
- [o] 삭제/저장이 의도한 경로 범위 내에서만 동작하는가 (열린 루트 기준 제한)
- [o] 오류 상황에서도 앱 프로세스가 종료되지 않고 안전하게 실패하는가

### 적용 메모 (2026-04-29)

- `main.js`
  - 경로/입력 검증 유틸 추가 (`isSafePathInput`, `isSafeNewName`)
  - 허용 루트 관리 추가 (`set-active-root`, `allowedRoots`)
  - 삭제/이름변경/저장을 허용 루트 내부 경로로 제한
  - `rename-file`, `delete-file`, `save-image`, `read-dir-entries`, `get-file-type` 입력 검증 추가
  - zip/image 크기 및 엔트리 수 제한(`LIMITS`) 추가
  - 비정상/과대 입력은 `null` 또는 `{ success:false }`로 안전 실패 처리
- `preload.js`
  - `setActiveRoot()` API 추가
- `renderer.js`
  - `loadPath()` 시작 시 `setActiveRoot(filePath)` 호출로 현재 열람 루트 등록
  - 파일명/경로 표시 구간 일부를 `innerHTML`에서 `textContent` 기반 DOM 생성으로 변경
  - 대상: 최근 파일 목록, 탐색기 폴더/파일 목록 렌더링

### 적용 메모 (2026-04-30)

- `renderer.js`
  - 전체화면/리사이즈 시 맞춤 재계산 강화
  - 페이지 맞춤에서 비율 유지 + 과도 확대 방지
  - 클릭 확대(1.35x), 더블클릭 원복, 확대 상태 드래그 이동으로 마우스 UX 조정
  - 읽기 방향(`rtl`) 저장/복원(localStorage) + 버튼 라벨 동적 반영
  - 사이드바 활성 페이지 자동 스크롤을 중앙 정렬로 변경
  - About 모달(정보 버튼, ESC/오버레이 닫기) 추가
- `index.html` / `styles.css`
  - 시작 화면 법적 고지 문구 추가
  - About 모달 UI 추가
- `main.js`
  - zip IPC 작업 직렬화 큐(`zipOpQueue`) 추가
  - zip 캐시/오픈 작업 안정화(중복 open 방지, 캐시 상한)
- 배포 준비
  - `LICENSE.txt` 추가
  - `RELEASE_CHECKLIST.md` 추가
  - `package.json`에 배포 메타데이터 및 `build:nsis:x64` 스크립트 추가

## 알려진 이슈 / TODO

- cbr/rar 형식: JSZip이 실제로 파싱 못할 수 있음 (별도 라이브러리 필요)
- 북마크 기능 미구현
- cbr/rar 삭제: zip과 동일하게 삭제 불가 처리됨 (zip 내부 파일 삭제 불가)

---

## 릴리즈용 간단 사용자 가이드

### 설치

1. `Jovana Viewer Setup ... .exe` 실행
2. 안내에 따라 설치 완료
3. 바탕화면 또는 시작 메뉴에서 `Jovana Viewer` 실행

### 기본 사용

1. 왼쪽 상단 `📁` 버튼으로 파일/폴더/zip(cbz) 열기
2. `← / →` 또는 마우스 휠로 페이지 이동
3. `F11`로 전체화면 전환

### 보기 조작

- 한 장/두 장 보기: `▣` / `⧈`
- 맞춤 모드: `↔`(너비), `↕`(높이), `⊡`(페이지)
- 확대/축소: `＋` / `－`
- 단일 클릭: 1.35x 확대
- 더블 클릭: 원래 보기(페이지 맞춤) 복귀
- 확대 상태에서 드래그: 화면 이동

### 읽기 방향

- 툴바 `우→좌` / `좌→우` 버튼으로 전환
- 한 번 설정하면 앱을 껐다 켜도 유지됨

### 권장 단축키

- 다음/이전: `Arrow`, `PageUp/PageDown`, `Space/Backspace`
- 처음/끝: `Home / End`
- 회전: `R`
- 전체화면 종료: `Esc`

### 프로그램 정보/라이선스

- 툴바 `ⓘ` 버튼: 제작자/프로그램 정보 확인
- `LICENSE.txt`:
  - 제작자 동의 없는 상업적 배포 및 판매 금지
  - 위반 시 민·형사상 책임 가능
