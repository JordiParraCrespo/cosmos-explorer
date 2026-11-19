# Shared by launch.sh and cleanup.sh (sourced, not run). Expects ROOT, STATE
# and RUN to be set.

PG_PORT="${VERIFY_CALLISTO_PG_PORT:-6544}"
PG_CONTAINER="verify-callisto-pg"

# True when pid $1 is alive and is the callisto this skill started: its
# command line is `callisto start --home <RUN>/home`. A recorded pid can
# outlive its process and be reused by something unrelated, which must never
# be signalled or mistaken for ours.
is_our_callisto() {
  local pid="$1" cmd
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$cmd" in
    *"callisto start --home $RUN/home"*) return 0 ;;
    *) return 1 ;;
  esac
}

docker_usable() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Directory holding initdb/pg_ctl: PATH first, then the usual install places.
pg_bindir() {
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  local d
  for d in $(ls -d /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin 2>/dev/null | sort -V -r); do
    [ -x "$d/pg_ctl" ] && { echo "$d"; return; }
  done
  return 1
}

# Run a Postgres server binary as a user it accepts (it refuses root).
as_pg_user() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

# Start a throwaway Postgres on 127.0.0.1:$PG_PORT and record how to reach it:
# $RUN/pg-mode (docker|local), $RUN/psql.json (the psql argv check.mjs uses)
# and $RUN/db-url (what Callisto connects to). Docker when it works, as
# apps/callisto/docker-compose.yml does; otherwise local server binaries.
pg_start() {
  if docker_usable; then
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
    echo docker >"$RUN/pg-mode"
    docker run -d --name "$PG_CONTAINER" -p "127.0.0.1:$PG_PORT:5432" \
      -e POSTGRES_USER=callisto -e POSTGRES_PASSWORD=callisto -e POSTGRES_DB=callisto \
      postgres:17 >/dev/null || return 1
    printf '["docker","exec","-i","%s","psql","-U","callisto","-d","callisto"]\n' "$PG_CONTAINER" >"$RUN/psql.json"
    local i
    for i in $(seq 1 60); do
      docker exec "$PG_CONTAINER" pg_isready -U callisto -d callisto >/dev/null 2>&1 && break
      [ "$i" = 60 ] && { echo "launch: the Postgres container never became ready" >&2; return 1; }
      sleep 1
    done
  else
    local bin
    bin="$(pg_bindir)" || {
      echo "launch: no Docker daemon and no Postgres server binaries (initdb, pg_ctl) found" >&2
      return 1
    }
    command -v psql >/dev/null 2>&1 || {
      echo "launch: local Postgres needs the psql client on PATH" >&2
      return 1
    }
    rm -rf "$RUN/pg"
    mkdir -p "$RUN/pg"
    [ "$(id -u)" = "0" ] && chown postgres "$RUN/pg"
    as_pg_user "$bin/initdb" -D "$RUN/pg/data" -U callisto --auth=trust >"$RUN/pg-init.log" 2>&1 || {
      echo "launch: initdb failed; see $RUN/pg-init.log" >&2
      return 1
    }
    # Recorded before starting, so cleanup.sh can stop a server that started
    # but failed a later step.
    echo local >"$RUN/pg-mode"
    echo "$bin" >"$RUN/pg-bindir"
    as_pg_user "$bin/pg_ctl" -D "$RUN/pg/data" -l "$RUN/pg/server.log" -w \
      -o "-p $PG_PORT -k $RUN/pg -c listen_addresses=127.0.0.1" start >/dev/null || {
      echo "launch: Postgres did not start; see $RUN/pg/server.log" >&2
      return 1
    }
    printf '["psql","-h","127.0.0.1","-p","%s","-U","callisto","-d","callisto"]\n' "$PG_PORT" >"$RUN/psql.json"
    psql -X -q -h 127.0.0.1 -p "$PG_PORT" -U callisto -d postgres -c "CREATE DATABASE callisto" >/dev/null || return 1
  fi
  echo "postgresql://callisto:callisto@127.0.0.1:$PG_PORT/callisto?sslmode=disable&search_path=public" >"$RUN/db-url"
}

# psql against the throwaway database, as recorded by pg_start.
pg_psql() {
  local mode
  mode="$(cat "$RUN/pg-mode")"
  if [ "$mode" = docker ]; then
    docker exec -i "$PG_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U callisto -d callisto "$@"
  else
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U callisto -d callisto "$@"
  fi
}

pg_stop() {
  [ -f "$RUN/pg-mode" ] || return 0
  if [ "$(cat "$RUN/pg-mode")" = docker ]; then
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  elif [ -d "$RUN/pg/data" ]; then
    as_pg_user "$(cat "$RUN/pg-bindir")/pg_ctl" -D "$RUN/pg/data" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -f "$RUN/pg-mode" "$RUN/psql.json" "$RUN/db-url" "$RUN/pg-bindir"
}
