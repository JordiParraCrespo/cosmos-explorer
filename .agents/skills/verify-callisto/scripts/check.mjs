#!/usr/bin/env node
// Check what Callisto indexed against the chain itself.
//
//   node .agents/skills/verify-callisto/scripts/check.mjs                 # the window, then N live blocks
//   node .agents/skills/verify-callisto/scripts/check.mjs --follow 30     # wait for 30 blocks past the launch head
//   node .agents/skills/verify-callisto/scripts/check.mjs --no-wait       # check what is there now
//
// It waits until every height from the window's start to the launch head
// plus --follow (default 10) is in the database, then compares each block,
// transaction and message with the node's RPC, reads Callisto's log for
// errors, and checks that each enabled module wrote its tables. One line per
// check; exit 1 when any fails. Evidence goes to .verify-callisto/evidence/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUN,
  STATE,
  bech32,
  getJson,
  normalizeTs,
  pool,
  processAlive,
  readLaunch,
  sql,
  txHash,
} from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const follow = Number(flag("--follow", 10));
const noWait = args.includes("--no-wait");
if (!Number.isInteger(follow) || follow < 1) {
  console.error("check: --follow must be at least 1, so the run proves Callisto keeps up with new blocks");
  process.exit(2);
}

const launch = readLaunch();
const target = launch.headAtLaunch + follow;
const want = Array.from({ length: target - launch.start + 1 }, (_, i) => launch.start + i);
// CometBFT encodes an empty slice as either [] or null.
const txsOf = (block) => block.block.data.txs ?? [];
const pid = existsSync(join(RUN, "pid")) ? Number(readFileSync(join(RUN, "pid"), "utf8")) : 0;

// --- Wait for the window ------------------------------------------------------

// Juno saves a block's row before its commits, handlers, transactions and
// messages, so a block row alone does not mean the block is done. The range is
// complete when every height has a row, every block has as many transaction
// rows as its num_txs, and every transaction as many message rows as messages.
function progress() {
  const range = `BETWEEN ${launch.start} AND ${target}`;
  const [[blocks, txsExpected]] = sql(`SELECT count(*), coalesce(sum(num_txs), 0) FROM block WHERE height ${range}`);
  const [[txs, msgsExpected]] = sql(
    `SELECT count(*), coalesce(sum(json_array_length(messages)), 0) FROM transaction WHERE height ${range}`,
  );
  const [[msgs]] = sql(`SELECT count(*) FROM message WHERE height ${range}`);
  const n = (v) => Number(v);
  return {
    blocks: n(blocks),
    done: n(blocks) >= want.length && n(txs) >= n(txsExpected) && n(msgs) >= n(msgsExpected),
    summary: `${blocks}/${want.length} blocks, ${txs}/${txsExpected} transactions, ${msgs}/${msgsExpected} messages`,
  };
}

