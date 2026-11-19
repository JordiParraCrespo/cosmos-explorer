// Evals for verify-callisto's scripts. They run check.mjs, doctor.mjs and
// render-config.mjs against a fake CometBFT RPC / EVM JSON-RPC and a real
// throwaway Postgres loaded with apps/callisto/database/schema, and show each
// check failing for its own reason beside a control that passes.
//
//   node --test .agents/skills/verify-callisto/evals/scripts.test.mjs
//
// Needs Docker or local Postgres server binaries, as launch.sh does. It does
// not start callisto: the live run needs a network that allows WebSocket and
// gRPC, and is what SKILL.md describes.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { bech32, normalizeTs, txHash, yamlGet, yamlModules, yamlSet } from "../scripts/lib.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(SKILL, "scripts");
const ROOT = resolve(SKILL, "../../..");
const PG_PORT = process.env.VERIFY_CALLISTO_EVAL_PG_PORT || "6599";

const STATE = mkdtempSync(join(tmpdir(), "verify-callisto-eval-"));
const RUN = join(STATE, "run");
mkdirSync(RUN, { recursive: true });
// Local Postgres runs as the postgres user when we are root; let it reach RUN.
chmodSync(STATE, 0o755);
chmodSync(RUN, 0o755);

const shellEnv = { ...process.env, ROOT, STATE, RUN, VERIFY_CALLISTO_PG_PORT: PG_PORT };
const sh = (script) => execFileSync("bash", ["-c", `. "${SCRIPTS}/lib.sh"; ${script}`], { env: shellEnv, encoding: "utf8" });
const psql = (query) => sh(`pg_psql -At -c ${JSON.stringify(query)}`);

// --- A small consistent chain -------------------------------------------------

const START = 1000;
const HEAD = 1007; // the head at launch
const FOLLOW = 2;
const TARGET = HEAD + FOLLOW;
const PROPOSER_HEX = "2E24CAA54D7E267E7CB01870538E5511BB9A135E";
const PROPOSER = bech32("ethmvalcons", PROPOSER_HEX);
const MSG_TYPE = "/cosmos.bank.v1beta1.MsgSend";

function makeChain() {
  const blocks = new Map();
  for (let h = START; h <= TARGET + 5; h++) {
    const txs = h === 1003 ? 2 : h === 1006 ? 1 : 0;
    const raw = Array.from({ length: txs }, (_, i) => Buffer.from(`tx-${h}-${i}`).toString("base64"));
    blocks.set(h, {
      hash: createHash("sha256").update(`block-${h}`).digest("hex").toUpperCase(),
      time: `2026-11-19T10:00:${String(h - START).padStart(2, "0")}.123456789Z`,
      txs: raw,
      // The second tx in 1003 failed on chain.
      results: raw.map((_, i) => ({ code: h === 1003 && i === 1 ? 5 : 0, gas_wanted: "200000", gas_used: String(100000 + i) })),
    });
  }
  return { chainId: "xrplevm_1449000-1", latest: TARGET + 5, earliest: 900, evmChainId: "0x161c28", blocks };
}
let chain = makeChain();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (body) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "POST") return send({ jsonrpc: "2.0", id: 1, result: chain.evmChainId });
  const h = Number(url.searchParams.get("height"));
  const b = chain.blocks.get(h);
  if (url.pathname === "/status")
    return send({
      result: {
        node_info: { network: chain.chainId },
        sync_info: { latest_block_height: String(chain.latest), earliest_block_height: String(chain.earliest), catching_up: false },
      },
    });
  if (url.pathname === "/block" && b)
    return send({
      result: {
        block_id: { hash: b.hash },
        block: { header: { height: String(h), time: b.time, proposer_address: PROPOSER_HEX }, data: { txs: b.txs } },
      },
    });
  if (url.pathname === "/block_results" && b) return send({ result: { height: String(h), txs_results: b.results.length ? b.results : null } });
  res.writeHead(404);
  res.end("{}");
});

// --- Database fixture -------------------------------------------------------------

