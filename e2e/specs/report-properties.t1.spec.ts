import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC. A report from a template with fields opens
 * with its properties folded away: "Properties" sits at the right end of the
 * view-switch row, and the title, inferred fields and Steno's bookkeeping wait
 * under a second disclosure, Details (FORK.md group 5).
 *
 * Seams: STENOAI_E2E_SEED_MEETING=1 + STENOAI_E2E_SEED_REPORT=fields seed one
 * meeting carrying one report with front matter (app/e2e-mock-ipc.js).
 */

const SUMMARY_FILE = 'epsilon_summary.json';

test('a report\'s properties are folded away until asked for', async ({ launchApp }, testInfo) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_SEED_REPORT: 'fields' },
  });
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);

  const toggle = page.getByTestId('report-properties-toggle');
  // The Standard note has no front matter, so no toggle.
  await expect(page.getByTestId('note-view-toggle')).toBeVisible();
  await expect(toggle).toHaveCount(0);

  await page.getByTestId('note-view-menu-trigger').click();
  await page.getByTestId('note-view-menu')
    .getByRole('button', { name: /^Support call \(fields\)/ }).click();
  await expect(page.getByText('Die Blindkopie blieb leer')).toBeVisible();

  // Closed by default; the count is the call's own properties only.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText('Properties5');
  await expect(page.getByTestId('report-properties-panel')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('closed.png') });

  await toggle.click();
  const panel = page.getByTestId('report-properties-panel');
  await expect(panel.getByTestId('report-properties')).toContainText('Erika Mustermann');
  await expect(panel.getByTestId('report-properties')).not.toContainText('sentiment');
  await expect(panel.getByTestId('report-properties-details')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('open.png') });

  await panel.getByTestId('report-properties-details-toggle').click();
  await expect(panel.getByTestId('report-properties-details')).toContainText('sentiment');
  await expect(panel.getByTestId('report-properties-details')).toContainText('template_id');
  await page.screenshot({ path: testInfo.outputPath('details.png') });

  // My notes has no properties to show.
  await page.getByTestId('tab-notes').click();
  await expect(toggle).toHaveCount(0);
});
