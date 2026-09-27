import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: { isProd: true, database: { isIsolatedDev: true, url: "postgresql://development" } },
  standaloneClient: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ config: state.config }));
vi.mock("@/lib/db", () => ({ standaloneClient: state.standaloneClient, query: vi.fn() }));
import { applyMigrations } from "@/lib/migrate";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  state.config.database.isIsolatedDev = true;
});

describe("owner migration boundary", () => {
  it("rejects an owner URL in isolated development before creating a client", async () => {
    vi.stubEnv("MIGRATION_DATABASE_URL", "postgresql://owner@example.invalid/live");
    await expect(applyMigrations()).rejects.toThrow("Refusing owner migrations from isolated development");
    expect(state.standaloneClient).not.toHaveBeenCalled();
  });
  it("still rejects production migrations without an owner URL", async () => {
    state.config.database.isIsolatedDev = false;
    vi.stubEnv("MIGRATION_DATABASE_URL", "");
    await expect(applyMigrations()).rejects.toThrow("MIGRATION_DATABASE_URL is required");
    expect(state.standaloneClient).not.toHaveBeenCalled();
  });
});
