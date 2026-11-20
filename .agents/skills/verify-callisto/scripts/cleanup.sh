#!/usr/bin/env bash
# Stop the callisto launch.sh started (by its recorded pid, never by name) and
# remove the throwaway Postgres. Evidence under .verify-callisto/evidence/ is
# kept.
#
#   .agents/skills/verify-callisto/scripts/cleanup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
STATE="${VERIFY_CALLISTO_DIR:-$ROOT/.verify-callisto}"
RUN="$STATE/run"
. "$HERE/lib.sh"

if [ -f "$RUN/pid" ]; then
  PID="$(cat "$RUN/pid")"
  if is_our_callisto "$PID"; then
    kill "$PID"
    for _ in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
    is_our_callisto "$PID" && kill -9 "$PID"
    echo "cleanup: stopped callisto (pid $PID)"
  elif kill -0 "$PID" 2>/dev/null; then
    # The pid was reused by something else: never signal it.
    echo "cleanup: pid $PID is no longer this skill's callisto; left it alone"
  else
    echo "cleanup: callisto (pid $PID) had already exited"
  fi
  rm -f "$RUN/pid"
else
  echo "cleanup: no callisto this skill started is running"
fi

if [ -f "$RUN/pg-mode" ]; then
  pg_stop
  echo "cleanup: removed the throwaway Postgres"
fi
rm -rf "$RUN/pg" "$RUN/home"

[ -d "$STATE/evidence" ] && echo "cleanup: evidence kept in $STATE/evidence/"
exit 0
