import type { Config } from "tailwindcss";

/**
 * BROSTCO editorial theme (inspired by bacwater.ai): white / near-black
 * monochrome with a forest-green accent, Cormorant Garamond display serif,
 * Inter body, JetBrains Mono for data. Flat, border-driven.
 *
 * The slate ramp uses zinc hues in STANDARD Tailwind orientation
 * (100 = light, 900 = dark). Do not invert it again.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#ffffff",
        foreground: "#111111",
        surface: "#fafaf9",
        "surface-raised": "#f5f5f4",
        muted: "#f5f5f4",
        "muted-foreground": "#71717a",
        border: "#e4e4e7",
        "border-strong": "#d4d4d8",
        accent: "#2d6a4f",
        "accent-soft": "#f0f7f2",
        "accent-strong": "#21503b",

        pursue: "#2d6a4f",
        review: "#b45309",
        dismiss: "#a1a1aa",
        risk: "#b91c1c",

        // Zinc-hued gray ramp in standard Tailwind orientation (100 light -> 900 dark).
        slate: {
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#27272a",
          900: "#18181b",
          950: "#09090b",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        serif: ['"Cormorant Garamond"', "Georgia", '"Times New Roman"', "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