const TABLES =
  "message, transaction, pre_commit, validator_info, validator_status, validator_voting_power, " +
  "validator_signing_info, staking_pool, supply, genesis, average_block_time_from_genesis, message_type, block, account, validator";

function seed() {
  const q = ["SET client_min_messages = warning;", `TRUNCATE ${TABLES} CASCADE;`];
  q.push(`INSERT INTO validator VALUES ('${PROPOSER}', 'pubkey');`);
  q.push(`INSERT INTO message_type VALUES ('${MSG_TYPE}', 'bank', 'MsgSend', ${START});`);
  for (let h = START; h <= TARGET; h++) {
    const b = chain.blocks.get(h);
    const gas = b.results.reduce((s, r) => s + Number(r.gas_used), 0);
    q.push(
      `INSERT INTO block VALUES (${h}, '${b.hash}', ${b.txs.length}, ${gas}, '${PROPOSER}', '${b.time.replace("T", " ").replace("Z", "")}');`,
    );
    q.push(`INSERT INTO pre_commit VALUES ('${PROPOSER}', ${h}, '${b.time.replace("Z", "")}', 10, 0);`);
    b.txs.forEach((raw, i) => {
      const hash = txHash(raw);
      const r = b.results[i];
      q.push(
        `INSERT INTO transaction (hash, height, success, messages, signatures, gas_wanted, gas_used, partition_id)
         VALUES ('${hash}', ${h}, ${r.code === 0}, '[{"@type":"${MSG_TYPE}"}]', '{}', ${r.gas_wanted}, ${r.gas_used}, 0);`,
      );
      q.push(`INSERT INTO message VALUES ('${hash}', 0, '${MSG_TYPE}', '{}', '{}', 0, ${h});`);
    });
  }
  q.push(`INSERT INTO genesis (chain_id, time, initial_height) VALUES ('${chain.chainId}', '2025-01-01', 1);`);
  q.push(`INSERT INTO average_block_time_from_genesis (average_time, height) VALUES (1.7, ${TARGET});`);
  q.push(`INSERT INTO validator_info VALUES ('${PROPOSER}', 'ethmvaloper1x', NULL, '0.01', '0.2', ${TARGET});`);
  q.push(`INSERT INTO validator_status VALUES ('${PROPOSER}', 3, false, false, ${TARGET});`);
  q.push(`INSERT INTO validator_voting_power VALUES ('${PROPOSER}', 10, ${TARGET});`);
  q.push(`INSERT INTO staking_pool (bonded_tokens, not_bonded_tokens, unbonding_tokens, staked_not_bonded_tokens, height) VALUES ('1','0','0','0', ${TARGET});`);
  q.push(`INSERT INTO validator_signing_info VALUES ('${PROPOSER}', 1, 0, '1970-01-01', false, 0, ${TARGET});`);
  q.push(`INSERT INTO supply (coins, height) VALUES (ARRAY[]::COIN[], ${TARGET});`);
  sh(`pg_psql <<'SQL'\n${q.join("\n")}\nSQL`);
}

function writeLaunch(overrides = {}) {
  const launch = {
    network: "testnet",
    sourceConfig: "fixture",
    rpc: `http://127.0.0.1:${server.address().port}`,
    evmRpc: `http://127.0.0.1:${server.address().port}`,
    evmChainId: 1449000,
    bech32Prefix: "ethm",
    modules: ["modules", "messages", "bank", "consensus", "slashing", "staking"],
    parseGenesis: true,
    avgBlockTimeSeconds: 1,
    chainId: chain.chainId,
    headAtLaunch: HEAD,
    earliestAvailable: chain.earliest,
    start: START,
    blocks: HEAD - START + 1,
    ...overrides,
  };
  writeFileSync(join(RUN, "launch.json"), JSON.stringify(launch));
}

const LOG_OK = '{"level":"info","message":"processed block","height":1001}\n';

