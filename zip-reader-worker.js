'use strict';
/**
 * yauzl CD 스캔·스트림 읽기를 메인 프로세스 밖(Worker)에서 수행합니다.
 * 메인은 이름 목록만 받아 UI/IPC에 사용합니다.
 */
const { parentPort } = require('worker_threads');
const yauzl = require('yauzl');

const MAX_ZIP_ENTRIES = 50000;

function decodeZipName(buf) {
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

function toLean(entry) {
  const lean = Object.create(yauzl.Entry.prototype);
  lean.versionMadeBy = entry.versionMadeBy;
  lean.versionNeededToExtract = entry.versionNeededToExtract;
  lean.generalPurposeBitFlag = entry.generalPurposeBitFlag;
  lean.compressionMethod = entry.compressionMethod;
  lean.lastModFileTime = entry.lastModFileTime;
  lean.lastModFileDate = entry.lastModFileDate;
  lean.crc32 = entry.crc32;
  lean.compressedSize = entry.compressedSize;
  lean.uncompressedSize = entry.uncompressedSize;
  lean.fileNameLength = entry.fileNameLength;
  lean.extraFieldLength = entry.extraFieldLength;
  lean.fileCommentLength = entry.fileCommentLength;
  lean.internalFileAttributes = entry.internalFileAttributes;
  lean.externalFileAttributes = entry.externalFileAttributes;
  lean.relativeOffsetOfLocalHeader = entry.relativeOffsetOfLocalHeader;
  return lean;
}

let zipfile = null;
const entriesByName = new Map();

function closeZip() {
  entriesByName.clear();
  if (zipfile) {
    try {
      zipfile.close();
    } catch {}
    zipfile = null;
  }
}

function openZip(absPath) {
  return new Promise((resolve, reject) => {
    closeZip();
    const timer = setTimeout(() => reject(new Error('Zip open timed out (120s)')), 120000);
    yauzl.open(
      absPath,
      { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false },
      (err, zf) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }
        zipfile = zf;
        const map = new Map();
        const scheduleRead = () => {
          setImmediate(() => {
            try {
              zf.readEntry();
            } catch (e) {
              clearTimeout(timer);
              reject(e);
            }
          });
        };
        zf.on('entry', entry => {
          const name = decodeZipName(entry.fileName);
          if (!name.endsWith('/') && !name.endsWith('\\')) {
            const lean = toLean(entry);
            lean._name = name;
            map.set(name, lean);
          }
          scheduleRead();
        });
        zf.on('end', () => {
          clearTimeout(timer);
          if (map.size > MAX_ZIP_ENTRIES) {
            try {
              zf.close();
            } catch {}
            zipfile = null;
            return reject(new Error('Zip has too many entries'));
          }
          for (const [k, v] of map) entriesByName.set(k, v);
          const names = [...map.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          resolve({ count: names.length, names });
        });
        zf.on('error', e => {
          clearTimeout(timer);
          reject(e);
        });
        scheduleRead();
      }
    );
  });
}

function readEntryBuffer(entryName, maxBytes) {
  return new Promise((resolve, reject) => {
    const entry = entriesByName.get(entryName);
    if (!entry || !zipfile) return reject(new Error('Entry not found'));
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      let total = 0;
      const chunks = [];
      stream.on('data', c => {
        total += c.length;
        if (total > maxBytes) {
          try {
            stream.destroy();
          } catch {}
          return reject(new Error('Entry exceeds max bytes'));
        }
        chunks.push(c);
      });
      stream.on('end', () => {
        try {
          resolve(Buffer.concat(chunks));
        } catch (e) {
          reject(e);
        }
      });
      stream.on('error', reject);
    });
  });
}

parentPort.on('message', async msg => {
  const { id, op } = msg;
  try {
    if (op === 'open') {
      const { names, count } = await openZip(msg.path);
      parentPort.postMessage({ id, ok: true, names, count });
    } else if (op === 'read') {
      const maxB = typeof msg.maxBytes === 'number' && msg.maxBytes > 0 ? msg.maxBytes : 200 * 1024 * 1024;
      const buf = await readEntryBuffer(msg.name, maxB);
      parentPort.postMessage({ id, ok: true, buffer: buf }, [buf.buffer]);
    } else if (op === 'close') {
      closeZip();
      parentPort.postMessage({ id, ok: true });
    } else {
      parentPort.postMessage({ id, ok: false, error: 'unknown op' });
    }
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e.message || String(e) });
  }
});
