import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // The app compiles JSX through Next's automatic runtime; esbuild here needs
  // telling separately, or a component test fails on "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // .tsx as well, so a component's own rendered output can be asserted.
    // A card whose whole job is to say the right sentence is worth testing on
    // the sentence rather than on the props that feed it.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
