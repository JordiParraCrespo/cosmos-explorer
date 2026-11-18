// Contract tests for verify-explorer's scripts. They prove that each script
// keeps the promises SKILL.md makes for it, and that each check the driver
// runs can fail: a journey is driven against a fixture server that breaks
// one thing, next to a control that does not.
//
//   node --test .agents/skills/verify-explorer/evals/scripts.test.mjs
//
// The fixtures need no build, network or chain. Playwright must resolve, as
// for the skill itself. VERIFY_EXPLORER_E2E=1 also runs the whole skill
// once against testnet (a build, about two minutes).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const scripts = join(import.meta.dirname, "..", "scripts");

// Async on purpose: the fixture servers live in this process, and a
// spawnSync would block the event loop they answer from.
function run(script, args = [], env = {}) {
  const cmd = script.endsWith(".mjs") ? process.execPath : join(scripts, script);
  const argv = script.endsWith(".mjs") ? [join(scripts, script), ...args] : args;
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      env: { ...process.env, VERIFY_EXPLORER_TIMEOUT_MS: "4000", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** A fresh state dir, as launch.sh leaves it, pointing at `port`. */
function stateFor(port, { pid = process.pid, network = "testnet" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-explorer-eval-"));
  mkdirSync(join(dir, "run"));
  writeFileSync(join(dir, "run", "pid"), String(pid));
  writeFileSync(join(dir, "run", "port"), String(port));
  writeFileSync(join(dir, "run", "network"), network);
  writeFileSync(join(dir, "run", "build-network"), network);
  writeFileSync(join(dir, "run", "server.log"), "✓ Ready\n");
  return dir;
}

// An unrelated process: what a reused pid can belong to.
const sleeper = () => spawn("sleep", ["60"], { stdio: "ignore" });
// A process that is "ours" to lib.sh's is_our_server: its command line runs
// apps/explorer/server.js, as the explorer's standalone server does.
function fakeServer() {
  const dir = mkdtempSync(join(tmpdir(), "ve-server-"));
  mkdirSync(join(dir, "apps", "explorer"), { recursive: true });
  writeFileSync(join(dir, "apps", "explorer", "server.js"), "setInterval(() => {}, 1000);\n");
  return spawn(process.execPath, [join(dir, "apps", "explorer", "server.js")], { stdio: "ignore" });
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const report = (dir) => {
  const [runDir] = readdirSync(join(dir, "evidence"));
  return { dir: join(dir, "evidence", runDir), ...JSON.parse(readFileSync(join(dir, "evidence", runDir, "report.json"), "utf8")) };
};

// --- A fixture explorer -----------------------------------------------------
// Just enough of each page for one journey, with a switch per breakage.
const page = (body, chainId = "xrplevm_1449000-1") =>
  `<!doctype html><html><body><nav><a href="/blocks">Blocks</a></nav><main>${body}</main>` +
  `<footer><p>Chain ID:<!-- --> <span class="font-mono">${chainId}</span></p></footer></body></html>`;
// The header search as a person uses it: type, press Enter, land on the match.
const SEARCH_BOX = `<input placeholder="Search block, tx, address..." onkeydown="if (event.key === 'Enter') {
  const v = this.value; location.href = /^\\d+$/.test(v) ? '/blocks/' + v : /^[0-9A-F]+$/.test(v) ? '/transactions/' + v : '/account/' + v; }">`;
const SKELETON = '<div class="animate-pulse"></div>';
const ACCOUNT_LOADED =
  "<h1>Account</h1><p>acc1</p><h2>Balances</h2><p>Unclaimed delegation rewards</p><h2>Delegations</h2>";
// What loading.tsx renders: the same headings over skeletons, no data.
const ACCOUNT_SKELETON =
  '<h1>Account</h1><div class="animate-pulse"></div><h2>Balances</h2><h2>Delegations</h2>';
function fixture({
  overviewLinks = true,
  accountError = false,
  accountStuck = false,
  blockStuck = false,
  consensusStuck = false,
  servedChainId,
  newestBlock = 7,
  serverErrorOn,
  logFile,
} = {}) {
  const pages = {
    "/": page(
      `${SEARCH_BOX}<h1>Overview</h1>${overviewLinks ? '<a href="/blocks/7">7</a><a href="/transactions/AB">AB</a>' : ""}`,
      servedChainId,
    ),
    "/blocks": page(`<h1>Blocks</h1><a href="/blocks/${newestBlock}">${newestBlock}</a><a href="/blocks/7">7</a>`),
    // blocks/[height]/loading.tsx draws "Block Hash" before any data.
    "/blocks/7": page(blockStuck ? `<p>Block Hash</p>${SKELETON}` : "<h1>Block #7</h1><p>Block Hash</p>"),
    "/transactions": page('<h1>Transactions</h1><a href="/transactions/AB">AB</a>'),
    "/transactions/AB": page("<h1>Transaction Details</h1><p>AB</p><p>Status</p>"),
    "/validators": page('<h1>Validators</h1><a href="/validators/val1">val1</a>'),
    "/validators/val1": page('<p>Operator Address</p><p>val1</p><a href="/account/acc1">acc1</a>'),
    "/account/acc1": page(
      accountError
        ? "<h2>Balances</h2><h2>Delegations</h2><p>Something went wrong</p>"
        : accountStuck
          ? ACCOUNT_SKELETON
          : ACCOUNT_LOADED,
    ),
    "/consensus": page(`<h1>XRPL EVM Sidechain consensus signing matrix</h1>${consensusStuck ? SKELETON : ""}`),
  };
  const server = createServer((req, res) => {
    if (req.url === serverErrorOn && logFile) appendFileSync(logFile, "⨯ Error: upstream failed\n");
    const html = pages[req.url];
    res.writeHead(html ? 200 : 404, { "content-type": "text/html" });
    res.end(html ?? page("<p>not here</p>"));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const servers = [];
async function serve(opts) {
  const server = await fixture(opts);
  servers.push(server);
  return server.address().port;
}
after(() => servers.forEach((s) => s.close()));

// --- Usage and refusals -----------------------------------------------------
describe("refusals", () => {
  test("drive names the known features when given an unknown one", async () => {
    const dir = stateFor(1);
    const { code, out } = await run("drive.mjs", ["no-such-feature"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 2);
    assert.match(out, /unknown feature\(s\) no-such-feature; known: overview, blocks/);
  });

  test("launch refuses an unknown network", async () => {
    const { code, out } = await run("launch.sh", ["regtest"], { VERIFY_EXPLORER_DIR: mkdtempSync(join(tmpdir(), "ve-")) });
    assert.equal(code, 2);
    assert.match(out, /unknown network 'regtest'/);
  });

  test("launch refuses a port something else holds", async () => {
    const port = await serve();
    const { code, out } = await run("launch.sh", ["testnet"], {
      VERIFY_EXPLORER_DIR: mkdtempSync(join(tmpdir(), "ve-")),
      VERIFY_EXPLORER_PORT: String(port),
    });
    assert.equal(code, 1);
    assert.match(out, new RegExp(`something else already answers on :${port}`));
  });

  test("launch refuses to start a second instance", async () => {
    const child = fakeServer();
    try {
      const dir = stateFor(3999, { pid: child.pid });
      const { code, out } = await run("launch.sh", ["testnet"], { VERIFY_EXPLORER_DIR: dir });
      assert.equal(code, 1);
      assert.match(out, /already running \(pid \d+, testnet on :3999\)/);
    } finally {
      child.kill();
    }
  });

  test("launch does not mistake a reused pid for a running instance", async () => {
    const child = sleeper();
    const port = await serve(); // keeps launch from building once past the check
    try {
      const dir = stateFor(port, { pid: child.pid });
      const { code, out } = await run("launch.sh", ["testnet"], {
        VERIFY_EXPLORER_DIR: dir,
        VERIFY_EXPLORER_PORT: String(port),
      });
      assert.equal(code, 1);
      assert.doesNotMatch(out, /already running/);
      assert.match(out, /something else already answers/);
    } finally {
      child.kill();
    }
  });
});

// --- Reusing a build --------------------------------------------------------
describe("reusable_build", () => {
  // Calls lib.sh's reusable_build on a throwaway app dir and run dir.
  function reusable({ recordedNetwork = "testnet", recordedId = "B1", currentId = "B1", network = "testnet" } = {}) {
    const app = mkdtempSync(join(tmpdir(), "ve-app-"));
    mkdirSync(join(app, ".next", "standalone", "apps", "explorer"), { recursive: true });
    writeFileSync(join(app, ".next", "standalone", "apps", "explorer", "server.js"), "");
    writeFileSync(join(app, ".next", "BUILD_ID"), currentId);
    const runDir = mkdtempSync(join(tmpdir(), "ve-run-"));
    writeFileSync(join(runDir, "build-network"), recordedNetwork);
    if (recordedId) writeFileSync(join(runDir, "build-id"), recordedId);
    const res = spawnSync("bash", ["-c", `. "${join(scripts, "lib.sh")}" && reusable_build "$@"`, "_", network, runDir, app]);
    return res.status === 0;
  }

  test("reuses the build launch.sh made for that network", () => {
    assert.equal(reusable(), true);
  });
  test("does not reuse a .next rebuilt since (BUILD_ID changed)", () => {
    assert.equal(reusable({ currentId: "B2" }), false);
  });
  test("does not reuse a build made for another network", () => {
    assert.equal(reusable({ network: "mainnet" }), false);
  });
  test("does not reuse a build whose BUILD_ID was never recorded", () => {
    assert.equal(reusable({ recordedId: "" }), false);
  });
});

// --- Doctor -----------------------------------------------------------------
describe("doctor", () => {
  test("says there is nothing to check when no instance is recorded", async () => {
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: mkdtempSync(join(tmpdir(), "ve-")) });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}no instance recorded/);
  });

  test("fails when the recorded server is gone and the port is dead", async () => {
    const child = sleeper();
    const pid = child.pid;
    child.kill();
    await new Promise((r) => child.on("exit", r));
    const dir = stateFor(1, { pid });
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, new RegExp(`FAIL {2}server pid ${pid} is gone`));
    assert.match(out, /FAIL {2}GET \/ failed/);
  });

  test("fails when the build is for another network than the server runs", async () => {
    const port = await serve();
    const dir = stateFor(port);
    writeFileSync(join(dir, "run", "build-network"), "mainnet");
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}the build is for mainnet, the server runs testnet/);
  });

  test("fails when .next was rebuilt after launch (BUILD_ID changed)", async () => {
    const port = await serve();
    const dir = stateFor(port);
    writeFileSync(join(dir, "run", "build-id"), "a-build-that-is-gone");
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}\.next has BUILD_ID .*, launch\.sh recorded a-build-that-is-gone/);
  });

  test("fails when the page serves another chain than the run's network", async () => {
    const port = await serve({ servedChainId: "xrplevm_1440000-1" });
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: stateFor(port) });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}the page serves chain xrplevm_1440000-1, chain\.testnet\.json expects xrplevm_1449000-1/);
  });

  test("control: passes the served-chain check when the page serves the expected chain", async () => {
    const port = await serve();
    const { out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: stateFor(port) });
    assert.match(out, /ok {4}the page serves chain xrplevm_1449000-1/);
  });

  // Asks testnet's public RPC for its head, like the doctor itself.
  test("fails when the explorer lists blocks far past the chain head", async () => {
    const port = await serve({ newestBlock: 999_999_999 });
    const { code, out } = await run("doctor.mjs", [], { VERIFY_EXPLORER_DIR: stateFor(port) });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}\/blocks lists height 999999999, \d+ past the chain head \d+: the data is another chain's/);
  });
});