// Async on purpose: the fake RPC server runs in this process, so a blocking
// spawnSync would leave it unable to answer the script under test.
function run(script, args = [], extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [join(SCRIPTS, script), ...args], {
      env: { ...process.env, VERIFY_CALLISTO_DIR: STATE, ...extraEnv },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${script} timed out:\n${out}`));
    }, 60000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out });
    });
  });
}
const check = (args = []) => run("check.mjs", ["--no-wait", "--follow", String(FOLLOW), ...args]);
const lineOf = (out, name) => out.split("\n").find((l) => l.includes(` ${name}:`)) ?? "";

// --- Lifecycle -----------------------------------------------------------------------

before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // Never reuse a server a crashed earlier run left behind.
  const busy = spawnSync("bash", ["-c", `(exec 3<>/dev/tcp/127.0.0.1/${PG_PORT}) 2>/dev/null`]).status === 0;
  if (busy) throw new Error(`port ${PG_PORT} is in use; stop what holds it or set VERIFY_CALLISTO_EVAL_PG_PORT`);
  sh("pg_start");
  for (const f of readdirSync(join(ROOT, "apps/callisto/database/schema")).sort())
    sh(`pg_psql < "${join(ROOT, "apps/callisto/database/schema", f)}" >/dev/null`);
  sh(`pg_psql -c "CREATE TABLE transaction_0 PARTITION OF transaction FOR VALUES IN (0); CREATE TABLE message_0 PARTITION OF message FOR VALUES IN (0);"`);
});

after(() => {
  try {
    sh("pg_stop");
  } finally {
    server.close();
    rmSync(STATE, { recursive: true, force: true });
  }
});

beforeEach(() => {
  chain = makeChain();
  seed();
  writeLaunch();
  writeFileSync(join(RUN, "callisto.log"), LOG_OK);
  rmSync(join(RUN, "pid"), { force: true });
});

// --- check.mjs -----------------------------------------------------------------------

describe("check.mjs", () => {
  test("control: a faithful index passes every check", async () => {
    const r = await check();
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /^(FAIL|WARN)/m);
    assert.match(r.out, /PASS coverage: all 10 heights 1000\.\.1009/);
    assert.match(r.out, /transactions match the chain: 3 transactions/);
    assert.match(r.out, new RegExp(`message types: ${MSG_TYPE.replace(/\./g, "\\.")} 3`));
    const evidence = r.out.match(/evidence: (.+)/)[1];
    const report = JSON.parse(readFileSync(join(evidence, "report.json"), "utf8"));
    assert.equal(report.window.target, TARGET);
  });

  test("a missing height fails coverage", async () => {
    psql("DELETE FROM pre_commit WHERE height = 1004; DELETE FROM block WHERE height = 1004;");
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "coverage"), /^FAIL/);
    assert.match(r.out, /missing 1 of 10 heights, first 1004/);
  });

  test("an index that stops at the launch head fails 'follows the chain'", async () => {
    psql(`DELETE FROM pre_commit WHERE height > ${HEAD}; DELETE FROM validator_voting_power; DELETE FROM block WHERE height > ${HEAD};`);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "follows the chain"), /^FAIL/);
  });

  test("a block hash that differs from the chain fails", async () => {
    chain.blocks.get(1002).hash = "F".repeat(64);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "blocks match the chain"), /^FAIL/);
    assert.match(r.out, /1002: hash .* != F{64}/);
  });

  test("a wrong proposer, timestamp or total gas fails", async () => {
    psql("UPDATE block SET total_gas = 1 WHERE height = 1003; UPDATE block SET timestamp = timestamp + interval '1 second' WHERE height = 1005;");
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(r.out, /1003: total_gas 1 != 200001/);
    assert.match(r.out, /1005: timestamp/);
  });

  test("a transaction missing from the database fails", async () => {
    const hash = txHash(chain.blocks.get(1006).txs[0]);
    psql(`DELETE FROM message WHERE transaction_hash = '${hash}'; DELETE FROM transaction WHERE hash = '${hash}';`);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`1006: ${hash} is not in the database`));
  });

  test("a failed transaction stored as successful fails", async () => {
    const hash = txHash(chain.blocks.get(1003).txs[1]);
    psql(`UPDATE transaction SET success = true WHERE hash = '${hash}';`);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(r.out, /success true != false \(code 5\)/);
  });

  test("a transaction whose messages were not stored fails", async () => {
    const hash = txHash(chain.blocks.get(1003).txs[0]);
    psql(`DELETE FROM message WHERE transaction_hash = '${hash}';`);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "every message stored"), /^FAIL/);
    assert.match(r.out, /0 message rows for 1 messages/);
  });

  test("a module that failed on a message fails, grouped by module and type", async () => {
    writeFileSync(
      join(RUN, "callisto.log"),
      LOG_OK +
        '{"level":"error","message":"error while handling message","err":"unable to resolve type URL","module":"gov","height":1003,"msg_type":"/cosmos.gov.v1.MsgVote"}\n'.repeat(2),
    );
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "no handler errors"), /^FAIL/);
    assert.match(r.out, /2x error while handling message \[module gov, \/cosmos\.gov\.v1\.MsgVote\]: unable to resolve type URL/);
  });

  test("a periodic job error or a panic fails", async () => {
    writeFileSync(join(RUN, "callisto.log"), `${LOG_OK}{"level":"error","error":"rpc error: code = Unavailable"}\npanic: runtime error\n`);
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(lineOf(r.out, "no other errors"), /^FAIL/);
    assert.match(r.out, /1x panic/);
  });

  test("a retried block that was then indexed only warns", async () => {
    writeFileSync(join(RUN, "callisto.log"), `${LOG_OK}{"level":"error","message":"re-enqueueing failed block","height":1002,"err":"request failed with status code: 429"}\n`);
    const r = await check();
    assert.equal(r.code, 0, r.out);
    assert.match(lineOf(r.out, "no retried blocks"), /^WARN/);
  });

  test("an enabled module that wrote nothing fails", async () => {
    psql("DELETE FROM validator_signing_info;");
    const r = await check();
    assert.equal(r.code, 1);
    assert.match(r.out, /slashing: validator_signing_info is empty/);
  });

  test("a module that is not enabled is not required", async () => {
    psql("DELETE FROM validator_signing_info;");
    writeLaunch({ modules: ["modules", "messages", "bank", "consensus", "staking"] });
    const r = await check();
    assert.equal(r.code, 0, r.out);
  });
});

// --- doctor.mjs -----------------------------------------------------------------------

describe("doctor.mjs", () => {
  let fake;
  beforeEach(() => {
    // A process whose command line is the one launch.sh starts.
    fake = spawn("bash", ["-c", `exec -a "callisto start --home ${RUN}/home" sleep 300`], { stdio: "ignore" });
    writeFileSync(join(RUN, "pid"), String(fake.pid));
  });
  const stop = () => fake.kill();
  const doctor = async () => {
    const r = await run("doctor.mjs", [], { VERIFY_CALLISTO_EVM_RPC: `http://127.0.0.1:${server.address().port}` });
    stop();
    return r;
  };

  test("control: a healthy instance passes", async () => {
    const r = await doctor();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {3}evm chain id: 1449000/);
  });

  test("a config whose evm.chain_id is another chain's fails", async () => {
    chain.evmChainId = "0x15f900"; // mainnet's, as the old mainnet config had it the other way round
    const r = await doctor();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL evm chain id: fixture has evm\.chain_id 1449000, .* reports 1440000/);
  });

  test("an RPC that serves another chain fails", async () => {
    chain.chainId = "xrplevm_1440000-1";
    const r = await doctor();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL chain id: .* serves xrplevm_1440000-1, testnet is xrplevm_1449000-1/);
  });

  test("a window the node has pruned fails", async () => {
    chain.earliest = START + 1;
    const r = await doctor();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL pruning/);
  });

  test("a process that is not this skill's callisto fails", async () => {
    stop();
    fake = spawn("sleep", ["300"], { stdio: "ignore" });
    writeFileSync(join(RUN, "pid"), String(fake.pid));
    const r = await doctor();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL process: pid \d+ is not this skill's callisto/);
  });

  test("a crashed indexer fails on its log", async () => {
    writeFileSync(join(RUN, "callisto.log"), "ERROR: failed to start client: Forbidden\n");
    const r = await doctor();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL log: ERROR: failed to start client: Forbidden/);
  });
});

