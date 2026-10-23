/** TalkToDuo change: deterministic proof that the probe observes without altering construction. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildWebRtcStatsProbeInitScript, WEBRTC_STATS_MARKER, webRtcStatsProbeEnabled } from './webrtc-stats-probe';

let intervalCallback: (() => void) | undefined;
const lines: string[] = [];

class FakeRTCPeerConnection {
  readonly token: string;
  connectionState = 'connected';

  constructor(token: string) {
    this.token = token;
  }

  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    return new Map([
      ['video', {
        id: 'video-1', type: 'inbound-rtp', kind: 'video', ssrc: 42,
        bytesReceived: 1_024, packetsReceived: 8, framesReceived: 6, framesDecoded: 5,
        totalDecodeTime: 0.25, frameWidth: 640, frameHeight: 360,
        decoderImplementation: 'FakeDecoder',
      }],
      ['audio', {
        id: 'audio-1', type: 'inbound-rtp', kind: 'audio', ssrc: 84,
        bytesReceived: 512, packetsReceived: 4, packetsLost: 1, jitter: 0.012,
      }],
    ]);
  }
}

const context = {
  location: { origin: 'https://meet.google.com' },
  console: { log: (line: string) => lines.push(line) },
  setInterval: (callback: () => void) => { intervalCallback = callback; return 7; },
  clearInterval: () => {},
  RTCPeerConnection: FakeRTCPeerConnection,
  webkitRTCPeerConnection: FakeRTCPeerConnection,
  logBot: (line: string) => lines.push(line),
} as Record<string, unknown>;
context.window = context;

vm.runInNewContext(buildWebRtcStatsProbeInitScript({ meetingId: 'abc-defg-hij' }), context);
const Wrapped = context.RTCPeerConnection as typeof FakeRTCPeerConnection;
const pc = new Wrapped('constructor-argument-is-preserved');
assert(pc instanceof FakeRTCPeerConnection);
assert.equal(pc.token, 'constructor-argument-is-preserved');
assert.equal(context.webkitRTCPeerConnection, Wrapped);

assert(intervalCallback, 'probe installed its one-second sampler');
intervalCallback();
await new Promise((resolve) => setTimeout(resolve, 0));

const line = lines.find((candidate) => candidate.startsWith(WEBRTC_STATS_MARKER));
assert(line, 'probe emitted a stats JSON line');
const event = JSON.parse(line.slice(WEBRTC_STATS_MARKER.length + 1));
assert.equal(event.type, 'talktoduo.webrtc_stats.v1');
assert.equal(event.meeting_id, 'abc-defg-hij');
assert.equal(event.peer_connections, 1);
assert.equal(event.inbound.length, 2);
assert.deepEqual(event.inbound.map((item: { kind: string }) => item.kind).sort(), ['audio', 'video']);
assert.equal(event.inbound.find((item: { kind: string }) => item.kind === 'video').frames_decoded, 5);
assert.equal(event.inbound.find((item: { kind: string }) => item.kind === 'audio').packets_lost, 1);

assert.equal(webRtcStatsProbeEnabled({ TALKTODUO_STATS_PROBE: '1' }), true);
assert.equal(webRtcStatsProbeEnabled({ TALKTODUO_STATS_PROBE: '0' }), false);
assert.equal(webRtcStatsProbeEnabled({}), false);

console.log('webrtc-stats-probe.test: PASS');
