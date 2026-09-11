import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
        shell: "rgb(var(--shell) / <alpha-value>)",
        "shell-border": "rgb(var(--shell-border) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        // The foreground for anything sitting ON a status fill. Flips with the
        // theme, because the fills do. See --on-status in globals.css.
        "on-status": "rgb(var(--on-status) / <alpha-value>)",
        gold: "rgb(var(--gold) / <alpha-value>)",
        // Readable gold, for text. See --gold-text in globals.css: the brand
        // gold is 2.08:1 on the light page and cannot carry body copy.
        "gold-text": "rgb(var(--gold-text) / <alpha-value>)",
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
  plugins: [
    /**
     * `coarse:` -- styles for a thumb.
     *
     * Touch sizing used to key off the `lg` width breakpoint: 44px below
     * 1024, compact above. A window width is not a pointer. An iPad in
     * landscape is 1180 wide and pressed with a thumb; a laptop with the
     * window dragged narrow is 900 wide and pointed at with a mouse. The
     * primary pointer's precision is the signal that actually predicts a
     * miss, and it is the one `.tap` already used.
     *
     * So: base styles are the compact, pointer-precise ones, and `coarse:`
     * adds the touch sizing wherever the device's primary pointer is a thumb,
     * at any width.
     */
    plugin(({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
};

export default config;
