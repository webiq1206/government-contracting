import type { Config } from "tailwindcss";

/**
 * BROST CO brand theme, aligned to the marketing landing system:
 *   Ink #171713, Night #090a09 / #171813, Paper #f1ece3, Gold #c3a06b.
 * Dark shell powers nav + Today. Paper is the primary work surface.
 * Gold is decorative emphasis; accent (#7E5E33) is WCAG-safe gold-brown for text.
 * DM Sans is UI/body; GFS Didot is display; JetBrains Mono is micro labels.
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
        background: "#f1ece3", // Paper work surface (landing)
        foreground: "#171713", // Ink
        surface: "#f1ece3",
        "surface-raised": "#e9e3d8",
        muted: "#f1ece3",
        "muted-foreground": "#776f64",
        border: "#cdc3b5",
        "border-strong": "#c0b6a6",
        // Dark editorial shell (nav, Today, overlays)
        ink: "#090a09",
        shell: "#171813",
        "shell-border": "rgba(255,255,255,0.12)",
        // Semantic accent: a deepened, WCAG-AA gold-brown (4.5:1+ as text on the
        // page ground and with white text on filled controls). The pure brand
        // gold is exposed separately as `gold` for decorative, non-text emphasis
        // only (rules, borders, dots) - never large fields, never body text.
        accent: "#7E5E33",
        "accent-soft": "#F3ECE0",
        "accent-strong": "#6F5228",
        gold: "#c3a06b",
        "gold-deep": "#a68250",

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
          50: "#fbfaf7",
          100: "#f1ece3", // Paper
          200: "#cdc3b5",
          300: "#c0b6a6",
          400: "#A39C90",
          500: "#776f64",
          600: "#57524D",
          700: "#403C38",
          800: "#171713", // Ink
          900: "#11120f",
          950: "#090a09",
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
