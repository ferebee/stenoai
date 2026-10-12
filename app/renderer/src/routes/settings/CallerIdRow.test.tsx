import { beforeEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CallerIdRow } from './CallerIdRow';

// The description names iMCP as a link to its home page, so the row says how to
// get what it needs before anyone turns it on.

const h = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve({ success: true })),
  isMac: true,
  saveFailed: false,
  queried: 0,
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    get isMac() {
      return h.isMac;
    },
  };
});

vi.mock('@/hooks/useSettings', () => ({
  useCallerIdSetting: () => (h.queried++, {
    data: {
      supported: true,
      caller_id_enabled: false,
      meeting_detection: true,
      status: { state: 'off', contacts: false },
      download_url: 'https://imcp.app/download',
      homebrew: 'brew install --cask mattt/tap/iMCP',
    },
    isError: false,
  }),
  useSetCallerId: () => ({ mutate: vi.fn(), isPending: false, isError: h.saveFailed }),
}));

vi.mock('@/lib/ipc', () => ({
  ipc: () => ({ shell: { openExternal: h.openExternal }, settings: { openImcpDownload: vi.fn() } }),
}));

beforeEach(() => {
  Object.assign(h, { isMac: true, saveFailed: false, queried: 0 });
});

describe('CallerIdRow', () => {
  test('off macOS it renders nothing and asks main for nothing', () => {
    h.isMac = false;
    const { container } = render(<CallerIdRow />);
    expect(container.innerHTML).toBe('');
    expect(h.queried).toBe(0);
  });

  test('a failed save says so', () => {
    h.saveFailed = true;
    render(<CallerIdRow />);
    expect(screen.getByRole('alert').textContent).toBe('Could not change the caller setting. Try again.');
  });

  test('names iMCP as a link to imcp.app, inside the sentence', () => {
    render(<CallerIdRow />);
    const link = screen.getByRole('button', { name: 'iMCP.app' });
    expect(link.parentElement?.textContent).toContain(
      "Requires the free iMCP.app to read this Mac's call history and Contacts",
    );
    fireEvent.click(link);
    expect(h.openExternal).toHaveBeenCalledWith('https://imcp.app');
  });
});