// --- render-config.mjs -----------------------------------------------------------------

describe("render-config.mjs", () => {
  const fixtureConfig = () => {
    const src = readFileSync(join(ROOT, "apps/callisto/configs/testnet-config.yaml"), "utf8");
    const file = join(STATE, "fixture-config.yaml");
    writeFileSync(file, yamlSet(src, "node.config.rpc.address", `http://127.0.0.1:${server.address().port}`));
    return { src, file };
  };
  const render = (blocks, file) =>
    run("render-config.mjs", ["testnet", String(blocks), "postgresql://x@127.0.0.1:1/db", "3998"], { VERIFY_CALLISTO_CONFIG: file });

  test("starts N blocks behind the head and changes nothing else that matters", async () => {
    const { src, file } = fixtureConfig();
    const r = await render(20, file);
    assert.equal(r.code, 0, r.out);
    const out = readFileSync(join(RUN, "home", "config.yaml"), "utf8");
    assert.equal(yamlGet(out, "parsing.start_height"), String(chain.latest - 19));
    assert.equal(yamlGet(out, "database.url"), "postgresql://x@127.0.0.1:1/db");
    assert.equal(yamlGet(out, "logging.format"), "json");
    assert.equal(yamlGet(out, "actions.port"), "3998");
    for (const key of ["evm.chain_id", "parsing.parse_genesis", "parsing.workers", "node.config.grpc.address", "chain.bech32_prefix"])
      assert.equal(yamlGet(out, key), yamlGet(src, key), key);
    assert.deepEqual(yamlModules(out), yamlModules(src));
    const launch = JSON.parse(readFileSync(join(RUN, "launch.json"), "utf8"));
    assert.equal(launch.headAtLaunch, chain.latest);
    assert.equal(launch.start, chain.latest - 19);
  });

  test("refuses a window the node has already pruned", async () => {
    const { file } = fixtureConfig();
    const r = await render(chain.latest - chain.earliest + 2, file);
    assert.equal(r.code, 1);
    assert.match(r.out, /only keeps blocks from 900/);
  });
});

