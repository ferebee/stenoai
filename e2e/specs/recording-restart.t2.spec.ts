import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeUserConfig } from '../fixtures/user-config';

type RecordingResult = { success: boolean; recordingId?: string; error?: string };
type QueueStatus = { hasRecording: boolean; isPaused: boolean; recordingId: string | null; sessionName: string | null };
type StenoWindow = Window & {
  stenoai: {
    recording: {
      start: (name: string) => Promise<RecordingResult>;
      stop: () => Promise<RecordingResult>;
      pause: () => Promise<RecordingResult>;
      resume: () => Promise<RecordingResult>;
      getQueue: () => Promise<QueueStatus>;
      reportSystemAudioState: (active: boolean, recordingId: string) => void;
    };
  };
};

test('immediate stop and restart keeps the second capture alive after a late first-session inactive report', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  // Whisper post-processing, no model or network assertion. Capture uses a
  // synthetic WebAudio microphone so no physical device or speech is read.
  writeUserConfig(userDataDir, { system_audio_enabled: false, transcription_engine: 'whisper' });
  const { page } = await launchApp({ env: { STENOAI_E2E_CAPTURE_ONLY: '1' } });
  await page.evaluate(() => {
    const audio = new AudioContext();
    const source = audio.createOscillator();
    const destination = audio.createMediaStreamDestination();
    source.frequency.value = 440;
    source.connect(destination);
    source.start();
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException('Synthetic mic-only test', 'NotAllowedError');
    };
  });
  const recordingsDir = path.join(userDataDir, 'recordings');
  const recordedBytes = (name: string) => {
    if (!existsSync(recordingsDir)) return 0;
    const file = readdirSync(recordingsDir).find((entry) => entry.endsWith(`-${name}.webm`));
    return file ? statSync(path.join(recordingsDir, file)).size : 0;
  };

  const first = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.start('Restart_A'),
  );
  expect(first.success).toBe(true);
  expect(first.recordingId).toBeTruthy();
  await expect.poll(() => recordedBytes('Restart_A')).toBeGreaterThan(0);

  // The original bug accepted B before A's MediaRecorder onstop completed.
  // B then looked active in main but its capture never started.
  const restarted = await page.evaluate(async () => {
    const recording = (window as StenoWindow).stenoai.recording;
    const stopped = await recording.stop();
    const started = await recording.start('Restart_B');
    return { stopped, started };
  });
  expect(restarted.stopped.success).toBe(true);
  expect(restarted.started.success).toBe(true);
  expect(restarted.started.recordingId).not.toBe(first.recordingId);
  await expect.poll(() => recordedBytes('Restart_B')).toBeGreaterThan(0);

  await page.evaluate((oldId) =>
    (window as StenoWindow).stenoai.recording.reportSystemAudioState(false, oldId),
    first.recordingId!,
  );
  const afterLateReport = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.getQueue(),
  );
  expect(afterLateReport.hasRecording).toBe(true);
  expect(afterLateReport.recordingId).toBe(restarted.started.recordingId);
  expect(afterLateReport.sessionName).toBe('Restart_B');

  expect((await page.evaluate(() => (window as StenoWindow).stenoai.recording.pause())).success).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.recording.getQueue())).isPaused).toBe(true);
  expect((await page.evaluate(() => (window as StenoWindow).stenoai.recording.resume())).success).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.recording.getQueue())).isPaused).toBe(false);

  const beforeMoreAudio = recordedBytes('Restart_B');
  await expect.poll(() => recordedBytes('Restart_B')).toBeGreaterThan(beforeMoreAudio);
  expect((await page.evaluate(() => (window as StenoWindow).stenoai.recording.stop())).success).toBe(true);
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});
