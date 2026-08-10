import type { Config } from "tailwindcss";

/**
 * BROST CO brand theme (per the 2026 brand guide):
 *   Charcoal #242424, Gold #B28F5D, Ivory #F7F4EE, Stone #D8D2C7, White #FFFFFF.
 * The page background stays the existing warm off-white (#F7F5F3) by explicit
 * user preference. Charcoal carries text; gold signals importance and brand
 * emphasis only (never a large background field); stone carries borders and
 * quiet accents. GFS Didot is display; Inter is UI/body. Flat, border-driven.
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
        background: "#F7F5F3", // existing background, kept per user preference
        foreground: "#242424", // Charcoal
        surface: "#F7F4EE", // Ivory (subtle raised / hover)
        "surface-raised": "#F0EBE2", // deeper ivory
        muted: "#F7F4EE",
        "muted-foreground": "#6B6560", // warm gray for secondary type
        border: "#E6E1D8", // light stone (hairlines)
        "border-strong": "#D8D2C7", // Stone
        // Semantic accent: a deepened, WCAG-AA gold-brown (4.5:1+ as text on the
        // page ground and with white text on filled controls). The pure brand
        // gold is exposed separately as `gold` for decorative, non-text emphasis
        // only (rules, borders, dots) — never large fields, never body text.
        accent: "#7E5E33",
        "accent-soft": "#F3ECE0", // pale gold/ivory tint
        "accent-strong": "#6F5228", // deeper (hover)
        gold: "#B28F5D", // brand gold — decorative emphasis only

        // Functional status tones, muted to sit in the warm palette while staying
        // clearly distinguishable (go / caution / danger).
        //
        // GREEN vs GOLD roles:
        //   `pursue` (sage green) is the positive/"go" accent: success states,
        //   match badges, progress/coverage fills, "system is working" and
        //   "your turn" cues. `accent`/`gold` stay the brand-emphasis accent:
        //   rules, selected navigation, editorial highlights, brand moments.
        // pursue is AA (5.2:1) as text on the page ground and on pursue-soft,
        // and carries white text at 5.7:1 on filled controls.
        pursue: "#5A6B52",
        "pursue-strong": "#4A5943", // deeper (hover / emphasis)
        "pursue-soft": "#E9EDE5", // pale sage tint for filled chips/panels
        // Caution amber, deep enough that 12px badge text passes WCAG AA
        // (4.5:1) on both the light background and the /15 tint.
        review: "#855C2C",
        dismiss: "#A39C90", // warm stone-gray
        risk: "#A2453C",

        // Warm gray ramp aligned to the palette (100 light -> 900 dark).
        slate: {
          50: "#F7F5F3",
          100: "#F7F4EE", // Ivory
          200: "#E6E1D8",
          300: "#D8D2C7", // Stone
          400: "#A39C90",
          500: "#6B6560",
          600: "#57524D",
          700: "#403C38",
          800: "#242424", // Charcoal
          900: "#1C1C1C",
          950: "#141414",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        // GFS Didot: display serif for premium headlines and brand moments.
        serif: ['"GFS Didot"', "Didot", "Georgia", '"Times New Roman"', "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
