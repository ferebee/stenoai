import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { t } from '@/i18n';
import { PropertiesFrame, PropertyList, type ReportProperty } from '@/lib/markdown';

// A report's properties, folded away behind a disclosure in the row with the
// My notes / template switch. Closed by default: the report is what a note is
// opened for, and the properties are reference. Open or closed is remembered
// app-wide rather than per note, so someone who wants them sees them on every
// note until they close them again.

export const PROPERTIES_OPEN_KEY = 'steno.reportProperties.open';
export const DETAILS_OPEN_KEY = 'steno.reportProperties.detailsOpen';

/** A remembered on/off view choice. Storage can be missing or throw (private
 *  mode, cleared site data); the choice then lasts for the session only. */
export function useStoredFlag(key: string): [boolean, () => void] {
  const [value, setValue] = React.useState(() => {
    try {
      return localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  });
  const toggle = React.useCallback(() => {
    setValue((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Kept in memory only.
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

function DisclosureButton({
  label,
  count,
  open,
  onToggle,
  controls,
  testId,
  small,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  controls: string;
  testId: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      data-testid={testId}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        small ? 'px-1.5 py-0.5 text-[12px]' : 'px-2 py-1 text-[13px]'
      }`}
      style={{ color: 'var(--fg-2)' }}
    >
      {label}
      <span style={{ color: 'var(--fg-muted)' }}>{count}</span>
      <ChevronRight
        aria-hidden="true"
        className={`${small ? 'size-[12px]' : 'size-[13px]'} transition-transform`}
        style={{ transform: open ? 'rotate(90deg)' : undefined }}
      />
    </button>
  );
}

/** The "Properties" disclosure for the right end of the view-switch row. */
export function PropertiesToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <DisclosureButton
      label={t('report.properties.toggle')}
      count={count}
      open={open}
      onToggle={onToggle}
      controls="report-properties-panel"
      testId="report-properties-toggle"
    />
  );
}

/** The opened panel: the call's properties, then Details behind a second,
 *  smaller disclosure. */
export function PropertiesPanel({
  main,
  details,
  detailsOpen,
  onDetailsToggle,
}: {
  main: ReportProperty[];
  details: ReportProperty[];
  detailsOpen: boolean;
  onDetailsToggle: () => void;
}) {
  return (
    <PropertiesFrame
      id="report-properties-panel"
      className="mb-4 flex flex-col gap-2"
      data-testid="report-properties-panel"
    >
      {main.length > 0 && <PropertyList properties={main} testId="report-properties" />}
      {details.length > 0 && (
        <div className="-ml-1.5 flex flex-col gap-1.5">
          <div>
            <DisclosureButton
              label={t('report.properties.details')}
              count={details.length}
              open={detailsOpen}
              onToggle={onDetailsToggle}
              controls="report-properties-details"
              testId="report-properties-details-toggle"
              small
            />
          </div>
          {detailsOpen && (
            <div id="report-properties-details" className="pl-1.5">
              <PropertyList properties={details} testId="report-properties-details" />
            </div>
          )}
        </div>
      )}
    </PropertiesFrame>
  );
}
