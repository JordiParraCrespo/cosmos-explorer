#!/usr/bin/env node
// Read-only check that the running instance is worth checking: it is the
// callisto launch.sh started, it talks to the network it claims, its config
// matches that chain, and it is indexing. Exit 1 means do not run check.mjs;
// fix the cause or relaunch.
//
//   node .agents/skills/verify-callisto/scripts/doctor.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUN, network, postJson, processAlive, readLaunch, rpcStatus, sql } from "./lib.mjs";

const results = [];
const ok = (name, detail) => results.push({ level: "ok", name, detail });
const warn = (name, detail) => results.push({ level: "warn", name, detail });
const fail = (name, detail) => results.push({ level: "FAIL", name, detail });

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) fail("node", `Node ${process.versions.node}; the repo needs 22+`);

  let launch;
  try {
    launch = readLaunch();
  } catch (err) {
    fail("launch", err.message);
    return;
  }
  const net = network(launch.network);

  // The process is ours and still running.
  const pid = existsSync(join(RUN, "pid")) ? Number(readFileSync(join(RUN, "pid"), "utf8")) : 0;
  let cmd = "";
  try {
    cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
  } catch {}
  if (!pid || !processAlive(pid)) fail("process", `callisto (pid ${pid || "none"}) is not running; see ${RUN}/callisto.log`);
  else if (!cmd.includes(`callisto start --home ${RUN}/home`)) fail("process", `pid ${pid} is not this skill's callisto: ${cmd}`);
  else ok("process", `pid ${pid}`);

  // The RPC is the chain the network's explorer config names.
  let status;
  try {
    status = await rpcStatus(launch.rpc);
    const expected = JSON.parse(readFileSync(net.explorerConfig, "utf8")).network.chainId;
    if (status.chainId !== expected) fail("chain id", `${launch.rpc} serves ${status.chainId}, ${launch.network} is ${expected}`);
    else ok("chain id", status.chainId);
    if (status.catchingUp) warn("rpc", `${launch.rpc} is still catching up`);
  } catch (err) {
    fail("rpc", err.message);
  }

  // The config's EVM chain id is the one the chain reports.
  try {
    const res = await postJson(net.evmRpc, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const chainEvm = Number.parseInt(res.result, 16);
    if (chainEvm !== launch.evmChainId)
      fail("evm chain id", `${launch.sourceConfig} has evm.chain_id ${launch.evmChainId}, ${net.evmRpc} reports ${chainEvm}`);
    else ok("evm chain id", String(chainEvm));
  } catch (err) {
    warn("evm chain id", `could not ask ${net.evmRpc}: ${err.message}`);
  }

  // The window is still on the node (it prunes old blocks).
  if (status && launch.start < status.earliest)
    fail("pruning", `the node now keeps blocks from ${status.earliest}, after the window's start ${launch.start}; relaunch`);

  // The database answers and the indexer is moving.
  try {
    const [[count, max]] = sql(`SELECT count(*), coalesce(max(height), 0) FROM block WHERE height >= ${launch.start}`);
    if (Number(count) === 0) fail("indexing", `no block from ${launch.start} on yet`);
    else ok("indexing", `${count} blocks, up to ${max}`);
    if (status && Number(max) > 0) {
      const lag = status.latest - Number(max);
      if (lag > 100) warn("lag", `${lag} blocks behind the head ${status.latest}`);
    }
  } catch (err) {
    fail("database", err.message.split("\n")[0]);
  }

  // Fatal output: a crash or a dropped connection.
  const log = existsSync(join(RUN, "callisto.log")) ? readFileSync(join(RUN, "callisto.log"), "utf8") : "";
  const fatal = log.split("\n").filter((l) => /^panic:|"level":"fatal"|^ERROR:/.test(l));
  if (fatal.length) fail("log", fatal.slice(0, 3).join(" | "));
  else ok("log", "no fatal lines");
}

await main();
for (const r of results) console.log(`${r.level.padEnd(4)} ${r.name}: ${r.detail}`);
process.exit(results.some((r) => r.level === "FAIL") ? 1 : 0);
