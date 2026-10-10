// Auto-record detected meetings (#463): with the setting on, a meeting the mic
// watcher detects starts recording at once instead of posting "Meeting
// detected" and waiting for a Take Notes tap. Off by default, because it
// records without asking; the toast it shows instead says that it did.
//
// Pure helpers, kept out of main.js so they are unit-testable without
// Electron. main.js owns the wiring: handleMicEvent decides, requestAutoRecord
// starts, and the system-audio-recording-state handler announces.

const fs = require('fs');

// How long an unattended start may take to report that capture is running
// before its announcement is dropped. Capture normally reports within a second
// or two; a start that fails (no microphone, permission revoked) never does,
// and a later manual recording must not inherit its "Recording started" toast.
const ANNOUNCE_WINDOW_MS = 30_000;

/**
 * Sync read of the setting from config.json; default OFF. Same pattern as
 * loadAutoDetectMeetingsEnabled in main.js: a JSON read on the detection path
 * instead of spawning Python for a boolean. Only a real `true` turns it on, so
 * a hand-edited "true" string or a missing or unreadable file reads as off.
 */
function loadAutoRecordMeetingsEnabled(configPath) {
  try {
    if (!fs.existsSync(configPath)) return false;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return cfg.auto_record_meetings_enabled === true;
  } catch (_) {
    return false;
  }
}

/**
 * The toast shown once an unattended recording is running: passive, naming the
 * meeting (its calendar title when one matched, else the app), with Stop.
 * Tagged like "Meeting detected" so it replaces a detection toast still waiting
 * in the queue rather than following it.
 */
function buildAutoRecordStartedOptions({ appName, calendarTitle } = {}) {
  return {
    title: 'Recording started',
    body: calendarTitle || appName || 'A meeting',
    actions: [{ type: 'button', text: 'Stop' }],
    iconType: 'recording',
    tag: 'meeting-detected',
  };
}

/**
 * Remembers an unattended start until capture confirms it, so the toast says
 * "Recording started" only for a recording that did. `expect` when the start
 * is requested; `take` when capture reports it is recording, which returns the
 * start's details once, or null if there was none or it is older than the
 * window.
 */
function createStartAnnouncer({ now = Date.now, windowMs = ANNOUNCE_WINDOW_MS } = {}) {
  let pending = null;
  return {
    expect(details) {
      pending = { ...details, at: now() };
    },
    take() {
      const p = pending;
      pending = null;
      if (!p || now() - p.at > windowMs) return null;
      const { at: _at, ...details } = p;
      return details;
    },
  };
}

module.exports = {
  ANNOUNCE_WINDOW_MS,
  loadAutoRecordMeetingsEnabled,
  buildAutoRecordStartedOptions,
  createStartAnnouncer,
};
