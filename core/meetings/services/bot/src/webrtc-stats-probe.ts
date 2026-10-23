/**
 * TalkToDuo change: optional, observation-only WebRTC inbound stats probe.
 *
 * The probe wraps construction only to retain peer-connection references. It never calls
 * setConfiguration, addTransceiver, setCodecPreferences, or otherwise mutates media behavior.
 */

export const WEBRTC_STATS_MARKER = '[talktoduo-stats]';

export interface WebRtcStatsProbeOptions {
  meetingId?: string | number;
  intervalMs?: number;
  allowedOrigin?: string;
}

/** Build a document-start script. The production caller installs it only when explicitly enabled. */
export function buildWebRtcStatsProbeInitScript(options: WebRtcStatsProbeOptions = {}): string {
  const meetingId = options.meetingId == null ? null : String(options.meetingId);
  const intervalMs = Math.max(100, Math.floor(options.intervalMs ?? 1_000));
  const allowedOrigin = options.allowedOrigin ?? 'https://meet.google.com';

  return `(() => {
    if (location.origin !== ${JSON.stringify(allowedOrigin)}) return;
    if (window.__talktoduoStatsProbe) return;

    const NativeRTCPeerConnection = window.RTCPeerConnection;
    if (typeof NativeRTCPeerConnection !== 'function') return;

    const marker = ${JSON.stringify(WEBRTC_STATS_MARKER)};
    const meetingId = ${JSON.stringify(meetingId)};
    const connections = new Map();
    const previous = new Map();
    let nextConnectionId = 1;

    const WrappedRTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
      construct(target, args, newTarget) {
        const pc = Reflect.construct(target, args, newTarget);
        connections.set(pc, nextConnectionId++);
        return pc;
      }
    });
    window.RTCPeerConnection = WrappedRTCPeerConnection;
    if (window.webkitRTCPeerConnection === NativeRTCPeerConnection) {
      window.webkitRTCPeerConnection = WrappedRTCPeerConnection;
    }

    const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const delta = (current, prior) => Math.max(0, current - (typeof prior === 'number' ? prior : 0));
    const emit = (payload) => {
      const line = marker + ' ' + JSON.stringify(payload);
      try {
        if (typeof window.logBot === 'function') window.logBot(line);
        else console.log(line);
      } catch (_) {}
    };

    const sample = async () => {
      const sampledAtMs = Date.now();
      const inbound = [];
      for (const [pc, peerConnectionId] of Array.from(connections.entries())) {
        if (!pc || pc.connectionState === 'closed') {
          connections.delete(pc);
          continue;
        }
        let stats;
        try {
          stats = await pc.getStats();
        } catch (error) {
          emit({
            type: 'talktoduo.webrtc_stats_error.v1',
            meeting_id: meetingId,
            sampled_at_ms: sampledAtMs,
            peer_connection_id: peerConnectionId,
            error: String(error && error.message ? error.message : error).slice(0, 200)
          });
          continue;
        }
        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp' || report.isRemote) return;
          const kind = report.kind || report.mediaType;
          if (kind !== 'audio' && kind !== 'video') return;
          const key = peerConnectionId + ':' + report.id;
          const prior = previous.get(key) || {};
          const bytesReceived = number(report.bytesReceived);
          const packetsReceived = number(report.packetsReceived);
          const packetsLost = number(report.packetsLost);
          const framesReceived = number(report.framesReceived);
          const framesDecoded = number(report.framesDecoded);
          const totalDecodeTime = number(report.totalDecodeTime);
          inbound.push({
            peer_connection_id: peerConnectionId,
            report_id: String(report.id),
            ssrc: report.ssrc == null ? null : String(report.ssrc),
            kind,
            bytes_received: bytesReceived,
            bytes_received_delta: delta(bytesReceived, prior.bytesReceived),
            packets_received: packetsReceived,
            packets_received_delta: delta(packetsReceived, prior.packetsReceived),
            packets_lost: packetsLost,
            packets_lost_delta: delta(packetsLost, prior.packetsLost),
            jitter: number(report.jitter),
            frames_received: framesReceived,
            frames_received_delta: delta(framesReceived, prior.framesReceived),
            frames_decoded: framesDecoded,
            frames_decoded_delta: delta(framesDecoded, prior.framesDecoded),
            total_decode_time: totalDecodeTime,
            total_decode_time_delta: delta(totalDecodeTime, prior.totalDecodeTime),
            frame_width: number(report.frameWidth),
            frame_height: number(report.frameHeight),
            decoder_implementation: report.decoderImplementation == null ? null : String(report.decoderImplementation)
          });
          previous.set(key, { bytesReceived, packetsReceived, packetsLost, framesReceived, framesDecoded, totalDecodeTime });
        });
      }
      emit({
        type: 'talktoduo.webrtc_stats.v1',
        meeting_id: meetingId,
        sampled_at_ms: sampledAtMs,
        peer_connections: connections.size,
        inbound
      });
    };

    const timer = setInterval(() => { void sample(); }, ${intervalMs});
    window.__talktoduoStatsProbe = {
      sample,
      stop() { clearInterval(timer); }
    };
  })();`;
}

export function webRtcStatsProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TALKTODUO_STATS_PROBE === '1';
}
