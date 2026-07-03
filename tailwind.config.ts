import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // BROSTCO palette — dark procurement console
        ink: {
          950: "#0a0e14",
          900: "#0f1521",
          800: "#151d2e",
          700: "#1e293b",
          600: "#334155",
        },
        brand: {
          DEFAULT: "#2563eb",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        // pipeline / status semantics
        pursue: "#22c55e",
        review: "#f59e0b",
        dismiss: "#64748b",
        risk: "#ef4444",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
