# TalkToDuo fork changes

Base: Vexa `v0.12.28` (`f1a62fb`). The fork remains Apache-2.0 licensed. All TalkToDuo behavior is
opt-in; with the variables below unset, the code follows the upstream path.

## Benchmark instrumentation

- `TALKTODUO_STATS_PROBE=1` installs an observation-only WebRTC stats sampler on
  `https://meet.google.com`. It retains peer-connection references and calls `getStats()` once per
  second; it does not change SDP, transceivers, tracks, or codecs.
- Output lines start with `[talktoduo-stats]` and contain no audio, transcript, cookie, token, or
  password data.

## Audio-only benchmark mode

- `TALKTODUO_MEET_AUDIO_ONLY=1` writes the pinned Attendee-compatible `meet-preferences` value
  before Meet loads, verifies the in-call Audio only notice, and falls back to Settings → Video →
  Audio only. It logs `verified`, `fallback_clicked`, or `failed` without failing the meeting.
- `TALKTODUO_BROWSER_WINDOW=WxH` applies the same validated dimensions to Chromium and Xvfb;
  unset or invalid values preserve `1920x1080`.
- `TALKTODUO_RECORDER_ONLY=1` disables the TTS sink, virtual microphone, and voice-agent playback.
  Incoming meeting audio capture and `MediaRecorder` remain enabled.
