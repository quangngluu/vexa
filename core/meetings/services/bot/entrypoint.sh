#!/bin/bash
# @vexa/bot entrypoint — bring up the X11 + PulseAudio environment the browser /
# capture / speak path expects, then run the worker (boot → join → ... → die).
#
# Mirrors the production bot's meeting-mode bringup (services/vexa-bot/core/
# entrypoint.sh), trimmed to what the v0.12 carved bot needs:
#   • Xvfb on :99           — a display for the headful Chromium @vexa/remote-browser launches.
#   • fluxbox               — a WM so the browser window manages cleanly.
#   • PulseAudio            — the audio graph: tts_sink → virtual_mic (speak) + a null sink.
# The worker itself reads VEXA_BOT_CONFIG (invocation.v1) and drives the rest.
set -u

export DISPLAY="${DISPLAY:-:99}"
TALKTODUO_BROWSER_WINDOW="${TALKTODUO_BROWSER_WINDOW:-1920x1080}"
WINDOW_VALID=0
if printf '%s' "${TALKTODUO_BROWSER_WINDOW}" | grep -Eq '^[0-9]{3,4}x[0-9]{3,4}$'; then
  WINDOW_WIDTH=$((10#${TALKTODUO_BROWSER_WINDOW%x*}))
  WINDOW_HEIGHT=$((10#${TALKTODUO_BROWSER_WINDOW#*x}))
  if (( WINDOW_WIDTH >= 320 && WINDOW_WIDTH <= 3840 && WINDOW_HEIGHT >= 240 && WINDOW_HEIGHT <= 2160 )); then
    WINDOW_VALID=1
  fi
fi
if (( WINDOW_VALID == 0 )); then
  echo "[entrypoint] Invalid TALKTODUO_BROWSER_WINDOW; using 1920x1080" >&2
  TALKTODUO_BROWSER_WINDOW=1920x1080
fi
export TALKTODUO_BROWSER_WINDOW

echo "[entrypoint] Starting Xvfb on ${DISPLAY}..."
Xvfb "${DISPLAY}" -screen 0 "${TALKTODUO_BROWSER_WINDOW}x24" >/tmp/xvfb.log 2>&1 &
# Give Xvfb a moment to create the socket before anything attaches.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.3
done

echo "[entrypoint] Starting fluxbox..."
fluxbox >/tmp/fluxbox.log 2>&1 &

echo "[entrypoint] Starting PulseAudio (no idle exit)..."
pulseaudio --start --exit-idle-time=-1 --log-target=syslog 2>/dev/null || true
sleep 1
# Voice/capture audio graph (best-effort; only the speak path strictly needs it).
if [ "${TALKTODUO_RECORDER_ONLY:-0}" != "1" ]; then
  pactl load-module module-null-sink sink_name=tts_sink \
    sink_properties=device.description="TTSAudioSink" 2>/dev/null || true
  pactl load-module module-remap-source master=tts_sink.monitor source_name=virtual_mic \
    source_properties=device.description="VirtualMicrophone" 2>/dev/null || true
  pactl set-default-source virtual_mic 2>/dev/null || true
  pactl set-sink-mute tts_sink 1 2>/dev/null || true
  pactl set-source-mute virtual_mic 1 2>/dev/null || true
else
  echo "[entrypoint] Recorder-only: TTS sink, virtual mic, and voice-agent playback disabled"
fi

# Run the worker from its package dir so the schema path (src→../../../contracts)
# and the pnpm-linked workspace deps resolve. Always emit start + exit breadcrumbs
# so an instant crash is never silent in container stdout.
# BOT_APP_DIR/BOT_WORKER_ENTRY are overridable so the entrypoint's signal handling is
# unit-testable outside the image (entrypoint.test.ts drives a stub worker through it).
cd "${BOT_APP_DIR:-/app/core/meetings/services/bot}" || exit 1
echo "[entrypoint] Starting @vexa/bot worker (node dist/index.js, DISPLAY=${DISPLAY})..."

# SIGNAL FORWARDING (the exit-137 fix): this script is PID 1, and a PID-1 bash neither dies on
# SIGTERM nor passes it to a foreground child — so `docker stop` (and the runtime's graceful
# terminate) reached NOBODY, every stop escalated to SIGKILL (exit 137) mid-capture, and the
# bot's graceful leave (leave meeting → flush recording → terminal lifecycle callback → exit 0,
# bounded <25s by its own watchdog) never ran. Run the worker in the background and FORWARD
# TERM/INT to it; wait() resumes on the trap (128+N) so loop until the worker really exits.
node "${BOT_WORKER_ENTRY:-dist/index.js}" &
WORKER_PID=$!
trap 'kill -TERM "${WORKER_PID}" 2>/dev/null' TERM
trap 'kill -INT "${WORKER_PID}" 2>/dev/null' INT
wait "${WORKER_PID}"
EXIT_CODE=$?
while kill -0 "${WORKER_PID}" 2>/dev/null; do
  wait "${WORKER_PID}"
  EXIT_CODE=$?
done
echo "[entrypoint] @vexa/bot worker exited with code ${EXIT_CODE}"
exit ${EXIT_CODE}
