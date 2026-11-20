---
name: verify-callisto
description: Prove the Callisto indexer works by building it as the image does, running it against a real network (testnet or mainnet) on a throwaway Postgres from a little behind the chain head, letting it follow new blocks, and checking every indexed block, transaction and message against the chain's own RPC, its log for errors, and its module tables. Use it after any change to apps/callisto, packages/juno, their Go dependencies or toolchain, the network configs in apps/callisto/configs, or the Docker images, before opening or updating a pull request, and whenever asked to run Callisto and show it indexing.
---

# Verify Callisto

Callisto indexes a Cosmos chain into Postgres: Juno fetches each block over
the node's RPC (HTTP plus a WebSocket subscription for new blocks) and its
transactions over the REST API, and Callisto's modules query chain state
over gRPC. This skill runs it the way production does, against a real
network's public endpoints, and checks the result against the chain itself.
It cannot change the chain. It does not cover the explorer
(`verify-explorer` does) or Hasura's metadata.

## Why a recent window

The public nodes are pruned (testnet keeps blocks from about 4.1M, mainnet
from about 3.2M, while their heads are in the millions above), so genesis
to head is not possible against them, and would take days anyway. Instead
the run starts `--blocks` (default 50) behind the head, indexes up to it,
then keeps following the chain for `--follow` (default 10) new blocks. That
exercises both of Juno's paths, catching up on old blocks and reacting to
new ones, on today's real traffic, with today's message types. Genesis is
still parsed when the network's config asks for it (`parse_genesis: true`
in both), because the consensus module needs it.

What a window cannot prove: messages that did not happen in it. Testnet
traffic is mostly `MsgEthereumTx`; a change to how a rarer message is
decoded (gov, staking, PoA, IBC) needs a window that contains one. The
report lists the message types the window saw; say which ones the change
touches and whether they were seen.

Everything below is a script in `scripts/`. Run each one from the repo root
as written.

## 1. Launch

```bash
.agents/skills/verify-callisto/scripts/launch.sh testnet
```

It builds `apps/callisto` with `make build` (as `docker/callisto.Dockerfile`
does), starts a throwaway Postgres on `127.0.0.1:6544` and applies
`apps/callisto/database/schema/*.sql`, then renders the run's config from
`apps/callisto/configs/<network>-config.yaml`. Only what must differ from
production changes: the start height, the database URL, the actions port
(`3998`) and JSON logs at info level. Endpoints, modules, workers, genesis
parsing and the EVM chain id are the network's own, so the run tests the
config production ships. Ready means the first block of the window is in
the database.

Options: `--blocks N` sets the window, `--no-build` reuses
`apps/callisto/build/callisto` (never after changing source).
`VERIFY_CALLISTO_PG_PORT` and `VERIFY_CALLISTO_ACTIONS_PORT` move the ports.
Postgres runs in Docker (`postgres:17`, as `docker-compose.yml`) when a
daemon answers, otherwise from local server binaries (`initdb`, `pg_ctl`
and `psql` on PATH or in the usual install places).

Test the network a change is aimed at. With no reason to prefer one, use
testnet: it has live traffic and is nobody's production. One instance per
checkout; launch refuses a second one and ports something else holds.

## 2. Doctor

```bash
node .agents/skills/verify-callisto/scripts/doctor.mjs
```

A read-only check that the instance is worth checking: the recorded process
is alive and is this skill's callisto, the RPC serves the chain id the
network's explorer config names, the config's `evm.chain_id` is what the
network's EVM JSON-RPC reports, the node still keeps the window's blocks,
the database answers and has blocks from the window, and the log has no
fatal lines. Exit 1 means do not check; fix the cause or relaunch.

## 3. Check

```bash
node .agents/skills/verify-callisto/scripts/check.mjs
node .agents/skills/verify-callisto/scripts/check.mjs --follow 30   # follow longer
```

It waits until every height from the window's start to the launch head
plus `--follow` is indexed (or the timeout, `--timeout` seconds), then
prints one line per check and exits 1 when any fails:

- **coverage**: no height in the range is missing.
- **follows the chain**: blocks past the launch head were indexed, so the
  live subscription works, not only catching up.
- **blocks match the chain**: hash, transaction count, proposer (as
  `<prefix>valcons`), timestamp and total gas of every block, against the
  RPC's `/block` and `/block_results`.
- **transactions match the chain**: the set of transactions in each block
  (hashes from the raw block), and each one's success and gas.
- **every message stored**: one `message` row per message in each
  transaction, which is where a decoding failure shows.
- **no handler errors**: no module logged `error while handling` a block,
  transaction or message, grouped by module and message type.
- **no other errors**: no periodic job error or panic after the first block.
- **no startup errors** (warning only): errors logged before launch saw the
  first block of the window. On a fresh database Callisto logs a few, on
  `main` as well: its consensus jobs run once at startup and find no block
  (`no blocks saved`), and its first staking update runs on an empty
  validator table. They are listed in the report but do not fail the run
  until Callisto is fixed. The cut-off is launch's first sight of a block,
  so an error within about a second of it can land on either side; an
  error without a `time` field always counts.
- **no retried blocks** (warning only): a block Juno had to re-enqueue,
  usually a rate-limited fetch; one that never made it fails coverage.
- **module tables written**: each enabled module wrote the tables it
  fills on every block, from genesis or on its first periodic run.

## 4. Evidence

Every check writes `.verify-callisto/evidence/<time>-<network>/`
(git-ignored): `report.json` with each check, its failures and the message
types the window saw, plus the run's `callisto.log`, `config.yaml`,
`launch.json` and the commit it built. Name the folder in the pull request.

## 5. Cleanup

```bash
.agents/skills/verify-callisto/scripts/cleanup.sh
```

Stops callisto by the pid launch recorded (only after checking that pid
still is this skill's callisto) and removes the throwaway Postgres. Evidence
is kept. Run it after the last check, and after a failed launch too.

## Reporting

Say which network, the window, which checks passed, which failed and why,
the message types seen, the evidence folder, and anything not checked. A
failure is one of three things, and the report says which:

- **Callisto is wrong**: a missing height, a mismatch with the chain, a
  handler error. That is the finding; do not weaken the check to pass.
- **This skill is wrong**: a check that no longer matches a Callisto that
  behaves correctly (a module that stopped writing a table on purpose, a
  log line that is not an error). Fix the skill in the same change, then
  check again.
- **The environment is wrong**: the endpoints are unreachable, rate-limit
  or refuse the connection. Callisto needs the RPC over HTTPS and
  WebSocket and the gRPC endpoint over HTTP/2; a proxy that allows only
  plain HTTPS stops it at `ERROR: failed to start client: Forbidden`. Say
  what was missing; it is not a pass.

## Requirements

Go as in `apps/callisto/go.mod`, Node 22+, Docker or local Postgres
binaries with `psql`, and network access to the network's RPC (HTTPS and
WebSocket), REST API and gRPC endpoints named in its config, plus its EVM
JSON-RPC for the doctor.

## Changing this skill

Run its evals after any change here:

```bash
node --test .agents/skills/verify-callisto/evals/scripts.test.mjs
```

They run the scripts against a fake RPC and EVM JSON-RPC and a real
throwaway Postgres with Callisto's schema, and show each check failing for
its own reason beside a control that passes. They do not start callisto.
