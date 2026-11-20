#!/usr/bin/env node
// Render the Callisto config this run uses from the network's own config
// (apps/callisto/configs/<network>-config.yaml) and record the launch window.
//
//   node render-config.mjs <network> <blocks> <database-url> <actions-port>
//
// Only what must differ from production changes: where indexing starts (the
// chain head minus <blocks>), the throwaway database, the actions port and
// JSON logs at info level, so check.mjs can read the errors. Endpoints,
// modules, genesis parsing and the EVM chain id stay as the network ships
// them, so the run tests the config production uses.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN, network, rpcStatus, yamlGet, yamlModules, yamlSet } from "./lib.mjs";

const [name, blocksArg, dbUrl, actionsPort] = process.argv.slice(2);
if (!name || !blocksArg || !dbUrl || !actionsPort) {
  console.error("usage: render-config.mjs <network> <blocks> <database-url> <actions-port>");
  process.exit(2);
}
const blocks = Number(blocksArg);
if (!Number.isInteger(blocks) || blocks < 1) {
  console.error(`render-config: --blocks must be a positive integer, got '${blocksArg}'`);
  process.exit(2);
}

const net = network(name);
const source = readFileSync(net.config, "utf8");
const rpc = yamlGet(source, "node.config.rpc.address");

const status = await rpcStatus(rpc);
const start = status.latest - blocks + 1;
if (start < status.earliest) {
  console.error(
    `render-config: ${rpc} only keeps blocks from ${status.earliest}; ` +
      `${blocks} blocks back from ${status.latest} is ${start}. Use fewer --blocks.`,
  );
  process.exit(1);
}

let config = source;
config = yamlSet(config, "parsing.start_height", String(start));
config = yamlSet(config, "database.url", dbUrl);
config = yamlSet(config, "actions.port", actionsPort);
config = yamlSet(config, "logging.level", "info");
config = yamlSet(config, "logging.format", "json");

const home = join(RUN, "home");
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "config.yaml"), config);

const launch = {
  network: name,
  sourceConfig: net.config,
  rpc,
  api: yamlGet(source, "node.config.api.address"),
  grpc: yamlGet(source, "node.config.grpc.address"),
  evmRpc: net.evmRpc,
  evmChainId: Number(yamlGet(source, "evm.chain_id")),
  bech32Prefix: yamlGet(source, "chain.bech32_prefix"),
  modules: yamlModules(source),
  parseGenesis: yamlGet(source, "parsing.parse_genesis") === "true",
  avgBlockTimeSeconds: Number.parseFloat(yamlGet(source, "parsing.average_block_time")) || 4,
  chainId: status.chainId,
  headAtLaunch: status.latest,
  earliestAvailable: status.earliest,
  start,
  blocks,
  launchedAt: new Date().toISOString(),
};
writeFileSync(join(RUN, "launch.json"), `${JSON.stringify(launch, null, 2)}\n`);
console.log(`render-config: ${name} (${status.chainId}) from ${start} to the head ${status.latest} and onwards`);
