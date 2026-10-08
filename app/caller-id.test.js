const { test } = require('node:test');
const assert = require('node:assert');

const { CallerId, isCallAudio } = require('./caller-id');

// A fake iMCP whose call history can change between lookups, and a recorder of
// what reaches the backend. Times are seconds from T0; data is invented.
const T0 = Date.parse('2026-03-02T14:00:00Z');
const ms = (s) => T0 + s * 1000;
const iso = (s) => new Date(ms(s)).toISOString().replace(/\.\d{3}Z$/, 'Z');

function entry({ id = '1', number = '+12025550100', type = 'incoming', start = 0, duration = 0 } = {}) {
  return { '@id': id, phoneNumber: number, callType: type, date: iso(start),
    durationSeconds: duration, serviceProvider: 'com.apple.Telephony' };
}

function setup({ history = [], contacts = { '+12025550100': 'Erika Mustermann' }, busy = () => false } = {}) {
  const imcp = {
    status: { state: 'ready', contacts: true },
    started: 0,
    lookups: 0,
    history,
    start() { this.started += 1; },
    stop() {},
    async recentCalls() {
      this.lookups += 1;
      return typeof this.history === 'function' ? this.history(this.lookups) : this.history;
    },
    async contactName(number) { return contacts[number] ?? null; },
  };
  const applied = [];
  const callerId = new CallerId({
    imcp,
    isProcessing: busy,
    applyCallInfo: async (stem, calls, options) => { applied.push({ stem, calls, ...options }); },
    sleep: async () => {},
    now: () => ms(300), // a clock that matches the fake call times
    lookupAttempts: 5,
  });
  callerId.setEnabled(true);
  return { callerId, imcp, applied };
}

const mic = (event, s, app = 'com.apple.avconferenced') => ({ event, app_id: app, pid: 42, ts: ms(s) / 1000 });

test('a call answered on this Mac, recorded to the end', async () => {
  const { callerId, applied } = setup({ history: [entry({ start: 0, duration: 113 })] });
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('sysaudio-1-Note', ms(1));
  callerId.micEvent(mic('stop', 56));
  callerId.recordingStopped(ms(58));
  await callerId.idle();
  assert.deepStrictEqual(applied, [{
    stem: 'sysaudio-1-Note', sidecarOnly: false,
    calls: [{ name: 'Erika Mustermann', number: '+12025550100', direction: 'incoming',
      service: 'phone', started_at: new Date(ms(0)).toISOString() }],
  }]);
});

test('a call answered on this Mac, recording stopped mid-call: found at once', async () => {
  const { callerId, applied } = setup({ history: [entry({ start: 0, duration: 0 })] });
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('stem', ms(1));
  callerId.recordingStopped(ms(30));
  await callerId.idle();
  assert.strictEqual(applied.length, 1);
});

test('a call moved from the iPhone, recording stopped mid-call: found when the call ends', async () => {
  const { callerId, imcp, applied } = setup({ history: [] });
  callerId.micEvent(mic('start', 30));
  callerId.recordingStarted('stem', ms(31));
  callerId.recordingStopped(ms(40));
  await callerId.idle();
  assert.strictEqual(applied.length, 0);
  imcp.history = [entry({ type: 'outgoing', start: 0, duration: 138 })];
  callerId.micEvent(mic('stop', 69));
  await callerId.idle();
  assert.strictEqual(applied.length, 1);
  assert.strictEqual(applied[0].calls[0].direction, 'outgoing');
});

test('the record appearing a moment after the call ends is waited for', async () => {
  const { callerId, imcp, applied } = setup({
    history: (attempt) => (attempt < 3 ? [] : [entry({ start: 0, duration: 102 })]),
  });
  callerId.micEvent(mic('start', 29));
  callerId.recordingStarted('stem', ms(29.5));
  callerId.micEvent(mic('stop', 51));
  callerId.recordingStopped(ms(52));
  await callerId.idle();
  assert.strictEqual(applied.length, 1);
  assert.strictEqual(imcp.lookups, 3);
});

test('a recording without call audio is never looked up', async () => {
  const { callerId, imcp, applied } = setup({ history: [entry({ start: 0, duration: 60 })] });
  callerId.micEvent(mic('start', 0, 'us.zoom.xos'));
  callerId.recordingStarted('stem', ms(1));
  callerId.micEvent(mic('stop', 60, 'us.zoom.xos'));
  callerId.recordingStopped(ms(61));
  await callerId.idle();
  assert.strictEqual(imcp.lookups, 0);
  assert.strictEqual(applied.length, 0);
});

test('a call that ended before the recording began is not attached', async () => {
  const { callerId, imcp } = setup({ history: [entry({ start: 0, duration: 60 })] });
  callerId.micEvent(mic('start', 0));
  callerId.micEvent(mic('stop', 30));
  callerId.recordingStarted('stem', ms(100));
  callerId.recordingStopped(ms(200));
  await callerId.idle();
  assert.strictEqual(imcp.lookups, 0);
});

test('while the note is still processing, the call is stored, then applied when it finishes', async () => {
  let busy = true;
  const { callerId, applied } = setup({ history: [entry({ start: 0, duration: 113 })], busy: () => busy });
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('stem', ms(1));
  callerId.micEvent(mic('stop', 56));
  callerId.recordingStopped(ms(58));
  await callerId.idle();
  assert.deepStrictEqual(applied.map((a) => a.sidecarOnly), [true]);
  busy = false;
  callerId.processingFinished(['other-stem']);
  callerId.processingFinished(['stem']);
  await callerId.idle();
  assert.deepStrictEqual(applied.map((a) => a.sidecarOnly), [true, false]);
});

test('a number not in Contacts is kept without a name', async () => {
  const { callerId, applied } = setup({
    history: [entry({ number: '+12025550101', start: 0, duration: 113 })], contacts: {},
  });
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('stem', ms(1));
  callerId.micEvent(mic('stop', 56));
  callerId.recordingStopped(ms(58));
  await callerId.idle();
  assert.strictEqual(applied[0].calls[0].name, null);
  assert.strictEqual(applied[0].calls[0].number, '+12025550101');
});

test('switched off, nothing is looked up', async () => {
  const { callerId, imcp } = setup({ history: [entry({ start: 0, duration: 113 })] });
  callerId.setEnabled(false);
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('stem', ms(1));
  callerId.micEvent(mic('stop', 56));
  callerId.recordingStopped(ms(58));
  await callerId.idle();
  assert.strictEqual(imcp.lookups, 0);
});

test('iMCP not ready: the lookup gives up without an error', async () => {
  const { callerId, imcp, applied } = setup({ history: [entry({ start: 0, duration: 113 })] });
  imcp.status = { state: 'not-running', contacts: false };
  callerId.micEvent(mic('start', 0.4));
  callerId.recordingStarted('stem', ms(1));
  callerId.micEvent(mic('stop', 56));
  callerId.recordingStopped(ms(58));
  await callerId.idle();
  assert.strictEqual(imcp.lookups, 0);
  assert.strictEqual(applied.length, 0);
});

test('isCallAudio recognises call audio only', () => {
  assert.strictEqual(isCallAudio({ app_id: 'com.apple.avconferenced' }), true);
  assert.strictEqual(isCallAudio({ app_id: 'com.apple.FaceTime' }), true);
  assert.strictEqual(isCallAudio({ app_id: 'us.zoom.xos' }), false);
  assert.strictEqual(isCallAudio({}), false);
});
