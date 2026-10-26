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
- `TALKTODUO_RECORDER_ONLY=1` has two guarded effects:
  - it disables the TTS sink, virtual microphone, and voice-agent playback;
  - when the invocation also has `recordingEnabled=true` and `transcribeEnabled=false`, it starts
    only the `MediaRecorder` lane and does not construct/start the page-to-Node PCM capture bridge or
    transcription/turn-gating engine. A capture-signal request keeps the full pipeline because that
    diagnostic explicitly needs PCM.
- The optimized recording-only lane is benchmark-only for now. Because silence-based automatic
  leave is fed by the skipped PCM bridge, it fails closed (does not declare `left_alone`); explicit
  stop/removal and the hard maximum bot time still terminate the worker. Live scale validation must
  verify recording integrity and cleanup before this mode is promoted beyond benchmark use.
