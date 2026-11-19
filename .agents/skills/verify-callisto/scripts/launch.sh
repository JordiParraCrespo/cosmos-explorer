#!/usr/bin/env bash
# Build Callisto as the image does and start it against a real network, on a
# throwaway Postgres, from a little behind the chain head.
#
#   .agents/skills/verify-callisto/scripts/launch.sh [testnet|mainnet] [--blocks N] [--no-build]
#
# It indexes the last N blocks (default 50) and then keeps following the
# chain, as production does once caught up. Ready means the first block of
# the window is in the database, not just that the process is up.
set -euo pipefail

NETWORK="testnet"
BLOCKS=50
BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    mainnet | testnet) NETWORK="$1" ;;
    --blocks) BLOCKS="${2:?--blocks needs a number}"; shift ;;
    --no-build) BUILD=0 ;;
    *) echo "launch: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
APP="$ROOT/apps/callisto"
STATE="${VERIFY_CALLISTO_DIR:-$ROOT/.verify-callisto}"
RUN="$STATE/run"
ACTIONS_PORT="${VERIFY_CALLISTO_ACTIONS_PORT:-3998}"
mkdir -p "$RUN"
. "$HERE/lib.sh"

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if [ -f "$RUN/pid" ] && is_our_callisto "$(cat "$RUN/pid")"; then
  echo "launch: a callisto this skill started is already running (pid $(cat "$RUN/pid")). Run cleanup.sh first." >&2
  exit 1
fi
for p in "$PG_PORT" "$ACTIONS_PORT"; do
  if port_busy "$p"; then
    echo "launch: something already listens on :$p; set VERIFY_CALLISTO_PG_PORT / VERIFY_CALLISTO_ACTIONS_PORT." >&2
    exit 1
  fi
done

if [ "$BUILD" = 1 ]; then
  echo "launch: building callisto (log: $RUN/build.log)"
  (cd "$APP" && make build >"$RUN/build.log" 2>&1) || {
    echo "launch: build failed; last lines of $RUN/build.log:" >&2
    tail -20 "$RUN/build.log" >&2
    exit 1
  }
fi
[ -x "$APP/build/callisto" ] || { echo "launch: no $APP/build/callisto; run without --no-build" >&2; exit 1; }
git -C "$ROOT" rev-parse HEAD >"$RUN/commit"

echo "launch: starting a throwaway Postgres on 127.0.0.1:$PG_PORT"
pg_start || { echo "launch: could not start Postgres; run cleanup.sh" >&2; exit 1; }
for f in $(ls "$APP"/database/schema/*.sql | sort); do
  pg_psql <"$f" >/dev/null || { echo "launch: applying $(basename "$f") failed" >&2; exit 1; }
done

node "$HERE/render-config.mjs" "$NETWORK" "$BLOCKS" "$(cat "$RUN/db-url")" "$ACTIONS_PORT"
START="$(node -p "require('$RUN/launch.json').start")"

# Background callisto itself, not a subshell around it, so the recorded pid
# is the indexer's and cleanup.sh stops what it means to.
: >"$RUN/callisto.log"
nohup "$APP/build/callisto" start --home "$RUN/home" >"$RUN/callisto.log" 2>&1 &
echo $! >"$RUN/pid"

# Genesis is parsed first (when the config asks for it), then the window.
DEADLINE=$((SECONDS + 300))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  N="$(pg_psql -At -c "SELECT count(*) FROM block WHERE height >= $START" 2>/dev/null || echo 0)"
  if [ "${N:-0}" -gt 0 ]; then
    echo "launch: ready, $NETWORK indexing from $START (pid $(cat "$RUN/pid"), log $RUN/callisto.log)"
    exit 0
  fi
  if ! kill -0 "$(cat "$RUN/pid")" 2>/dev/null; then
    echo "launch: callisto exited; last lines of $RUN/callisto.log:" >&2
    tail -20 "$RUN/callisto.log" >&2
    exit 1
  fi
  sleep 2
done
echo "launch: no block from the window was indexed within 300s; see $RUN/callisto.log" >&2
exit 1