// --- Cleanup ----------------------------------------------------------------
describe("cleanup", () => {
  test("stops the recorded server and keeps the evidence", async () => {
    const child = fakeServer();
    const exited = new Promise((r) => child.on("exit", r));
    const dir = stateFor(1, { pid: child.pid });
    mkdirSync(join(dir, "evidence", "run-1"), { recursive: true });
    writeFileSync(join(dir, "evidence", "run-1", "report.json"), "{}");
    const { code, out } = await run("cleanup.sh", [], { VERIFY_EXPLORER_DIR: dir });
    await exited;
    assert.equal(code, 0);
    assert.match(out, new RegExp(`stopped pid ${child.pid}`));
    assert.equal(alive(child.pid), false);
    assert.equal(existsSync(join(dir, "run", "pid")), false);
    assert.equal(existsSync(join(dir, "evidence", "run-1", "report.json")), true);
  });

  test("leaves alone a recorded pid that now belongs to another process", async () => {
    const child = sleeper();
    try {
      const dir = stateFor(1, { pid: child.pid });
      const { code, out } = await run("cleanup.sh", [], { VERIFY_EXPLORER_DIR: dir });
      assert.equal(code, 0);
      assert.match(out, new RegExp(`pid ${child.pid} is no longer the explorer server .*left it alone`));
      assert.equal(alive(child.pid), true);
      assert.equal(existsSync(join(dir, "run", "pid")), false);
    } finally {
      child.kill();
    }
  });

  test("is a no-op when the recorded pid already exited", async () => {
    const child = sleeper();
    const pid = child.pid;
    child.kill();
    await new Promise((r) => child.on("exit", r));
    const { code, out } = await run("cleanup.sh", [], { VERIFY_EXPLORER_DIR: stateFor(1, { pid }) });
    assert.equal(code, 0);
    assert.match(out, new RegExp(`pid ${pid} had already exited`));
  });
});

