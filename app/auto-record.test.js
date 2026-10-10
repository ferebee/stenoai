// Unit tests for app/auto-record.js: the setting read, the toast copy, and the
// announcer that keeps "Recording started" to recordings that did start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ANNOUNCE_WINDOW_MS,
  loadAutoRecordMeetingsEnabled,
  buildAutoRecordStartedOptions,
  createStartAnnouncer,
} = require('./auto-record');

function configWith(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-record-'));
  const file = path.join(dir, 'config.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  return file;
}

test('the setting is off unless config.json holds a real true', () => {
  assert.equal(loadAutoRecordMeetingsEnabled(configWith(undefined)), false); // no file
  assert.equal(loadAutoRecordMeetingsEnabled(configWith('{}')), false);
  assert.equal(loadAutoRecordMeetingsEnabled(configWith('{"auto_record_meetings_enabled": "true"}')), false);
  assert.equal(loadAutoRecordMeetingsEnabled(configWith('not json')), false);
  assert.equal(loadAutoRecordMeetingsEnabled(configWith('{"auto_record_meetings_enabled": true}')), true);
});

test('the toast names the calendar event, else the app, and offers Stop', () => {
  const withEvent = buildAutoRecordStartedOptions({ appName: 'Zoom', calendarTitle: 'Weekly sync' });
  assert.equal(withEvent.title, 'Recording started');
  assert.equal(withEvent.body, 'Weekly sync');
  assert.deepEqual(withEvent.actions, [{ type: 'button', text: 'Stop' }]);
  assert.equal(withEvent.tag, 'meeting-detected');
  assert.equal(buildAutoRecordStartedOptions({ appName: 'FaceTime' }).body, 'FaceTime');
  assert.equal(buildAutoRecordStartedOptions({}).body, 'A meeting');
});

test('a confirmed start is announced once', () => {
  const announcer = createStartAnnouncer({ now: () => 1000 });
  announcer.expect({ appName: 'Zoom' });
  assert.deepEqual(announcer.take(), { appName: 'Zoom' });
  assert.equal(announcer.take(), null, 'a capture flap reporting "recording" again is not a new start');
});

test('nothing is announced without an unattended start', () => {
  assert.equal(createStartAnnouncer().take(), null);
});

test('a start that never reported capture does not leak into a later recording', () => {
  let t = 0;
  const announcer = createStartAnnouncer({ now: () => t });
  announcer.expect({ appName: 'Zoom' });
  t = ANNOUNCE_WINDOW_MS + 1;
  assert.equal(announcer.take(), null);
});
