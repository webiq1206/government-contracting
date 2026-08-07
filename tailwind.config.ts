import type { Config } from "tailwindcss";

/**
 * BROSTCO brand theme, five tones (a warm, quiet range):
 *   Bone #F7F5F3, Charcoal #2C302F, Sage #5D6561, Mist #9AA098, Line #E4E1DD.
 * Bone and charcoal do the work (background + text); sage and mist carry the
 * secondary type; line is for hairlines only. Montserrat is the voice; Fraunces
 * italic is a sparing accent (the `.font-accent` class). Flat, border-driven.
 *
 * The slate ramp is a WARM gray ramp aligned to the palette, in standard
 * Tailwind orientation (100 = light, 900 = dark). Do not invert it.
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
        background: "#F7F5F3", // Bone
        foreground: "#2C302F", // Charcoal
        surface: "#F1EEEA", // warm off-bone (subtle raised / hover)
        "surface-raised": "#ECE8E3",
        muted: "#F1EEEA",
        "muted-foreground": "#5D6561", // Sage (secondary type)
        border: "#E4E1DD", // Line (hairlines)
        "border-strong": "#CFCBC4",
        accent: "#5D6561", // Sage
        "accent-soft": "#E9ECE8", // very light sage/mist tint
        "accent-strong": "#464C49", // deeper sage (hover)

        // Functional status tones, muted to sit in the warm palette while staying
        // clearly distinguishable (go / caution / danger).
        pursue: "#4F6A5A",
        // Caution amber, deepened from #9A6B34 so 12px badge text passes
        // WCAG AA (4.5:1) on both the bone background and the /15 tint.
        review: "#855C2C",
        dismiss: "#9AA098", // Mist
        risk: "#A2453C",

        // Warm gray ramp aligned to the palette (100 light -> 900 dark).
        slate: {
          50: "#F7F5F3",
          100: "#F1EEEA",
          200: "#E4E1DD", // Line
          300: "#CFCBC4",
          400: "#9AA098", // Mist
          500: "#5D6561", // Sage
          600: "#4C524E",
          700: "#3B403D",
          800: "#2C302F", // Charcoal
          900: "#232624",
          950: "#1A1D1C",
        },
      },
      fontFamily: {
        sans: ['"Montserrat"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        // Fraunces is reserved for sparing italic accents (see `.font-accent`).
        serif: ['"Fraunces"', "Georgia", '"Times New Roman"', "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
