/**
 * Capture 2x 1080p product stills and cut the Brost Co landing film.
 *
 * Requires: next dev on :3000, ffmpeg, playwright.
 *   node scripts/render-product-film.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const ROOT = process.cwd();
const STILLS = join(ROOT, ".theme-qa", "film-stills");
const OUT_DIR = join(ROOT, "public", "film");
const FPS = 30;
const W = 1920;
const H = 1080;
const SHOT_SEC = 5.6;
const FADE = 0.7;
const TITLE_SEC = 3.6;
const END_SEC = 4.0;
const CURSOR_SEC = 2.4;

const SHOTS = [
  {
    id: "today",
    kicker: "01  TODAY",
    caption: "Overnight, SAM.gov becomes one list of decisions that need a person.",
    zoom: 0.09,
    x: "iw/2-(iw/zoom/2)+160",
    y: "ih/2-(ih/zoom/2)-20",
    cursor: { x0: 980, y0: 260, x1: 1490, y1: 430 },
  },
  {
    id: "pipeline",
    kicker: "02  DISCOVERY",
    caption: "Every matching posting is scored against your company. Strong fits move on their own.",
    zoom: 0.08,
    x: "iw/2-(iw/zoom/2)-220",
    y: "ih/2-(ih/zoom/2)-40",
    cursor: { x0: 720, y0: 240, x1: 380, y1: 360 },
  },
  {
    id: "opportunity",
    kicker: "03  NEXT STEP",
    caption: "Score, deadline, and the next step. One screen.",
    zoom: 0.1,
    x: "iw/2-(iw/zoom/2)+200",
    y: "ih/2-(ih/zoom/2)+40",
    cursor: { x0: 900, y0: 300, x1: 1480, y1: 620 },
  },
  {
    id: "attention",
    kicker: "04  ATTENTION",
    caption: "What is blocked, what is waiting, and what only you can do.",
    zoom: 0.08,
    x: "iw/2-(iw/zoom/2)+80",
    y: "ih/2-(ih/zoom/2)+80",
    cursor: { x0: 860, y0: 280, x1: 1320, y1: 700 },
  },
  {
    id: "coverage",
    kicker: "05  SOURCING",
    caption: "Brost Co finds local trades and starts outreach before you sit down.",
    zoom: 0.07,
    x: "iw/2-(iw/zoom/2)+40",
    y: "ih/2-(ih/zoom/2)+30",
    cursor: { x0: 700, y0: 300, x1: 1280, y1: 620 },
  },
  {
    id: "call",
    kicker: "06  FOLLOW-UP",
    caption: "Email already ran. When a person is needed, the script is waiting.",
    zoom: 0.09,
    x: "iw/2-(iw/zoom/2)-80",
    y: "ih/2-(ih/zoom/2)+20",
    cursor: { x0: 1100, y0: 240, x1: 520, y1: 680 },
  },
  {
    id: "quotes",
    kicker: "07  PRICING",
    caption: "Quotes land in one place. Missing trades stay visible until coverage is complete.",
    zoom: 0.08,
    x: "iw/2-(iw/zoom/2)+120",
    y: "ih/2-(ih/zoom/2)+50",
    cursor: { x0: 900, y0: 280, x1: 1540, y1: 640 },
  },
  {
    id: "package",
    kicker: "08  BID PREP",
    caption: "The package assembles as documents come in. Compliance checks run on their own.",
    zoom: 0.08,
    x: "iw/2-(iw/zoom/2)-60",
    y: "ih/2-(ih/zoom/2)+40",
    cursor: { x0: 1100, y0: 260, x1: 760, y1: 680 },
  },
  {
    id: "submit",
    kicker: "09  SUBMISSION",
    caption: "You review and submit. Nothing goes out until you say so.",
    zoom: 0.09,
    x: "iw/2-(iw/zoom/2)-40",
    y: "ih/2-(ih/zoom/2)+30",
    cursor: { x0: 980, y0: 280, x1: 520, y1: 720 },
  },
  {
    id: "close",
    kicker: "10  TOMORROW",
    caption: "Today is waiting with the next human actions. The rest already ran.",
    zoom: 0.08,
    x: "iw/2-(iw/zoom/2)+140",
    y: "ih/2-(ih/zoom/2)-10",
    cursor: { x0: 900, y0: 250, x1: 1490, y1: 460 },
  },
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (${r.status})`);
}

function ff(...args) {
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

function ease(tEnd) {
  return `(1-pow(1-min(1\\,t/${tEnd})\\,3))`;
}

async function captureStills() {
  mkdirSync(STILLS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await page.addInitScript(() => {
    localStorage.setItem("brost.theme", "dark");
    document.cookie = "brost.theme=dark; Path=/; Max-Age=31536000; SameSite=Lax";
  });

  for (const shot of SHOTS) {
    const url = `${BASE}/theme-qa/film?shot=${shot.id}`;
    console.log("capture", shot.id);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: join(STILLS, `${shot.id}.png`),
      type: "png",
    });
  }

  await page.setContent(
    `<!doctype html>
<html><head>
<style>
  html,body{margin:0;width:72px;height:88px;background:transparent;overflow:hidden}
  svg{filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
</style></head><body>
<svg width="36" height="44" viewBox="0 0 26 32" fill="none">
  <path d="M2 2.2 2 24.4 8.2 18.8 12.4 29.2 16.1 27.7 11.8 17.1 20.6 16.8 2 2.2Z" fill="#f6f2eb" stroke="#171713" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
</body></html>`,
    { waitUntil: "load" }
  );
  await page.locator("svg").screenshot({
    path: join(STILLS, "cursor.png"),
    omitBackground: true,
  });

  await page.setViewportSize({ width: W, height: H });
  await page.setContent(
    `<!doctype html>
<html class="dark"><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600&family=GFS+Didot&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1920px;height:1080px;background:#090a09;color:#f5f1e9;overflow:hidden}
  .card{width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#090a09}
  img{height:92px;width:auto}
  .line{width:72px;height:1px;background:#c3a06b;margin:36px 0 28px}
  .k{font:500 13px/1.2 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:rgba(245,241,233,.55)}
</style></head><body>
<div class="card" id="title">
  <img src="${BASE}/brand/wordmark-light.png" alt="">
  <div class="line"></div>
  <div class="k">Automated Government Procurement Software</div>
</div>
</body></html>`,
    { waitUntil: "networkidle" }
  );
  await page.waitForTimeout(500);
  await page.locator("#title").screenshot({ path: join(STILLS, "title.png") });

  await page.setContent(
    `<!doctype html>
<html><head>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600&family=GFS+Didot&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1920px;height:1080px;background:#090a09;color:#f5f1e9;overflow:hidden}
  .card{width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#090a09}
  img{height:80px;width:auto}
  .line{width:72px;height:1px;background:#c3a06b;margin:32px 0 24px}
  .t{max-width:920px;text-align:center;font:400 44px/1.12 "GFS Didot",Georgia,serif;letter-spacing:-.02em}
  .k{margin-top:22px;font:500 13px/1.2 "JetBrains Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:rgba(245,241,233,.55)}
</style></head><body>
<div class="card" id="end">
  <img src="${BASE}/brand/wordmark-light.png" alt="">
  <div class="line"></div>
  <div class="t">The hard, slow parts are already done.</div>
  <div class="k">Start the 7-day free trial</div>
</div>
</body></html>`,
    { waitUntil: "networkidle" }
  );
  await page.waitForTimeout(500);
  await page.locator("#end").screenshot({ path: join(STILLS, "end.png") });

  await page.setViewportSize({ width: W, height: 280 });
  for (const shot of SHOTS) {
    const safeCap = shot.caption.replace(/</g, "");
    const safeK = shot.kicker.replace(/</g, "");
    await page.setContent(
      `<!doctype html>
<html><head>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1920px;height:280px;background:transparent;overflow:hidden}
  .bar{width:1920px;height:280px;padding:72px 80px 40px;box-sizing:border-box;
    background:linear-gradient(to top, rgba(9,10,9,.96) 0%, rgba(9,10,9,.82) 52%, rgba(9,10,9,0) 100%)}
  .k{font:500 12px/1.2 "JetBrains Mono",monospace;letter-spacing:.2em;color:#e0c08a}
  .c{margin-top:12px;max-width:1520px;font:500 28px/1.35 "DM Sans",sans-serif;color:#f6f2eb}
</style></head><body>
<div class="bar" id="bar"><div class="k">${safeK}</div><div class="c">${safeCap}</div></div>
</body></html>`,
      { waitUntil: "networkidle" }
    );
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(STILLS, `cap-${shot.id}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: W, height: 280 },
    });
  }

  await browser.close();
}

function kenBurns(input, output, frames, zoomEnd, x, y) {
  ff(
    "-loop",
    "1",
    "-i",
    input,
    "-vf",
    `scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=z='min(1+${zoomEnd}*on/${frames},1+${zoomEnd})':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
    "-t",
    (frames / FPS).toFixed(3),
    "-an",
    output
  );
}

function stillHold(input, output, seconds, fadeIn = 0.6) {
  const frames = Math.round(seconds * FPS);
  ff(
    "-loop",
    "1",
    "-i",
    input,
    "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='min(1+0.04*on/${frames},1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=${fadeIn},format=yuv420p`,
    "-t",
    String(seconds),
    "-an",
    output
  );
}

function grade(input, output) {
  ff(
    "-i",
    input,
    "-vf",
    "eq=contrast=1.05:gamma=0.98:saturation=0.93,unsharp=3:3:0.45,vignette=PI/5.5,format=yuv420p",
    "-an",
    output
  );
}

function cutFilm() {
  mkdirSync(OUT_DIR, { recursive: true });
  const clips = [];
  const titleClip = join(STILLS, "_title.mp4");
  stillHold(join(STILLS, "title.png"), titleClip, TITLE_SEC, 0.8);
  clips.push(titleClip);

  const cursorPng = join(STILLS, "cursor.png");
  SHOTS.forEach((shot) => {
    const raw = join(STILLS, `_${shot.id}.mp4`);
    const frames = Math.round(SHOT_SEC * FPS);
    kenBurns(join(STILLS, `${shot.id}.png`), raw, frames, shot.zoom, shot.x, shot.y);

    const withCursor = join(STILLS, `_${shot.id}_cur.mp4`);
    const e = ease(CURSOR_SEC);
    const { x0, y0, x1, y1 } = shot.cursor;
    ff(
      "-i",
      raw,
      "-i",
      cursorPng,
      "-filter_complex",
      `[1:v]scale=36:44[c];[0:v][c]overlay=x='${x0}+(${x1}-${x0})*${e}':y='${y0}+(${y1}-${y0})*${e}':format=auto`,
      "-an",
      withCursor
    );

    const graded = join(STILLS, `_${shot.id}_g.mp4`);
    grade(withCursor, graded);

    const cap = join(STILLS, `cap-${shot.id}.png`);
    const withCap = join(STILLS, `_${shot.id}_cap.mp4`);
    ff(
      "-i",
      graded,
      "-loop",
      "1",
      "-t",
      String(SHOT_SEC),
      "-i",
      cap,
      "-filter_complex",
      `[1:v]scale=${W}:-1,format=rgba,fade=t=in:st=0.12:d=0.35:alpha=1[c];[0:v][c]overlay=0:H-h:format=auto,format=yuv420p`,
      "-an",
      withCap
    );
    clips.push(withCap);
  });

  const endClip = join(STILLS, "_end.mp4");
  stillHold(join(STILLS, "end.png"), endClip, END_SEC, 0.7);
  clips.push(endClip);

  const inputs = [];
  clips.forEach((c) => inputs.push("-i", c));
  let filter = "";
  let prev = "[0:v]";
  let acc = TITLE_SEC;
  for (let i = 1; i < clips.length; i++) {
    const out = i === clips.length - 1 ? "[vout]" : `[v${i}]`;
    const offset = Math.max(0.1, acc - FADE);
    filter += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${out};`;
    prev = out;
    acc += (i === clips.length - 1 ? END_SEC : SHOT_SEC) - FADE;
  }
  filter = filter.replace(/;$/, "");

  const master = join(STILLS, "_master.mp4");
  ff(
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "17",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    master
  );

  const mp4 = join(OUT_DIR, "workflow.mp4");
  const webm = join(OUT_DIR, "workflow.webm");
  const poster = join(OUT_DIR, "poster.jpg");
  ff("-i", master, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4);
  ff("-i", master, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "31", "-row-mt", "1", "-an", webm);
  ff("-i", master, "-ss", "5.1", "-frames:v", "1", "-q:v", "2", poster);

  const vtt = `WEBVTT

${SHOTS.map((s, i) => {
  const start = TITLE_SEC + i * (SHOT_SEC - FADE);
  const end = start + SHOT_SEC - 0.25;
  const fmt = (t) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  };
  return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${s.caption}\n`;
}).join("\n")}`;
  writeFileSync(join(OUT_DIR, "workflow.vtt"), vtt);
  console.log("wrote", mp4, webm, poster);
}

async function main() {
  if (!existsSync(join(ROOT, "public", "brand", "wordmark-light.png"))) {
    throw new Error("Missing public/brand/wordmark-light.png");
  }
  if (!process.argv.includes("--cut-only")) {
    await captureStills();
  }
  cutFilm();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
