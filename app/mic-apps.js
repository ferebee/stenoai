// Which apps hold the microphone, kept from mic-monitor's start/stop events,
// and what a recording records as its `source_app` (FORK.md group 11).
//
// mic-monitor polls Core Audio once a second and starts from an empty set, so
// at launch it reports every process already capturing input: the set kept
// here is complete from then on. Keyed by pid, because a stop event carries
// the pid it started with while the app's own process may already be gone.

function createMicApps() {
  const holders = new Map(); // pid (or app_id when there is none) -> { app_id, order }
  let order = 0;
  return {
    event(evt) {
      if (!evt || typeof evt !== 'object') return;
      const key = evt.pid ?? evt.app_id;
      if (key === null || key === undefined) return;
      if (evt.event === 'start') holders.set(key, { app_id: evt.app_id || null, order: ++order });
      else if (evt.event === 'stop') holders.delete(key);
    },
    // The bundle id of the holder that took the mic most recently among those
    // `accept` admits, or null.
    latest(accept) {
      let best = null;
      for (const h of holders.values()) {
        if (h.app_id && accept(h) && (!best || h.order > best.order)) best = h;
      }
      return best ? best.app_id : null;
    },
  };
}

// `source_app` at the start of a recording. Started from the "Meeting
// detected" notification, it is the detected app; started any other way, it
// is the meeting app that most recently took the mic, or "manual" when none
// holds it (an in-person meeting, a dictation, or a call not yet dialled — the
// caller upgrades "manual" when a meeting app takes the mic during the
// recording).
function sourceAppAtStart({ trigger, autoAppId, micApps, isMeeting }) {
  if (trigger === 'notification_click' && autoAppId) return autoAppId;
  return micApps.latest((h) => isMeeting({ app_id: h.app_id })) || 'manual';
}

module.exports = { createMicApps, sourceAppAtStart };
