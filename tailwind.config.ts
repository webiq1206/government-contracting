import type { Config } from "tailwindcss";

/**
 * BROST CO theme system.
 * Semantic colors are CSS variables so Light / Dark swap together via
 * `html.dark`. Status colors (pursue / review / risk / gold) stay brand-stable.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      opacity: {
        12: "0.12",
        15: "0.15",
        28: "0.28",
        35: "0.35",
        45: "0.45",
        55: "0.55",
        65: "0.65",
      },
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        "muted-foreground": "rgb(var(--muted-foreground) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        // Chrome / elevated night (theme-aware; light theme maps to paper tones)
        ink: "rgb(var(--ink) / <alpha-value>)",
        shell: "rgb(var(--shell) / <alpha-value>)",
        "shell-border": "rgb(var(--shell-border) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        gold: "rgb(var(--gold) / <alpha-value>)",
        "gold-deep": "rgb(var(--gold-deep) / <alpha-value>)",
        pursue: "rgb(var(--pursue) / <alpha-value>)",
        "pursue-strong": "rgb(var(--pursue-strong) / <alpha-value>)",
        "pursue-soft": "rgb(var(--pursue-soft) / <alpha-value>)",
        review: "rgb(var(--review) / <alpha-value>)",
        dismiss: "rgb(var(--dismiss) / <alpha-value>)",
        risk: "rgb(var(--risk) / <alpha-value>)",
        // Warm slate ramp flips in dark mode so existing text-slate-* stays readable.
        slate: {
          50: "rgb(var(--slate-50) / <alpha-value>)",
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
          700: "rgb(var(--slate-700) / <alpha-value>)",
          800: "rgb(var(--slate-800) / <alpha-value>)",
          900: "rgb(var(--slate-900) / <alpha-value>)",
          950: "rgb(var(--slate-950) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        serif: ['"GFS Didot"', "Didot", "Georgia", '"Times New Roman"', "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
