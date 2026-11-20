// Shared by render-config.mjs, doctor.mjs and check.mjs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../../../..");
export const STATE = process.env.VERIFY_CALLISTO_DIR || join(ROOT, ".verify-callisto");
export const RUN = join(STATE, "run");

// The networks this skill verifies. Endpoints come from the network's own
// Callisto config, so the skill tests what production would use. The EVM
// JSON-RPC is only used to check the config's evm.chain_id against the chain.
export const NETWORKS = {
  mainnet: {
    config: "apps/callisto/configs/mainnet-config.yaml",
    explorerConfig: "apps/explorer/src/config/chain.mainnet.json",
    evmRpc: "https://rpc.xrplevm.org",
  },
  testnet: {
    config: "apps/callisto/configs/testnet-config.yaml",
    explorerConfig: "apps/explorer/src/config/chain.testnet.json",
    evmRpc: "https://rpc.testnet.xrplevm.org",
  },
};

export function network(name) {
  const net = NETWORKS[name];
  if (!net) throw new Error(`unknown network '${name}' (${Object.keys(NETWORKS).join(" or ")})`);
  return {
    name,
    config: process.env.VERIFY_CALLISTO_CONFIG || join(ROOT, net.config),
    explorerConfig: join(ROOT, net.explorerConfig),
    evmRpc: process.env.VERIFY_CALLISTO_EVM_RPC || net.evmRpc,
  };
}

// --- Config (YAML) -----------------------------------------------------------
// Callisto's config is a fixed shape; read the few fields we need by key path
// instead of pulling in a YAML dependency. Each reader throws when the key is
// missing, so a renamed key fails loudly instead of being silently skipped.

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Index of the line holding the scalar at a dotted key path, e.g.
// "node.config.rpc.address". Each key must be nested under the previous one.
function locate(lines, path) {
  const keys = path.split(".");
  let depth = 0;
  let parentIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const ind = indentOf(line);
    if (ind <= parentIndent) break; // left the parent's block without a match
    const m = line.trim().match(/^([A-Za-z0-9_]+):/);
    if (!m || m[1] !== keys[depth]) continue;
    if (depth === keys.length - 1) return i;
    depth += 1;
    parentIndent = ind;
  }
  throw new Error(`config has no '${path}'`);
}

export function yamlGet(text, path) {
  const line = text.split("\n")[locate(text.split("\n"), path)];
  return line.replace(/^[^:]*:\s*/, "").replace(/^["']|["']$/g, "");
}

// The list under chain.modules.
export function yamlModules(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\s*modules:\s*$/.test(l));
  if (start < 0) throw new Error("config has no 'chain.modules'");
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^\s*-\s*([A-Za-z0-9_]+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

// Replace the scalar at a dotted key path; throws when the key is missing so
// the rendered config can never silently keep a production value.
export function yamlSet(text, path, value) {
  const lines = text.split("\n");
  const i = locate(lines, path);
  const key = lines[i].trim().split(":")[0];
  lines[i] = `${" ".repeat(indentOf(lines[i]))}${key}: ${value}`;
  return lines.join("\n");
}

// --- HTTP --------------------------------------------------------------------

export async function getJson(url, { tries = 4, timeoutMs = 20000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`GET ${url} failed after ${tries} tries: ${last?.message ?? last}`);
}

export async function postJson(url, body, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function rpcStatus(rpc) {
  const s = await getJson(`${rpc}/status`);
  return {
    chainId: s.result.node_info.network,
    latest: Number(s.result.sync_info.latest_block_height),
    earliest: Number(s.result.sync_info.earliest_block_height),
    catchingUp: s.result.sync_info.catching_up,
  };
}

// Run fn over items with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// --- Chain encodings ---------------------------------------------------------

export function txHash(base64Tx) {
  return createHash("sha256").update(Buffer.from(base64Tx, "base64")).digest("hex").toUpperCase();
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i];
  }
  return chk;
}

function convertBits(data, from, to) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & max);
    }
  }
  if (bits > 0) out.push((acc << (to - bits)) & max);
  return out;
}

// Bech32-encode a hex address, e.g. a block's proposer under "<prefix>valcons".
export function bech32(prefix, hex) {
  const data = convertBits(Buffer.from(hex, "hex"), 8, 5);
  const hrp = [...prefix].map((c) => c.charCodeAt(0));
  const expanded = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)];
  const mod = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...data, ...checksum].map((d) => BECH32[d]).join("")}`;
}

// Postgres stores timestamps rounded to microseconds and prints them like
// "2026-11-19 18:32:23.021099" (trailing zeros dropped); CometBFT prints
// "2026-11-19T18:32:23.021099041Z". Both become microseconds since the epoch,
// rounded the way Postgres rounds, so they compare exactly.
export function normalizeTs(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return String(s);
  const [, y, mo, d, h, mi, sec, frac = ""] = m;
  const seconds = BigInt(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) / 1000);
  const nanos = BigInt(frac.padEnd(9, "0").slice(0, 9));
  return String(seconds * 1000000n + (nanos + 500n) / 1000n);
}

// --- Run state and the database ----------------------------------------------

export function readLaunch() {
  const file = join(RUN, "launch.json");
  if (!existsSync(file)) throw new Error(`no ${file}: run launch.sh first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

// Query the throwaway database with the psql command launch.sh recorded (a
// local psql or `docker exec`). Returns rows as arrays of strings.
export function sql(query) {
  const argv = JSON.parse(readFileSync(join(RUN, "psql.json"), "utf8"));
  const out = execFileSync(argv[0], [...argv.slice(1), "-X", "-q", "-At", "-F", "\t", "-c", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
}

export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
