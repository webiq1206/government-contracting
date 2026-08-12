/**
 * Render the Brost Co landing product film.
 *
 * The film set at /theme-qa/film is a pure function of time: we seek to an
 * exact timestamp, screenshot, and repeat. That makes the render deterministic
 * and lets the interface genuinely respond to the cursor rather than being
 * panned over as a still.
 *
 * Requires: next dev on :3000, ffmpeg, playwright.
 *   node scripts/render-product-film.mjs
 *   node scripts/render-product-film.mjs --cut-only   (reuse existing frames)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

const BASE = process.argv.find((a) => a.startsWith("http")) || "http://127.0.0.1:3000";
const ROOT = process.cwd();
const FRAMES = join(ROOT, ".theme-qa", "film-frames");
const OUT_DIR = join(ROOT, "public", "film");
const FPS = 30;
const W = 1920;
const H = 1080;

/** This repl pins Playwright to the Nix-provided Chromium. */
const CHROME_ARGS = [
  "--no-sandbox",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
];

function launch() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: CHROME_ARGS,
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (${r.status})`);
}

function ff(...args) {
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

function fmtTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

async function captureFrames() {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce", // our motion is time-driven, not CSS-driven
  });
  await page.addInitScript(() => {
    localStorage.setItem("brost.theme", "dark");
    document.cookie = "brost.theme=dark; Path=/; Max-Age=31536000; SameSite=Lax";
  });

  await page.goto(`${BASE}/theme-qa/film`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.__filmReady === true, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  const duration = await page.evaluate(() => window.__filmDuration);
  const total = Math.floor(duration * FPS);
  console.log(`film ${duration.toFixed(2)}s · ${total} frames @ ${FPS}fps`);

  const stage = page.locator("#film-frame");
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((time) => window.__filmSeek(time), t);
    await stage.screenshot({
      path: join(FRAMES, `f${String(i).padStart(5, "0")}.jpg`),
      type: "jpeg",
      quality: 95,
      animations: "disabled",
    });
    if (i % 60 === 0) {
      process.stdout.write(`  frame ${i}/${total} (${((i / total) * 100).toFixed(0)}%)\r`);
    }
  }
  process.stdout.write(`  frame ${total}/${total} (100%)\n`);

  await browser.close();
  return { duration, total };
}

function encode() {
  mkdirSync(OUT_DIR, { recursive: true });
  const count = readdirSync(FRAMES).filter((f) => f.endsWith(".jpg")).length;
  if (!count) throw new Error("no frames captured");
  console.log(`encoding ${count} frames`);

  const seq = join(FRAMES, "f%05d.jpg");
  const master = join(FRAMES, "_master.mp4");

  // Master: visually lossless, mild sharpen to keep small UI text crisp.
  ff(
    "-framerate", String(FPS),
    "-i", seq,
    "-vf", "unsharp=3:3:0.35:3:3:0.0,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "15",
    "-pix_fmt", "yuv420p",
    "-an",
    master
  );

  // Desktop 1080p.
  ff(
    "-i", master,
    "-c:v", "libx264", "-preset", "slow", "-crf", "21",
    "-maxrate", "3200k", "-bufsize", "6400k",
    "-profile:v", "high", "-level", "4.0",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    join(OUT_DIR, "workflow.mp4")
  );
  // Mobile 720p: same framing, much lighter so playback starts fast.
  ff(
    "-i", master,
    "-vf", "scale=1280:720:flags=lanczos",
    "-c:v", "libx264", "-preset", "slow", "-crf", "25",
    "-maxrate", "1400k", "-bufsize", "2800k",
    "-profile:v", "main", "-level", "3.1",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    join(OUT_DIR, "workflow-mobile.mp4")
  );

  return master;
}

/** Poster: a real product frame from the first beat, never the bumper. */
function poster(master, at) {
  ff("-ss", String(at), "-i", master, "-frames:v", "1", "-q:v", "3", join(OUT_DIR, "poster.jpg"));
}

function writeVtt(beats) {
  const cues = beats
    .map((b, i) => `${i + 1}\n${fmtTime(b.start + 0.12)} --> ${fmtTime(b.start + b.dur - 0.2)}\n${b.caption}\n`)
    .join("\n");
  writeFileSync(join(OUT_DIR, "workflow.vtt"), `WEBVTT\n\n${cues}`);
}

async function main() {
  let beats = null;
  if (!process.argv.includes("--cut-only")) {
    await captureFrames();
    // Capture and encode can be run as separate passes; each stage is long
    // enough that splitting them keeps a single run inside a shell timeout.
    if (process.argv.includes("--capture-only")) {
      console.log("frames captured; run with --cut-only to encode");
      return;
    }
  }
  // Beat timings come from the film set so captions can never drift from the cut.
  const browser = await launch();
  const p = await browser.newPage();
  await p.goto(`${BASE}/theme-qa/film`, { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForFunction(() => window.__filmReady === true, null, { timeout: 30000 });
  beats = await p.evaluate(() => window.__filmBeats);
  await browser.close();

  const master = encode();
  poster(master, beats[0].start + 1.8);
  writeVtt(beats);
  console.log("wrote", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
