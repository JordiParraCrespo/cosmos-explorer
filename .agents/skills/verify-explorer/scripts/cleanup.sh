#!/usr/bin/env bash
# Stop the instance launch.sh started, by the pid it recorded, never by
# process name. Evidence under .verify-explorer/evidence/ is kept.
#
#   .agents/skills/verify-explorer/scripts/cleanup.sh
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE="${VERIFY_EXPLORER_DIR:-$ROOT/.verify-explorer}"
RUN="$STATE/run"
. "$(dirname "$0")/lib.sh"

if [ -f "$RUN/pid" ]; then
  PID="$(cat "$RUN/pid")"
  if is_our_server "$PID"; then
    kill "$PID"
    for _ in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
    is_our_server "$PID" && kill -9 "$PID"
    echo "cleanup: stopped pid $PID"
  elif kill -0 "$PID" 2>/dev/null; then
    # The pid was reused by something else: never signal it.
    echo "cleanup: pid $PID is no longer the explorer server ($(ps -p "$PID" -o command= 2>/dev/null | cut -c1-60)); left it alone"
  else
    echo "cleanup: pid $PID had already exited"
  fi
  rm -f "$RUN/pid" "$RUN/port" "$RUN/network"
else
  echo "cleanup: nothing this skill started is running"
fi

if [ -d "$STATE/evidence" ]; then
  echo "cleanup: evidence kept in $STATE/evidence/"
fi
