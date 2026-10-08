import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useCallerIdSetting, useSetCallerId } from '@/hooks/useSettings';
import { t } from '@/i18n';
import { ipc, type GetCallerIdResponse } from '@/lib/ipc';
import { COMPACT_BTN, SettingRow } from './primitives';

type CallerIdSettings = Extract<GetCallerIdResponse, { success: true }>;

// What to tell the user, in the order they would fix things. Literal keys, so
// the copy inventory can read them.
function statusText(data: CallerIdSettings): string | null {
  if (!data.caller_id_enabled) return null;
  if (!data.meeting_detection) return t('settings.general.callerId.status.needsMeetingDetection');
  switch (data.status.state) {
    case 'not-installed':
      return t('settings.general.callerId.status.notInstalled');
    case 'not-running':
      return t('settings.general.callerId.status.notRunning');
    case 'awaiting-approval':
      return t('settings.general.callerId.status.awaitingApproval');
    case 'declined':
      return t('settings.general.callerId.status.declined');
    case 'phone-off':
      return t('settings.general.callerId.status.phoneOff');
    case 'ready':
      return data.status.contacts
        ? t('settings.general.callerId.status.ready')
        : t('settings.general.callerId.status.noContacts');
    default:
      return null;
  }
}

/**
 * "Identify phone callers": names the caller on notes of phone and FaceTime
 * calls through iMCP (app/caller-id.js). macOS only; renders nothing elsewhere.
 */
export function CallerIdRow() {
  const setting = useCallerIdSetting();
  const setCallerId = useSetCallerId();
  const data = setting.data;
  if (data && !data.supported) return null;

  const enabled = data?.caller_id_enabled ?? false;
  const status = data ? statusText(data) : null;
  const offerDownload = enabled && data?.status.state === 'not-installed';

  return (
    <SettingRow
      label={t('settings.general.callerId.label')}
      align="start"
      description={
        <>
          {t('settings.general.callerId.description')}
          {status && (
            <span className="mt-1 block" data-testid="caller-id-status">
              {status}
            </span>
          )}
          {offerDownload && (
            <span className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className={COMPACT_BTN}
                onClick={() => void ipc().settings.openImcpDownload()}
              >
                {t('settings.general.callerId.getImcp')}
              </Button>
              <span>{t('settings.general.callerId.homebrewHint', { command: data.homebrew })}</span>
            </span>
          )}
          {setting.isError && (
            <span className="mt-1 block">{t('settings.general.callerId.loadError')}</span>
          )}
        </>
      }
    >
      <Switch
        checked={enabled}
        onCheckedChange={(v) => setCallerId.mutate(v)}
        disabled={data === undefined || setCallerId.isPending}
        aria-label={t('settings.general.callerId.label')}
        data-testid="caller-id-toggle"
      />
    </SettingRow>
  );
}
