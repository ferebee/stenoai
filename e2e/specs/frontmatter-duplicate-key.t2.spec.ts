import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { test, expect } from '../fixtures/electron';

/**
 * T2 (fork) — a note whose front matter repeats a key must read the same in
 * the meeting LIST (Python `_parse_meeting_markdown`, line-based) and on the
 * DETAIL page (main.js `parseMeetingMarkdown`, js-yaml).
 *
 * Regression: js-yaml throws on a duplicated key by default. The detail
 * parser caught that and continued with no front matter at all, so the note
 * lost its title, folders and is_diarised on the detail page while the list
 * still showed them. The line-based parsers keep the last value, as PyYAML
 * does; the js-yaml readers now load with `json: true` to match.
 *
 * Model-free: pure markdown parse, no ASR / Ollama.
 */

type Meeting = {
  session_info: { name: string; summary_file: string; duration_seconds: number | null };
  is_diarised?: boolean;
  diarised_text?: string | null;
  folders?: string[];
};

type StenoWindow = Window & {
  stenoai: {
    meetings: {
      get: (f: string) => Promise<{ success: boolean; meeting?: Meeting; error?: string }>;
      list: () => Promise<{ success: boolean; meetings: Meeting[] }>;
    };
  };
};

test('a duplicated front matter key reads the same in LIST and DETAIL', async ({
  launchApp,
  userDataDir,
}) => {
  const outputDir = path.join(userDataDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, 'duplicate-key_summary.md');
  writeFileSync(
    file,
    [
      '---',
      'title: "Erika Mustermann: Drucker"',
      `date: "${new Date().toISOString()}"`,
      'duration_seconds: 420',
      'is_diarised: false',
      'folders: ["fold_drucker"]',
      'is_diarised: true',
      '---',
      '',
      '## Summary',
      'The printer prints blank pages.',
      '',
      '## Transcript',
      '',
      '[00:05] [Speaker 2] Der Drucker druckt nur leere Seiten.',
    ].join('\n'),
  );

  const { page } = await launchApp();

  const detail = await page.evaluate((f) => (window as StenoWindow).stenoai.meetings.get(f), file);
  expect(detail.success, detail.error).toBe(true);
  const listed = (
    await page.evaluate(() => (window as StenoWindow).stenoai.meetings.list())
  ).meetings.find((m) => m.session_info.summary_file === file);
  expect(listed, 'seeded note present in list').toBeTruthy();

  const fields = (m: Meeting) => ({
    name: m.session_info.name,
    duration_seconds: m.session_info.duration_seconds,
    is_diarised: m.is_diarised ?? false,
    folders: m.folders ?? [],
  });
  // The last is_diarised wins, and nothing else in the front matter is lost.
  expect(fields(detail.meeting!)).toEqual({
    name: 'Erika Mustermann: Drucker',
    duration_seconds: 420,
    is_diarised: true,
    folders: ['fold_drucker'],
  });
  expect(fields(detail.meeting!)).toEqual(fields(listed!));
  expect(detail.meeting!.diarised_text).toBe(
    '[00:05] [Speaker 2] Der Drucker druckt nur leere Seiten.',
  );
});
