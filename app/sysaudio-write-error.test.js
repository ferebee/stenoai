'use strict';

/**
 * Source-level guard for the sysaudio write-error recovery path.
 *
 * The incremental-write design exists so that audio interrupted by a crash
 * still leaves a decodable WebM prefix on disk. A mid-recording WriteStream
 * error (ENOSPC, EIO) produces exactly the same artifact — but the error
 * handler used to clear `activeSysAudioFilePath` along with the stream, so
 * `close-system-audio-file` reported "No open system audio file". The
 * renderer's stop path only console.errors that branch, so the partial was
 * never handed to the processing queue and never deleted: a whole meeting
 * orphaned in recordings/ with no note and no user-visible explanation.
 *
 * Driving a real ENOSPC needs a full Electron main process and a wedged
 * filesystem, so we assert the invariant at the source level instead —
 * matching the text-scan pragmatism of regen-title-busy-guard.test.js:
 *
 *   1. the error handler PRESERVES the path/byte count in the failed-* slots
 *      before clearing the active ones;
 *   2. close-system-audio-file CONSULTS those slots on the no-stream branch
 *      and returns the file instead of a bare failure;
 *   3. open-system-audio-file CLEARS them, so a prior recording's partial can
 *      never be returned by a later recording's close.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// Slice one ipcMain.handle('<channel>', ...) body: from its registration to the
// start of the NEXT ipcMain.handle registration (good enough for a text scan —
// the goal is drift detection, not a full parse).
function handlerBody(channel) {
  const start = MAIN.indexOf(`ipcMain.handle('${channel}'`);
  assert.notStrictEqual(start, -1, `no ipcMain.handle('${channel}') found in main.js`);
  const next = MAIN.indexOf('ipcMain.handle(', start + 1);
  return MAIN.slice(start, next === -1 ? MAIN.length : next);
}

test('the write-stream error handler preserves the partial file it drops', () => {
  const open = handlerBody('open-system-audio-file');
  const errStart = open.indexOf("stream.on('error'");
  assert.notStrictEqual(errStart, -1, "no stream.on('error') handler in open-system-audio-file");
  const handler = open.slice(errStart, open.indexOf('});', errStart));

  assert.match(
    handler,
    /failedSysAudioFilePath\s*=\s*activeSysAudioFilePath/,
    'error handler must retain the partial path before clearing the active one'
  );
  assert.match(
    handler,
    /failedSysAudioBytesWritten\s*=\s*activeSysAudioBytesWritten/,
    'error handler must retain the byte count (close gates recovery on it)'
  );
  // The capture is only meaningful if it happens BEFORE the active slots are
  // nulled — otherwise it stores null.
  assert.ok(
    handler.indexOf('failedSysAudioFilePath = activeSysAudioFilePath') <
      handler.indexOf('activeSysAudioFilePath = null'),
    'the partial must be captured before activeSysAudioFilePath is cleared'
  );
});

test('close-system-audio-file recovers the truncated file instead of failing', () => {
  const close = handlerBody('close-system-audio-file');
  const noStream = close.indexOf('if (!stream)');
  assert.notStrictEqual(noStream, -1, 'close-system-audio-file lost its no-stream branch');
  const branch = close.slice(noStream, close.indexOf('try {', noStream));

  assert.match(branch, /failedSysAudioFilePath/, 'no-stream branch must consult the failed-* slots');
  assert.match(
    branch,
    /return\s*\{\s*success:\s*true,\s*filePath:\s*failedPath/,
    'a recovered partial must be returned as a success with its filePath — the renderer gates its handoff on both'
  );
  assert.match(
    branch,
    /failedSysAudioFilePath\s*=\s*null/,
    'the failed-* slots must be consumed, so a second close cannot re-return the same file'
  );
});

test('opening a recording clears any previous failed partial', () => {
  const open = handlerBody('open-system-audio-file');
  assert.match(
    open,
    /failedSysAudioFilePath\s*=\s*null/,
    'open must clear the failed-* slots or a stale partial leaks into the next recording'
  );
});
