// Unit tests for app/mic-apps.js: which apps hold the mic, and the source_app
// a recording records.
const test = require('node:test');
const assert = require('node:assert');

const { createMicApps, sourceAppAtStart } = require('./mic-apps');
const { isMeetingApp } = require('./meeting-detect');

const start = (app_id, pid) => ({ event: 'start', app_id, pid });
const stop = (app_id, pid) => ({ event: 'stop', app_id, pid });

test('a holder is kept until its stop, matched by pid', () => {
  const m = createMicApps();
  m.event(start('us.zoom.xos', 10));
  assert.equal(m.latest(() => true), 'us.zoom.xos');
  m.event(stop(null, 10));          // the app may be gone by the stop
  assert.equal(m.latest(() => true), null);
});

test('the most recent holder wins', () => {
  const m = createMicApps();
  m.event(start('com.hnc.Discord', 1));
  m.event(start('com.apple.avconferenced', 2));
  assert.equal(m.latest(() => true), 'com.apple.avconferenced');
  m.event(stop('com.apple.avconferenced', 2));
  assert.equal(m.latest(() => true), 'com.hnc.Discord');
});

test('bad events are ignored', () => {
  const m = createMicApps();
  m.event(null);
  m.event({ event: 'start' });      // no pid, no app id
  m.event('start');
  assert.equal(m.latest(() => true), null);
});

test('a detected start records the detected app', () => {
  const m = createMicApps();
  m.event(start('com.hnc.Discord', 1));
  assert.equal(sourceAppAtStart({ trigger: 'notification_click', autoAppId: 'us.zoom.xos',
    micApps: m, isMeeting: isMeetingApp }), 'us.zoom.xos');
});

test('a manual start records the meeting app holding the mic', () => {
  const m = createMicApps();
  m.event(start('com.apple.avconferenced', 7));
  m.event(start('com.superwhisper.macos', 8));   // dictation, not a meeting app
  assert.equal(sourceAppAtStart({ trigger: 'manual', autoAppId: null, micApps: m,
    isMeeting: isMeetingApp }), 'com.apple.avconferenced');
});

test('a manual start with no meeting app on the mic is "manual"', () => {
  const m = createMicApps();
  m.event(start('com.superwhisper.macos', 8));
  for (const trigger of ['manual', 'hotkey', 'tray', 'url_scheme']) {
    assert.equal(sourceAppAtStart({ trigger, autoAppId: null, micApps: m,
      isMeeting: isMeetingApp }), 'manual');
  }
});

test('a detected start without an app id falls back to the mic holders', () => {
  const m = createMicApps();
  m.event(start('com.google.Chrome.helper', 3));
  assert.equal(sourceAppAtStart({ trigger: 'notification_click', autoAppId: null,
    micApps: m, isMeeting: isMeetingApp }), 'com.google.Chrome.helper');
});
