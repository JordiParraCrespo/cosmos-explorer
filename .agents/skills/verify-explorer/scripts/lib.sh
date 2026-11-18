# Shared by launch.sh and cleanup.sh (sourced, not run).

# True when pid $1 is alive and is the explorer server launch.sh starts: Next
# renames its process "next-server", and its command line runs
# apps/explorer/server.js. A recorded pid can outlive its server (a reboot,
# a crash) and be reused by an unrelated process, which must never be
# signalled or mistaken for ours.
is_our_server() {
  local pid="$1" cmd
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$cmd" in
    *next-server* | *apps/explorer/server.js*) return 0 ;;
    *) return 1 ;;
  esac
}

# True when the build in $3/.next is the one launch.sh last made for network
# $1, as recorded in run dir $2: same network and same BUILD_ID. Anything
# that rebuilt .next since (another network, a manual `pnpm build`) changes
# the BUILD_ID, so the build is not reused under the old network's name.
reusable_build() {
  local network="$1" run="$2" app="$3"
  [ -f "$app/.next/standalone/apps/explorer/server.js" ] || return 1
  [ "$(cat "$run/build-network" 2>/dev/null)" = "$network" ] || return 1
  [ -n "$(cat "$run/build-id" 2>/dev/null)" ] || return 1
  [ "$(cat "$run/build-id")" = "$(cat "$app/.next/BUILD_ID" 2>/dev/null)" ]
}
