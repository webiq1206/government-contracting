/**
 * Loads .env for standalone engine runs (CLI). In the api-server process env is
 * provided by the host (Replit), so dotenv only fills anything still unset.
 * Imported for its side effect by config.ts.
 */
import { config as dotenv } from "dotenv";

/**
 * Never under test.
 *
 * The unit suite passed only because CI and most checkouts have no .env. Give
 * a developer the .env the README tells them to create, and eight unit tests
 * start dialling the real database and time out, because importing config
 * loads this file and hands them live credentials. Tests that behave
 * differently depending on whether the machine has production secrets are not
 * tests. Integration suites opt in explicitly by reading process.env
 * themselves; everything else gets a clean environment.
 */
if (!process.env.NEXT_RUNTIME && !process.env.VITEST) {
  dotenv();
}

export {};
