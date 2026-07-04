/**
 * Operator CLI.
 *   npm run agent -- hash-password 'mypassword'   # print a password hash for .env
 *   npm run agent -- list                         # list all agents
 *   npm run agent -- run <agent-name> [key=val...] # run one agent once (manual trigger)
 *
 * Runs agents through the same isolating runner the worker uses.
 */
import "../lib/env";
import { hashPassword } from "../lib/auth";
import { ALL_AGENTS, getAgent } from "../lib/agents/registry";
import { runAgent } from "../lib/agents/runner";
import { closePool } from "../lib/db";
import { stopQueue } from "../lib/queue";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "hash-password": {
      const pw = rest[0];
      if (!pw) {
        console.error("usage: npm run agent -- hash-password '<password>'");
        process.exit(1);
      }
      console.log(hashPassword(pw));
      return;
    }
    case "list": {
      console.log("Agents:");
      for (const a of ALL_AGENTS) {
        console.log(`  ${a.name.padEnd(26)} ${a.cron ? `[cron ${a.cron}]`.padEnd(20) : "".padEnd(20)} ${a.description}`);
      }
      return;
    }
    case "run": {
      const name = rest[0];
      const def = name ? getAgent(name) : undefined;
      if (!def) {
        console.error(`unknown agent "${name}". Run: npm run agent -- list`);
        process.exit(1);
      }
      const payload: Record<string, unknown> = {};
      for (const kv of rest.slice(1)) {
        const [k, v] = kv.split("=");
        if (k) payload[k] = v;
      }
      console.log(`Running ${def.name} with payload`, payload);
      const result = await runAgent(def, "manual", payload);
      console.log(JSON.stringify(result, null, 2));
      await stopQueue().catch(() => {});
      await closePool();
      return;
    }
    default:
      console.log("Commands: hash-password <pw> | list | run <agent> [key=val ...]");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
