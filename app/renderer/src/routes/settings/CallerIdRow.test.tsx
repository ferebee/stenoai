import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CallerIdRow } from './CallerIdRow';

// The description names iMCP as a link to its home page, so the row says how to
// get what it needs before anyone turns it on.

const h = vi.hoisted(() => ({ openExternal: vi.fn(() => Promise.resolve({ success: true })) }));

vi.mock('@/hooks/useSettings', () => ({
  useCallerIdSetting: () => ({
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
  useSetCallerId: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/ipc', () => ({
  ipc: () => ({ shell: { openExternal: h.openExternal }, settings: { openImcpDownload: vi.fn() } }),
}));

describe('CallerIdRow', () => {
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
