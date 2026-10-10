import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DETAILS_OPEN_KEY,
  PROPERTIES_OPEN_KEY,
  PropertiesPanel,
  PropertiesToggle,
  useStoredFlag,
} from './ReportPropertiesDisclosure';
import type { ReportProperty } from '@/lib/markdown';

const main: ReportProperty[] = [['client', 'Erika Mustermann'], ['issue', 'Blindkopie leer']];
const details: ReportProperty[] = [['title', 'Erika Mustermann: Blindkopie leer'], ['template_id', 'x']];

// The pieces as MeetingDetail puts them together: the toggle in the switch row,
// the panel above the report only while it is open.
function Harness() {
  const [open, toggle] = useStoredFlag(PROPERTIES_OPEN_KEY);
  const [detailsOpen, toggleDetails] = useStoredFlag(DETAILS_OPEN_KEY);
  return (
    <>
      <PropertiesToggle count={main.length} open={open} onToggle={toggle} />
      {open && (
        <PropertiesPanel
          main={main}
          details={details}
          detailsOpen={detailsOpen}
          onDetailsToggle={toggleDetails}
        />
      )}
    </>
  );
}

describe('report properties disclosure', () => {
  // Node's own `localStorage` global shadows jsdom's here and is unusable, so
  // each test gets a fresh in-memory one.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is closed by default, with the count on the toggle', () => {
    render(<Harness />);
    const toggle = screen.getByTestId('report-properties-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('Properties2');
    expect(screen.queryByTestId('report-properties-panel')).toBeNull();
  });

  it('opens the call\'s properties, with Details folded until asked for', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('report-properties-toggle'));
    expect(screen.getByTestId('report-properties').textContent).toContain('Erika Mustermann');
    expect(screen.queryByTestId('report-properties-details')).toBeNull();
    fireEvent.click(screen.getByTestId('report-properties-details-toggle'));
    expect(screen.getByTestId('report-properties-details').textContent).toContain('template_id');
  });

  it('remembers the choice for the next note', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByTestId('report-properties-toggle'));
    first.unmount();
    render(<Harness />);
    expect(screen.getByTestId('report-properties-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('report-properties-panel')).toBeTruthy();
  });
});