if (!noWait) {
  const timeoutS = Number(flag("--timeout", Math.max(300, Math.ceil(want.length * launch.avgBlockTimeSeconds * 3))));
  const deadline = Date.now() + timeoutS * 1000;
  let last = "";
  for (;;) {
    const p = progress();
    if (p.summary !== last) console.log(`check: ${p.summary} indexed (${launch.start}..${target})`);
    last = p.summary;
    if (p.done) break;
    if (pid && !processAlive(pid)) {
      console.log("check: callisto has exited; checking what it indexed");
      break;
    }
    if (Date.now() > deadline) {
      console.log(`check: gave up waiting after ${timeoutS}s; checking what is there`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// --- Gather both sides ------------------------------------------------------

const results = [];
const record = (name, failures, okDetail, { warnOnly = false } = {}) => {
  const level = failures.length === 0 ? "PASS" : warnOnly ? "WARN" : "FAIL";
  results.push({ name, level, detail: failures.length ? `${failures.length} problem(s)` : okDetail, failures });
};

const dbBlocks = new Map(
  sql(
    `SELECT height, hash, num_txs, total_gas, coalesce(proposer_address, ''), timestamp FROM block
     WHERE height BETWEEN ${launch.start} AND ${target}`,
  ).map(([h, hash, numTxs, totalGas, proposer, ts]) => [
    Number(h),
    { hash, numTxs: Number(numTxs), totalGas: Number(totalGas), proposer, ts },
  ]),
);
const dbTxs = new Map(); // height -> Map(hash -> row)
for (const [hash, h, success, wanted, used, nMsgs] of sql(
  `SELECT hash, height, success, gas_wanted, gas_used, json_array_length(messages) FROM transaction
   WHERE height BETWEEN ${launch.start} AND ${target}`,
)) {
  if (!dbTxs.has(Number(h))) dbTxs.set(Number(h), new Map());
  dbTxs.get(Number(h)).set(hash, { success: success === "t", wanted: Number(wanted), used: Number(used), nMsgs: Number(nMsgs) });
}
const dbMsgCount = new Map(
  sql(
    `SELECT transaction_hash, count(*) FROM message WHERE height BETWEEN ${launch.start} AND ${target}
     GROUP BY transaction_hash`,
  ).map(([hash, n]) => [hash, Number(n)]),
);

const present = want.filter((h) => dbBlocks.has(h));
console.log(`check: comparing ${present.length} indexed blocks with ${launch.rpc}`);
const chain = new Map();
await pool(present, 4, async (h) => {
  const [block, res] = await Promise.all([
    getJson(`${launch.rpc}/block?height=${h}`),
    getJson(`${launch.rpc}/block_results?height=${h}`),
  ]);
  chain.set(h, { block: block.result, results: res.result.txs_results ?? [] });
});

// --- Coverage ---------------------------------------------------------------

const missing = want.filter((h) => !dbBlocks.has(h));
record(
  "coverage",
  missing.length ? [`missing ${missing.length} of ${want.length} heights, first ${missing.slice(0, 5).join(", ")}`] : [],
  `all ${want.length} heights ${launch.start}..${target}`,
);
const maxIndexed = Math.max(0, ...dbBlocks.keys());
record(
  "follows the chain",
  maxIndexed > launch.headAtLaunch ? [] : [`nothing past the launch head ${launch.headAtLaunch} (max ${maxIndexed})`],
  `indexed up to ${maxIndexed}, ${maxIndexed - launch.headAtLaunch} past the launch head`,
);

// --- Blocks -----------------------------------------------------------------

const blockFailures = [];
for (const h of present) {
  const db = dbBlocks.get(h);
  const { block, results: txr } = chain.get(h);
  const header = block.block.header;
  const proposer = bech32(`${launch.bech32Prefix}valcons`, header.proposer_address);
  const totalGas = txr.reduce((sum, r) => sum + Number(r.gas_used ?? 0), 0);
  const diffs = [];
  if (db.hash !== block.block_id.hash) diffs.push(`hash ${db.hash} != ${block.block_id.hash}`);
  if (db.numTxs !== txsOf(block).length) diffs.push(`num_txs ${db.numTxs} != ${txsOf(block).length}`);
  if (db.proposer !== proposer) diffs.push(`proposer ${db.proposer || "(none)"} != ${proposer}`);
  if (normalizeTs(db.ts) !== normalizeTs(header.time)) diffs.push(`timestamp ${db.ts} != ${header.time}`);
  if (db.totalGas !== totalGas) diffs.push(`total_gas ${db.totalGas} != ${totalGas}`);
  if (diffs.length) blockFailures.push(`${h}: ${diffs.join("; ")}`);
}
record("blocks match the chain", blockFailures, `hash, tx count, proposer, time and gas of ${present.length} blocks`);

// --- Transactions and messages ----------------------------------------------

const txFailures = [];
const msgFailures = [];
let txTotal = 0;
for (const h of present) {
  const { block, results: txr } = chain.get(h);
  const rows = dbTxs.get(h) ?? new Map();
  const hashes = txsOf(block).map(txHash);
  txTotal += hashes.length;
  hashes.forEach((hash, i) => {
    const row = rows.get(hash);
    if (!row) return txFailures.push(`${h}: ${hash} is not in the database`);
    const r = txr[i] ?? {};
    const success = (r.code ?? 0) === 0;
    const diffs = [];
    if (row.success !== success) diffs.push(`success ${row.success} != ${success} (code ${r.code ?? 0})`);
    if (row.wanted !== Number(r.gas_wanted ?? 0)) diffs.push(`gas_wanted ${row.wanted} != ${r.gas_wanted}`);
    if (row.used !== Number(r.gas_used ?? 0)) diffs.push(`gas_used ${row.used} != ${r.gas_used}`);
    if (diffs.length) txFailures.push(`${h} ${hash}: ${diffs.join("; ")}`);
    const stored = dbMsgCount.get(hash) ?? 0;
    if (stored !== row.nMsgs) msgFailures.push(`${h} ${hash}: ${stored} message rows for ${row.nMsgs} messages`);
  });
  for (const hash of rows.keys())
    if (!hashes.includes(hash)) txFailures.push(`${h}: ${hash} is in the database but not in the block`);
}
record("transactions match the chain", txFailures, `${txTotal} transactions: hash, success and gas`);
record("every message stored", msgFailures, "one message row per message in each transaction");

const types = sql(
  `SELECT type, count(*) FROM message WHERE height BETWEEN ${launch.start} AND ${target} GROUP BY type ORDER BY 2 DESC`,
).map(([type, n]) => ({ type, count: Number(n) }));

// --- Callisto's own errors --------------------------------------------------

const logLines = existsSync(join(RUN, "callisto.log")) ? readFileSync(join(RUN, "callisto.log"), "utf8").split("\n") : [];
const handlerErrors = new Map();
const retried = new Map();
const otherErrors = new Map();
// Errors logged before launch.sh saw the first block of the window. On a fresh
// database Callisto's periodic jobs run once at startup and its first staking
// update runs on an empty validator table; both log errors on main as well.
// They are reported but do not fail the run. Without a first-block time, or
// for a line without a time, every error counts.
const startupErrors = new Map();
const firstBlockAt = existsSync(join(RUN, "first-block-at"))
  ? Date.parse(readFileSync(join(RUN, "first-block-at"), "utf8").trim())
  : Number.NaN;
const beforeFirstBlock = (e) => {
  const t = Date.parse(e.time ?? "");
  return Number.isFinite(firstBlockAt) && Number.isFinite(t) && t <= firstBlockAt;
};
const bump = (map, key, example) => {
  const e = map.get(key) ?? { count: 0, example };
  e.count += 1;
  map.set(key, e);
};
for (const line of logLines) {
  if (/^panic:/.test(line)) bump(otherErrors, "panic", line);
  if (!line.startsWith("{")) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e.level !== "error" && e.level !== "fatal") continue;
  const err = String(e.err ?? e.error ?? "").slice(0, 160);
  if (beforeFirstBlock(e)) bump(startupErrors, `${e.message ?? "(no message)"}: ${err}`, line);
  else if (String(e.message ?? "").startsWith("error while handling"))
    bump(handlerErrors, `${e.message} [module ${e.module ?? "?"}${e.msg_type ? `, ${e.msg_type}` : ""}]: ${err}`, line);
  else if (e.message === "re-enqueueing failed block") bump(retried, `height ${e.height}: ${err}`, line);
  else bump(otherErrors, `${e.message ?? "(no message)"}: ${err}`, line);
}
const fmt = (map) => [...map].map(([k, v]) => `${v.count}x ${k}`);
record("no handler errors", fmt(handlerErrors), "no module failed on a block, transaction or message");
record("no other errors", fmt(otherErrors), "no periodic job or panic errors after the first block");
record("no startup errors", fmt(startupErrors), "nothing logged before the first block", { warnOnly: true });
// A retried block that was then indexed is a transient fetch failure; one
// that never made it shows up under coverage.
record("no retried blocks", fmt(retried), "no block needed a retry", { warnOnly: true });

// --- Module tables ----------------------------------------------------------

// Tables each module writes on every block, from genesis, or on a periodic
// job that runs once at start. A short run must leave rows in each.
const MODULE_TABLES = {
  consensus: launch.parseGenesis ? ["genesis", "average_block_time_from_genesis"] : [],
  staking: ["validator_info", "validator_status", "validator_voting_power", "staking_pool"],
  slashing: ["validator_signing_info"],
  bank: ["supply"],
};
const tableFailures = [];
const tableCounts = {};
for (const mod of launch.modules) {
  for (const table of MODULE_TABLES[mod] ?? []) {
    const n = Number(sql(`SELECT count(*) FROM ${table}`)[0][0]);
    tableCounts[table] = n;
    if (n === 0) tableFailures.push(`${mod}: ${table} is empty`);
  }
}
tableCounts.validator = Number(sql("SELECT count(*) FROM validator")[0][0]);
tableCounts.pre_commit = Number(sql(`SELECT count(*) FROM pre_commit WHERE height >= ${launch.start}`)[0][0]);
if (tableCounts.validator === 0) tableFailures.push("validator is empty");
if (tableCounts.pre_commit === 0) tableFailures.push("no pre_commit rows in the window");
record("module tables written", tableFailures, Object.entries(tableCounts).map(([t, n]) => `${t} ${n}`).join(", "));

// --- Report -----------------------------------------------------------------

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = join(STATE, "evidence", `${stamp}-${launch.network}`);
mkdirSync(evidence, { recursive: true });
for (const f of ["callisto.log", "launch.json", "commit"]) if (existsSync(join(RUN, f))) copyFileSync(join(RUN, f), join(evidence, f));
if (existsSync(join(RUN, "home", "config.yaml"))) copyFileSync(join(RUN, "home", "config.yaml"), join(evidence, "config.yaml"));
const report = {
  network: launch.network,
  chainId: launch.chainId,
  commit: existsSync(join(RUN, "commit")) ? readFileSync(join(RUN, "commit"), "utf8").trim() : null,
  window: { start: launch.start, headAtLaunch: launch.headAtLaunch, target, maxIndexed },
  messageTypes: types,
  checks: results,
};
writeFileSync(join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const r of results) {
  console.log(`${r.level.padEnd(4)} ${r.name}: ${r.detail}`);
  for (const f of r.failures.slice(0, 5)) console.log(`       ${f}`);
  if (r.failures.length > 5) console.log(`       ... ${r.failures.length - 5} more in report.json`);
}
console.log(`message types: ${types.map((t) => `${t.type} ${t.count}`).join(", ") || "none in the window"}`);
console.log(`evidence: ${evidence}`);
process.exit(results.some((r) => r.level === "FAIL") ? 1 : 0);
