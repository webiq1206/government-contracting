/**
 * Loads .env for standalone (worker / scripts) processes. Next.js loads .env
 * itself, so this is a no-op there (dotenv only fills vars that are unset).
 * Imported for its side effect by config.ts.
 */
import { config as dotenv } from "dotenv";

// Only load a file in non-Next contexts. `next` sets NEXT_RUNTIME.
if (!process.env.NEXT_RUNTIME) {
  dotenv();
}

export {};
