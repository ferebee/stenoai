import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { AutoRecordRow } from './AutoRecordRow';

// Auto-record (#463) records without asking, so the row must start off, act
// only while meeting detection does, and say why when it can't.

const h = vi.hoisted(() => ({
  autoRecord: { data: false as boolean | undefined },
  setAutoRecord: { mutate: vi.fn() },
}));

vi.mock('@/hooks/useSettings', () => ({
  useAutoRecordMeetingsSetting: () => h.autoRecord,
  useSetAutoRecordMeetings: () => h.setAutoRecord,
}));

const toggle = () => screen.getByRole('switch', { name: 'Auto-record detected meetings' }) as HTMLButtonElement;

beforeEach(() => {
  h.autoRecord.data = false;
  h.setAutoRecord.mutate.mockReset();
});

describe('AutoRecordRow', () => {
  test('off by default, and turning it on saves the setting', async () => {
    render(<AutoRecordRow detectionOn />);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(toggle().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(h.setAutoRecord.mutate).toHaveBeenCalledWith(true);
  });

  test('shows a saved on', () => {
    h.autoRecord.data = true;
    render(<AutoRecordRow detectionOn />);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  test('without meeting detection it is off, disabled, and says why', () => {
    h.autoRecord.data = true;
    render(<AutoRecordRow detectionOn={false} />);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText(/Turn on Auto-detected meetings to use this\./)).toBeTruthy();
  });

  test('disabled until the setting has loaded', () => {
    h.autoRecord.data = undefined;
    render(<AutoRecordRow detectionOn />);
    expect(toggle().disabled).toBe(true);
  });
});
