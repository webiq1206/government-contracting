import type { Config } from "tailwindcss";

/**
 * BROSTCO editorial theme (inspired by bacwater.ai): white / near-black
 * monochrome with a forest-green accent, Cormorant Garamond display serif,
 * Inter body, JetBrains Mono for data. Flat, border-driven.
 *
 * The legacy dark tokens (ink-*, brand-*) are remapped to light values and the
 * slate text ramp is inverted so existing inline classes flip correctly.
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

        // Legacy dark palette remapped to light so inline classes flip.
        ink: {
          950: "#ffffff",
          900: "#ffffff",
          800: "#e4e4e7",
          700: "#e4e4e7",
          600: "#d4d4d8",
        },
        brand: {
          DEFAULT: "#2d6a4f",
          400: "#2d6a4f",
          500: "#2d6a4f",
          600: "#2d6a4f",
          700: "#21503b",
        },
        pursue: "#2d6a4f",
        review: "#b45309",
        dismiss: "#a1a1aa",
        risk: "#b91c1c",

        // Invert the slate text ramp: bright-on-dark -> dark-on-light.
        slate: {
          100: "#18181b",
          200: "#27272a",
          300: "#3f3f46",
          400: "#52525b",
          500: "#71717a",
          600: "#a1a1aa",
          700: "#d4d4d8",
          800: "#e4e4e7",
          900: "#f4f4f5",
          950: "#fafafa",
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
