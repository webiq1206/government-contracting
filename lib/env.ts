/**
 * Loads .env for standalone engine runs (CLI). In the api-server process env is
 * provided by the host (Replit), so dotenv only fills anything still unset.
 * Imported for its side effect by config.ts.
 */
import { config as dotenv } from "dotenv";

if (!process.env.NEXT_RUNTIME) {
  dotenv();
}

export {};
