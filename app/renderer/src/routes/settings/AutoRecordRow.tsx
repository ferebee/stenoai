import { Switch } from '@/components/ui/switch';
import { t } from '@/i18n';
import { useAutoRecordMeetingsSetting, useSetAutoRecordMeetings } from '@/hooks/useSettings';
import { SettingRow } from './primitives';

/**
 * "Auto-record detected meetings" (#463): record a detected meeting without the
 * Take Notes tap. Off by default, because it records without asking. It acts on
 * what meeting detection detects, so it is unavailable, and shown off, while
 * Auto-detected meetings is off or unsupported on this Mac.
 */
export function AutoRecordRow({ detectionOn }: { detectionOn: boolean }) {
  const autoRecord = useAutoRecordMeetingsSetting();
  const setAutoRecord = useSetAutoRecordMeetings();
  return (
    <SettingRow
      label={t('settings.general.autoRecord.label')}
      description={
        detectionOn
          ? t('settings.general.autoRecord.description')
          : `${t('settings.general.autoRecord.description')} ${t('settings.general.autoRecord.needsDetection')}`
      }
      muted={!detectionOn}
    >
      <Switch
        aria-label={t('settings.general.autoRecord.label')}
        checked={detectionOn && (autoRecord.data ?? false)}
        onCheckedChange={(v) => setAutoRecord.mutate(v)}
        disabled={!detectionOn || autoRecord.data === undefined}
      />
    </SettingRow>
  );
}
