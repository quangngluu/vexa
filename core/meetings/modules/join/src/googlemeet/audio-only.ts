/** TalkToDuo change: opt-in Google Meet incoming-video Audio only preference + UI fallback. */
import type { Page } from 'playwright';

export type AudioOnlyStatus = 'verified' | 'fallback_clicked' | 'failed';

export function audioOnlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TALKTODUO_MEET_AUDIO_ONLY === '1';
}

/** The exact double-stringified localStorage value used by Attendee at b5b7f99. */
export function audioOnlyPreferenceValue(): string {
  const preferences: any[] = Array(9).fill(null);
  preferences[8] = Array(6).fill(null);
  preferences[8][5] = 1;
  return JSON.stringify(JSON.stringify(preferences));
}

export function buildGoogleMeetAudioOnlyInitScript(): string {
  return `(() => {
    if (location.origin !== 'https://meet.google.com') return;
    try {
      localStorage.setItem('meet-preferences', ${JSON.stringify(audioOnlyPreferenceValue())});
    } catch (error) {
      try { (window.logBot || console.error)('[talktoduo-audio-only] localStorage failed: ' + String(error)); } catch (_) {}
    }
  })();`;
}

const VERIFIED_COPY = [
  'Incoming video is set to audio only',
  'Video nhận đến được đặt thành Chỉ có âm thanh',
  'Video đến được đặt thành Chỉ có âm thanh',
];

async function visibleText(page: Page, text: string): Promise<boolean> {
  try {
    return await page.getByText(text, { exact: false }).first().isVisible({ timeout: 1_000 });
  } catch {
    return false;
  }
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const candidate = page.locator(selector).first();
      if (await candidate.isVisible({ timeout: 1_500 })) {
        await candidate.click({ timeout: 2_000 });
        return true;
      }
    } catch { /* try the next locale/selector */ }
  }
  return false;
}

/** Verify the persisted preference after admission; if Meet ignored it, drive Settings → Video. */
export async function configureGoogleMeetAudioOnly(
  page: Page,
  log: (message: string) => void = console.log,
  observe?: (status: AudioOnlyStatus) => void,
): Promise<AudioOnlyStatus> {
  const report = (status: AudioOnlyStatus): AudioOnlyStatus => {
    log(`[talktoduo-audio-only] ${JSON.stringify({ audio_only: status })}`);
    try { observe?.(status); } catch { /* telemetry must never disturb the meeting */ }
    return status;
  };
  let status: AudioOnlyStatus = 'failed';
  try {
    for (const copy of VERIFIED_COPY) {
      if (await visibleText(page, copy)) {
        status = 'verified';
        return report(status);
      }
    }
    if (!await clickFirst(page, [
      'button[jsname="NakZHc"][aria-label="More options"]',
      'button[aria-label="More options"]',
      'button[aria-label="Tùy chọn khác"]',
    ])) throw new Error('more-options control not found');
    if (!await clickFirst(page, ['li:has-text("Settings")', 'li:has-text("Cài đặt")'])) {
      throw new Error('settings item not found');
    }
    if (!await clickFirst(page, ['button[aria-label="Video"]'])) {
      throw new Error('video settings tab not found');
    }
    if (!await clickFirst(page, ['li[aria-label="Audio only"]', 'li[aria-label="Chỉ có âm thanh"]', 'li[aria-label="Chỉ âm thanh"]'])) {
      throw new Error('audio-only option not found');
    }
    // Leave the call UI unobscured. Selection is already persisted; a missing localized close control is harmless.
    await clickFirst(page, ['button[aria-label="Close"]', 'button[aria-label="Đóng"]']);
    status = 'fallback_clicked';
  } catch (error) {
    log(`[talktoduo-audio-only] fallback failed: ${String(error)}`);
  }
  return report(status);
}