// --- lib.mjs ----------------------------------------------------------------------------

describe("lib.mjs", () => {
  test("bech32 matches a consensus address the testnet reports", async () => {
    // From cosmos-api.testnet.xrplevm.org/cosmos/slashing/v1beta1/signing_infos.
    assert.equal(bech32("ethmvalcons", "23FD7394883ABD05D5B49AE1CC1D82E1EE6F5327"), "ethmvalcons1y07h89yg827st4d5ntsuc8vzu8hx75e84x6j83");
  });
  test("timestamps compare at microsecond precision", async () => {
    assert.equal(normalizeTs("2026-11-19T18:32:23.021099041Z"), normalizeTs("2026-11-19 18:32:23.021099"));
    assert.equal(normalizeTs("2026-11-19T10:00:01.123456789Z"), normalizeTs("2026-11-19 10:00:01.123457"));
    assert.equal(normalizeTs("2026-11-19T10:00:01.9999996Z"), normalizeTs("2026-11-19 10:00:02"));
    assert.equal(normalizeTs("2026-11-19 18:32:23.1"), normalizeTs("2026-11-19 18:32:23.100000"));
    assert.notEqual(normalizeTs("2026-11-19 18:32:23.000001"), normalizeTs("2026-11-19 18:32:23"));
  });
  test("a config key is only found under its parent", async () => {
    const src = readFileSync(join(ROOT, "apps/callisto/configs/testnet-config.yaml"), "utf8");
    assert.equal(yamlGet(src, "node.config.rpc.address"), "https://cosmos-rpc.testnet.xrplevm.org");
    assert.throws(() => yamlGet(src, "parsing.address"), /no 'parsing.address'/);
    assert.throws(() => yamlSet(src, "logging.nope", "x"), /no 'logging.nope'/);
  });
});
