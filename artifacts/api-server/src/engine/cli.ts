/**
 * Engine CLI for ops/debugging.
 *   pnpm --filter @workspace/api-server agent list
 *   pnpm --filter @workspace/api-server agent run <name> [key=val ...]
 * Runs an agent once through the isolating runner (same path the worker uses).
 */
import "./env";
import { ALL_AGENTS, getAgent } from "./agents/registry";
import { runAgent } from "./agents/runner";
import { closePool } from "./db";
import { stopQueue } from "./queue";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "list": {
      for (const a of ALL_AGENTS) {
        console.log(`  ${a.name.padEnd(26)} ${(a.cron ? `[cron ${a.cron}]` : "").padEnd(20)} ${a.description}`);
      }
      return;
    }
    case "run": {
      const def = rest[0] ? getAgent(rest[0]) : undefined;
      if (!def) {
        console.error(`unknown agent "${rest[0]}". Try: agent list`);
        process.exit(1);
      }
      const payload: Record<string, unknown> = {};
      for (const kv of rest.slice(1)) {
        const [k, v] = kv.split("=");
        if (k) payload[k] = v;
      }
      const result = await runAgent(def, "manual", payload);
      console.log(JSON.stringify(result, null, 2));
      await stopQueue().catch(() => {});
      await closePool();
      return;
    }
    default:
      console.log("Commands: list | run <agent> [key=val ...]");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
