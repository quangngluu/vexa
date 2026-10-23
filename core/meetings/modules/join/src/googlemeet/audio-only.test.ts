import {
  audioOnlyEnabled,
  audioOnlyPreferenceValue,
  buildGoogleMeetAudioOnlyInitScript,
  configureGoogleMeetAudioOnly,
} from './audio-only';

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const attendeeBytes = '"[null,null,null,null,null,null,null,null,[null,null,null,null,null,1]]"';
equal(audioOnlyPreferenceValue(), attendeeBytes, 'preference bytes match Attendee b5b7f99');
equal(audioOnlyEnabled({ TALKTODUO_MEET_AUDIO_ONLY: '1' }), true, 'flag 1 enables');
equal(audioOnlyEnabled({ TALKTODUO_MEET_AUDIO_ONLY: '0' }), false, 'flag 0 disables');
equal(audioOnlyEnabled({}), false, 'unset flag preserves upstream');
const initScript = buildGoogleMeetAudioOnlyInitScript();
equal(initScript.includes("location.origin !== 'https://meet.google.com'"), true, 'init script is origin-gated');
equal(initScript.includes(JSON.stringify(attendeeBytes)), true, 'init script embeds exact Attendee bytes');

function fakePage(verified: boolean, visibleSelectors: string[] = []): any {
  return {
    getByText: () => ({ first: () => ({ isVisible: async () => verified }) }),
    locator: (selector: string) => ({
      first: () => ({
        isVisible: async () => visibleSelectors.includes(selector),
        click: async () => {},
      }),
    }),
  };
}

async function main(): Promise<void> {
  const observations: string[] = [];
  equal(await configureGoogleMeetAudioOnly(fakePage(true), () => {}, (status) => observations.push(status)), 'verified', 'verified copy avoids UI fallback');
  equal(await configureGoogleMeetAudioOnly(fakePage(false, [
    'button[aria-label="More options"]',
    'li:has-text("Settings")',
    'button[aria-label="Video"]',
    'li[aria-label="Audio only"]',
  ]), () => {}), 'fallback_clicked', 'fallback clicks all required controls');
  equal(await configureGoogleMeetAudioOnly(fakePage(false), () => {}), 'failed', 'missing controls fail without throwing');
  equal(observations, ['verified'], 'status is emitted to telemetry callback exactly once');
  console.log('audio-only.test: PASS');
}

void main();