// --- The driver's checks can fail, for the right reason --------------------
describe("drive", () => {
  test("control: journeys pass against a fixture that renders them", async () => {
    const port = await serve();
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["overview", "accounts", "consensus"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 0, out);
    const r = report(dir);
    assert.deepEqual(r.results.map((x) => [x.feature, x.status]), [
      ["overview", "pass"],
      ["accounts", "pass"],
      ["consensus", "pass"],
    ]);
    for (const shot of r.results.flatMap((x) => x.shots)) assert.ok(existsSync(shot), shot);
  });

  test("overview fails when the page renders its heading but no live data", async () => {
    const port = await serve({ overviewLinks: false });
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["overview"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}overview/);
    const [result] = report(dir).results;
    assert.equal(result.status, "fail");
    assert.ok(result.shots.some((s) => s.endsWith("overview-failure.png") && existsSync(s)));
  });

  test("accounts fails when the page shows the error boundary", async () => {
    const port = await serve({ accountError: true });
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["accounts"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}accounts .*error boundary/);
  });

  test("accounts fails when the page never leaves its loading skeleton", async () => {
    const port = await serve({ accountStuck: true });
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["accounts"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}accounts .*Timeout/);
  });

  test("search fails when a searched block never leaves its loading skeleton", async () => {
    const port = await serve({ blockStuck: true });
    const { code, out } = await run("drive.mjs", ["search"], { VERIFY_EXPLORER_DIR: stateFor(port) });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}search .*Timeout/);
  });

  test("control: search passes when every searched page loads", async () => {
    const port = await serve();
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["search"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 0, out);
    assert.deepEqual(report(dir).results[0].shots.map((s) => s.split("/").pop()), [
      "search-by-height.png",
      "search-by-tx-hash.png",
      "search-by-address.png",
    ]);
  });

  test("no journey takes its proof screenshot while a skeleton is still on the page", async () => {
    const port = await serve({ consensusStuck: true });
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["consensus"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}consensus .*Timeout/);
    // The only screenshot is the failure one, taken as the page is.
    assert.deepEqual(report(dir).results[0].shots.map((s) => s.split("/").pop()), ["consensus-failure.png"]);
  });

  test("a journey fails on a server error even when the page looks right", async () => {
    const dir = stateFor(0);
    const port = await serve({ serverErrorOn: "/consensus", logFile: join(dir, "run", "server.log") });
    writeFileSync(join(dir, "run", "port"), String(port));
    const { code, out } = await run("drive.mjs", ["consensus"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}consensus .*server errors: ⨯ Error: upstream failed/);
  });

  test("a journey fails when the server is not there", async () => {
    // A port that was just free (not port 1: Chromium refuses it as unsafe
    // before connecting, which would test the wrong thing).
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const dir = stateFor(port);
    const { code, out } = await run("drive.mjs", ["overview"], { VERIFY_EXPLORER_DIR: dir });
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}overview .*ERR_CONNECTION_REFUSED/);
  });
});

// --- The whole skill, once, against a real network (opt in) ---------------
describe("end to end", { skip: process.env.VERIFY_EXPLORER_E2E !== "1" && "set VERIFY_EXPLORER_E2E=1" }, () => {
  test("launch, doctor, drive, cleanup on testnet; the evidence survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-explorer-e2e-"));
    const env = { VERIFY_EXPLORER_DIR: dir, VERIFY_EXPLORER_TIMEOUT_MS: "30000", VERIFY_EXPLORER_PORT: "3190" };
    try {
      let r = await run("launch.sh", ["testnet"], env);
      assert.equal(r.code, 0, r.out);
      r = await run("doctor.mjs", [], env);
      assert.equal(r.code, 0, r.out);
      r = await run("drive.mjs", ["overview", "blocks"], env);
      assert.equal(r.code, 0, r.out);
    } finally {
      await run("cleanup.sh", [], env);
    }
    const r = report(dir);
    assert.deepEqual(r.results.map((x) => x.status), ["pass", "pass"]);
    for (const shot of r.results.flatMap((x) => x.shots)) assert.ok(existsSync(shot), shot);
  });
});
