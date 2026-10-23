/**
 * TalkToDuo change: real-browser WebRTC loopback check for the optional stats probe.
 * Uses the system Chrome when available; CI without a browser reports an explicit skip.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildWebRtcStatsProbeInitScript, WEBRTC_STATS_MARKER } from './webrtc-stats-probe.js';

const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((candidate): candidate is string => !!candidate);
const executablePath = candidates.find(existsSync);

if (!executablePath) {
  console.log('webrtc-stats-probe.loopback.test: SKIP (set PLAYWRIGHT_CHROMIUM_EXECUTABLE)');
} else {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext();
    const lines: string[] = [];
    await context.exposeFunction('logBot', (line: string) => lines.push(line));
    await context.addInitScript(buildWebRtcStatsProbeInitScript({
      allowedOrigin: 'null',
      intervalMs: 200,
      meetingId: 'loopback',
    }));
    const page = await context.newPage();
    await page.setContent('<canvas id="source" width="64" height="64"></canvas>');
    await page.evaluate(async () => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const painter = canvas.getContext('2d')!;
      const stream = canvas.captureStream(15);
      const sender = new RTCPeerConnection();
      const receiver = new RTCPeerConnection();
      sender.onicecandidate = (event) => { if (event.candidate) void receiver.addIceCandidate(event.candidate); };
      receiver.onicecandidate = (event) => { if (event.candidate) void sender.addIceCandidate(event.candidate); };
      for (const track of stream.getTracks()) sender.addTrack(track, stream);
      await sender.setLocalDescription(await sender.createOffer());
      await receiver.setRemoteDescription(sender.localDescription!);
      await receiver.setLocalDescription(await receiver.createAnswer());
      await sender.setRemoteDescription(receiver.localDescription!);
      for (let frame = 0; frame < 20; frame += 1) {
        painter.fillStyle = frame % 2 ? '#0ff' : '#f0f';
        painter.fillRect(0, 0, 64, 64);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await (window as any).__talktoduoStatsProbe.sample();
      (window as any).__talktoduoLoopback = { sender, receiver, stream };
    });

    await page.waitForTimeout(250);
    const events = lines
      .filter((line) => line.startsWith(WEBRTC_STATS_MARKER))
      .map((line) => JSON.parse(line.slice(WEBRTC_STATS_MARKER.length + 1)))
      .filter((event) => event.type === 'talktoduo.webrtc_stats.v1');
    assert(events.length > 0, 'probe emitted stats during a real WebRTC loopback');
    const video = events.flatMap((event) => event.inbound).find((item) => item.kind === 'video');
    assert(video, 'receiver exposed an inbound video RTP report');
    assert(video.bytes_received > 0, 'loopback received video bytes');
    assert(video.frames_decoded > 0, 'loopback decoded video frames');
    console.log('webrtc-stats-probe.loopback.test: PASS');
    await context.close();
  } finally {
    await browser.close();
  }
}
