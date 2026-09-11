import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
const args = process.argv.slice(2);
const supervised = args.includes("--strictPort");
if (supervised) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  process.env.BROSTCO_PROCESS_ROLE = "web";
  process.env.NODE_ENV = "development";
  if (process.env.BROSTCO_LOCAL_QA === "1") {
    const { startDatabase } = await import("./ui-audit/local-database.mjs");
    await startDatabase();
  }
  const port = args[args.indexOf("--port") + 1] || "4173";
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0", "-p", port],
    { stdio: "inherit", env: process.env },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const child = spawn(
    process.execPath,
    [
      "node_modules/concurrently/dist/bin/concurrently.js",
      "-n",
      "web,worker",
      "-c",
      "cyan,magenta",
      "npm:dev:web",
      "npm:dev:worker",
    ],
    { stdio: "inherit", env: process.env },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}
