"use client";

/**
 * Film set for the landing product film.
 *
 * Everything here is a pure function of `t` (seconds). The capture script
 * seeks to an exact time via `window.__filmSeek(t)` and screenshots the frame,
 * which makes the render deterministic and lets the interface actually respond
 * to the cursor instead of being panned over as a still.
 *
 * Type is sized for video, not for a desktop browser. On a 390px phone the
 * frame is ~358px wide, so in-frame text must be roughly 5x its normal UI size
 * to stay readable. Each beat therefore shows one focused slice of product.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ATTENTION,
  COVERAGE,
  HERO,
  INTAKE,
  OUTREACH,
  PACKAGE_ITEMS,
  QUOTES,
  SCORE_FACTORS,
  SUBS,
  TODAY,
  TODAY_AUTOMATED,
} from "./film-data";

/* ------------------------------------------------------------------ timing */

export const FPS = 30;
const BUMPER = 0.9;
const ENDCARD = 2.8;
const TRANS = 0.42;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const easeInOut = (v: number) => {
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Local reveal ramp: 0 before `start`, eased to 1 across `dur`. */
const reveal = (local: number, start: number, dur = 0.5) =>
  easeOut((local - start) / dur);

/** Staggered reveal for list item `i`. */
const stagger = (local: number, i: number, start = 0.25, gap = 0.14, dur = 0.5) =>
  reveal(local, start + i * gap, dur);

/* ------------------------------------------------------------------ cursor */

type CursorKey = { t: number; x: number; y: number; click?: boolean };

function cursorAt(keys: CursorKey[] | undefined, local: number) {
  if (!keys || keys.length === 0) return null;
  if (local <= keys[0].t) return { x: keys[0].x, y: keys[0].y, press: 0 };
  const last = keys[keys.length - 1];
  if (local >= last.t) return { x: last.x, y: last.y, press: pressAt(keys, local) };
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (local >= keys[i].t && local <= keys[i + 1].t) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const e = easeInOut((local - a.t) / span);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, press: pressAt(keys, local) };
}

/** Click pulse: 1 right at a click keyframe, decaying over 0.4s. */
function pressAt(keys: CursorKey[], local: number) {
  let best = 0;
  for (const k of keys) {
    if (!k.click) continue;
    const d = local - k.t;
    if (d >= 0 && d < 0.4) best = Math.max(best, 1 - d / 0.4);
  }
  return best;
}

/** True once a click keyframe at/before `local` has fired. */
const clicked = (keys: CursorKey[] | undefined, local: number) =>
  !!keys?.some((k) => k.click && local >= k.t);

/* ------------------------------------------------------------- primitives */

const CREAM = "#f6f2eb";
const MUTED = "rgba(246,242,235,.60)";
const GOLD = "#c3a06b";
const PURSUE = "#8a9e80";
const REVIEW = "#d4a868";
const SURFACE = "#171813";
const RAISED = "#1e1f1c";
const HAIR = "rgba(255,255,255,.13)";

const mono = '"JetBrains Mono", ui-monospace, monospace';
const sans = '"DM Sans", system-ui, sans-serif';
const serif = '"GFS Didot", Georgia, serif';

function Label({ children, color = GOLD }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        font: `500 32px/1.2 ${mono}`,
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

/** Panel styled like the app's surface cards, sized for the frame. */
function Panel({
  children,
  accent,
  style,
}: {
  children: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${accent ? `${accent}66` : HAIR}`,
        borderLeft: accent ? `5px solid ${accent}` : `1px solid ${HAIR}`,
        padding: "38px 44px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Row that lights up like a real hovered/active list row. */
function Row({
  children,
  on,
  tone = GOLD,
  style,
}: {
  children: React.ReactNode;
  on?: number;
  tone?: string;
  style?: React.CSSProperties;
}) {
  const a = clamp01(on ?? 0);
  return (
    <div
      style={{
        display: "grid",
        alignItems: "center",
        gap: 28,
        padding: "26px 32px",
        borderBottom: `1px solid ${HAIR}`,
        background: a ? `${tone}${Math.round(a * 26).toString(16).padStart(2, "0")}` : "transparent",
        boxShadow: a ? `inset 4px 0 0 ${tone}` : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        font: `500 30px/1 ${mono}`,
        letterSpacing: ".12em",
        textTransform: "uppercase",
        color: tone,
        border: `1px solid ${tone}66`,
        background: `${tone}1f`,
        padding: "10px 16px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Btn({
  text,
  tone,
  press = 0,
  solid,
  target,
}: {
  text: string;
  tone: string;
  press?: number;
  solid?: boolean;
  /** Marks the click target so cursor keyframes can be measured, not guessed. */
  target?: string;
}) {
  return (
    <span
      data-film-target={target}
      style={{
        display: "inline-block",
        font: `600 30px/1 ${sans}`,
        color: solid ? "#12130f" : tone,
        background: solid ? tone : `${tone}1f`,
        border: `1px solid ${tone}`,
        padding: "20px 34px",
        transform: `scale(${1 - press * 0.045})`,
        boxShadow: press ? `0 0 0 ${press * 12}px ${tone}22` : "none",
      }}
    >
      {text}
    </span>
  );
}

/* ---------------------------------------------------------------- scenes */

type SceneProps = { p: number; local: number; cursor?: CursorKey[] };

/** 01 — postings arrive from SAM.gov and get scored. */
function SceneIntake({ local }: SceneProps) {
  const found = Math.round(easeOut((local - 0.3) / 1.6) * 214);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 620px", gap: 56, alignItems: "start" }}>
      <div>
        <Label>SAM.gov intake · overnight</Label>
        <div style={{ marginTop: 20, border: `1px solid ${HAIR}`, background: SURFACE }}>
          {INTAKE.map((o, i) => {
            const a = stagger(local, i, 0.35, 0.19, 0.45);
            return (
              <div
                key={o.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 260px",
                  gap: 24,
                  alignItems: "center",
                  padding: "14px 30px",
                  borderBottom: i < INTAKE.length - 1 ? `1px solid ${HAIR}` : "none",
                  opacity: a,
                  transform: `translateY(${(1 - a) * 16}px)`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: `500 36px/1.25 ${sans}`, color: CREAM }}>{o.title}</div>
                  <div style={{ marginTop: 6, font: `400 33px/1.2 ${sans}`, color: MUTED }}>
                    {o.agency}
                  </div>
                </div>
                <div style={{ font: `600 34px/1 ${sans}`, color: GOLD, textAlign: "right" }}>
                  {o.value}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Panel accent={PURSUE} style={{ padding: "44px 46px" }}>
        <Label color={PURSUE}>Scanned while you slept</Label>
        <div style={{ marginTop: 20, font: `400 122px/1 ${serif}`, color: CREAM }}>{found}</div>
        <div style={{ marginTop: 10, font: `400 34px/1.35 ${sans}`, color: MUTED }}>
          postings read and matched against your profile
        </div>
        <div style={{ marginTop: 34, paddingTop: 30, borderTop: `1px solid ${HAIR}` }}>
          <div style={{ font: `500 38px/1.3 ${sans}`, color: CREAM }}>
            {Math.round(easeOut((local - 1.3) / 1.2) * INTAKE.length)} worth pursuing
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** 02 — the fit score, and what it is made of. */
function SceneScore({ local }: SceneProps) {
  const score = Math.round(easeOut((local - 0.35) / 1.3) * HERO.score);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "560px 1fr", gap: 60, alignItems: "start" }}>
      <div
        style={{
          border: `1px solid ${GOLD}80`,
          background: SURFACE,
          padding: "46px 44px",
          textAlign: "center",
        }}
      >
        <Label>Fit score</Label>
        <div style={{ font: `400 210px/1 ${serif}`, color: GOLD, marginTop: 8 }}>{score}</div>
        <div style={{ font: `500 34px/1.3 ${sans}`, color: CREAM, marginTop: 6 }}>Strong fit</div>
        <div
          style={{
            marginTop: 28,
            paddingTop: 26,
            borderTop: `1px solid ${HAIR}`,
            font: `400 33px/1.5 ${sans}`,
            color: MUTED,
          }}
        >
          {HERO.agency}
          <br />
          NAICS {HERO.naics} · {HERO.setAside}
        </div>
      </div>
      <div>
        <Label>How the score was reached</Label>
        <div style={{ marginTop: 26 }}>
          {SCORE_FACTORS.map((f, i) => {
            const a = stagger(local, i, 0.5, 0.18, 0.55);
            const pct = (f.weight / f.of) * a;
            return (
              <div key={f.label} style={{ marginBottom: 30, opacity: clamp01(a * 1.4) }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ font: `500 34px/1.2 ${sans}`, color: CREAM }}>{f.label}</span>
                  <span style={{ font: `400 33px/1.2 ${sans}`, color: MUTED }}>{f.detail}</span>
                </div>
                <div style={{ marginTop: 12, height: 14, background: RAISED, position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${pct * 100}%`,
                      background: GOLD,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 03 — current status and the one next step. Human decision. */
function SceneNextStep({ local, cursor }: SceneProps) {
  const hit = clicked(cursor, local);
  const press = cursorAt(cursor, local)?.press ?? 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 40 }}>
        <div>
          <Label>Opportunity · IFB {HERO.solicitation}</Label>
          <div style={{ marginTop: 16, font: `400 76px/1.05 ${serif}`, color: CREAM }}>
            {HERO.title}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ font: `400 84px/1 ${serif}`, color: GOLD }}>{HERO.score}</div>
          <div style={{ font: `500 30px/1.2 ${mono}`, letterSpacing: ".16em", color: MUTED }}>
            FIT SCORE
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 56, marginTop: 34, paddingTop: 30, borderTop: `1px solid ${HAIR}` }}>
        {[
          ["Estimate", HERO.value],
          ["Set-aside", HERO.setAside],
          ["Deadline", `${HERO.dueLabel} · ${HERO.daysLeft}d`],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ font: `500 30px/1.2 ${mono}`, letterSpacing: ".16em", color: GOLD }}>
              {k.toUpperCase()}
            </div>
            <div style={{ marginTop: 10, font: `500 38px/1.2 ${sans}`, color: CREAM }}>{v}</div>
          </div>
        ))}
      </div>

      <Panel
        accent={hit ? PURSUE : REVIEW}
        style={{ marginTop: 40, opacity: reveal(local, 0.3, 0.5), padding: "40px 46px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 44 }}>
          <div>
            <Pill text={hit ? "Pursued" : "Action required"} tone={hit ? PURSUE : REVIEW} />
            <div style={{ marginTop: 20, font: `500 46px/1.25 ${sans}`, color: CREAM }}>
              {hit ? "Outreach starting now" : "Pursue or pass"}
            </div>
            <div style={{ marginTop: 10, font: `400 31px/1.4 ${sans}`, color: MUTED }}>
              {hit
                ? "Brost Co is finding and contacting local trades."
                : "Scored, read, and summarised. The call is yours."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, flexShrink: 0 }}>
            <Btn text="Pursue" tone={PURSUE} solid press={hit ? press : 0} target="pursue" />
            {!hit && <Btn text="Pass" tone="rgba(246,242,235,.45)" />}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** 04 — what ran itself vs what is waiting on a person. */
function SceneAttention({ local }: SceneProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
      <Panel accent={PURSUE} style={{ padding: "40px 44px" }}>
        <Label color={PURSUE}>Ran automatically</Label>
        <div style={{ marginTop: 26 }}>
          {ATTENTION.ranAutomatically.map((item, i) => {
            const a = stagger(local, i, 0.25, 0.13, 0.4);
            return (
              <div
                key={item}
                style={{
                  display: "flex",
                  gap: 20,
                  alignItems: "center",
                  padding: "20px 0",
                  borderBottom: i < ATTENTION.ranAutomatically.length - 1 ? `1px solid ${HAIR}` : "none",
                  opacity: a,
                  transform: `translateX(${(1 - a) * -14}px)`,
                }}
              >
                <span style={{ color: PURSUE, font: `500 34px/1 ${sans}` }}>✓</span>
                <span style={{ font: `400 34px/1.3 ${sans}`, color: MUTED }}>{item}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel accent={GOLD} style={{ padding: "40px 44px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label>Needs you</Label>
          <span style={{ font: `400 54px/1 ${serif}`, color: GOLD }}>
            {ATTENTION.needsYou.length}
          </span>
        </div>
        <div style={{ marginTop: 26 }}>
          {ATTENTION.needsYou.map((item, i) => {
            const a = stagger(local, i, 0.95, 0.28, 0.5);
            return (
              <div
                key={item.title}
                style={{
                  background: `${GOLD}14`,
                  border: `1px solid ${GOLD}4d`,
                  padding: "28px 30px",
                  marginBottom: 20,
                  opacity: a,
                  transform: `translateY(${(1 - a) * 18}px)`,
                }}
              >
                <div style={{ font: `500 40px/1.25 ${sans}`, color: CREAM }}>{item.title}</div>
                <div style={{ marginTop: 8, font: `400 33px/1.3 ${sans}`, color: MUTED }}>
                  {item.detail}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 16, font: `400 33px/1.4 ${sans}`, color: MUTED }}>
          Everything else is already moving.
        </div>
      </Panel>
    </div>
  );
}

/** 05 — local trades found and matched by trade and distance. */
function SceneSourcing({ local }: SceneProps) {
  const stageTone: Record<string, string> = {
    quoted: PURSUE,
    calling: GOLD,
    contacted: "rgba(246,242,235,.5)",
  };
  const stageText: Record<string, string> = {
    quoted: "Quote in",
    calling: "Call queued",
    contacted: "Emailed",
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 64, marginBottom: 24 }}>
        {[
          ["Found", "11"],
          ["Contacted", "9"],
          ["Quotes in", "3"],
        ].map(([k, v], i) => (
          <div key={k} style={{ opacity: stagger(local, i, 0.15, 0.12, 0.4) }}>
            <div style={{ font: `500 30px/1.2 ${mono}`, letterSpacing: ".16em", color: GOLD }}>
              {k.toUpperCase()}
            </div>
            <div style={{ marginTop: 8, font: `400 60px/1 ${serif}`, color: CREAM }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ border: `1px solid ${HAIR}`, background: SURFACE }}>
        {SUBS.map((s, i) => {
          const a = stagger(local, i, 0.4, 0.15, 0.45);
          return (
            <div
              key={s.name}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 330px 190px 250px",
                gap: 24,
                alignItems: "center",
                padding: "19px 32px",
                borderBottom: i < SUBS.length - 1 ? `1px solid ${HAIR}` : "none",
                opacity: a,
                transform: `translateY(${(1 - a) * 14}px)`,
              }}
            >
              <div style={{ font: `500 36px/1.2 ${sans}`, color: CREAM }}>{s.name}</div>
              <div style={{ font: `400 31px/1.2 ${sans}`, color: MUTED }}>{s.trade}</div>
              <div style={{ font: `400 31px/1.2 ${sans}`, color: MUTED }}>{s.miles} mi</div>
              <div style={{ textAlign: "right" }}>
                <Pill text={stageText[s.stage]} tone={stageTone[s.stage]} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 06 — outreach ran on its own, then escalated to a call. */
function SceneFollowUp({ local }: SceneProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 640px", gap: 56, alignItems: "start" }}>
      <div>
        <Label>Valley Electric · electrical</Label>
        <div style={{ marginTop: 26 }}>
          {OUTREACH.map((e, i) => {
            const a = stagger(local, i, 0.3, 0.34, 0.5);
            const tone = e.auto ? PURSUE : GOLD;
            return (
              <div
                key={e.when}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px 1fr",
                  gap: 28,
                  opacity: a,
                  transform: `translateY(${(1 - a) * 14}px)`,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: tone,
                      marginTop: 12,
                      flexShrink: 0,
                    }}
                  />
                  {i < OUTREACH.length - 1 && (
                    <span style={{ flex: 1, width: 2, background: HAIR, minHeight: 46 }} />
                  )}
                </div>
                <div style={{ paddingBottom: 30 }}>
                  <div style={{ font: `500 38px/1.25 ${sans}`, color: CREAM }}>{e.what}</div>
                  <div style={{ marginTop: 6, font: `400 33px/1.3 ${sans}`, color: MUTED }}>
                    {e.when} · {e.who}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Panel
        accent={GOLD}
        style={{ opacity: reveal(local, 1.5, 0.5), padding: "40px 44px" }}
      >
        <Label>Call script ready</Label>
        <div style={{ marginTop: 18, font: `400 56px/1.1 ${serif}`, color: CREAM }}>
          Valley Electric
        </div>
        <div style={{ marginTop: 12, font: `400 33px/1.35 ${sans}`, color: MUTED }}>
          Dana Ruiz · Estimator
          <br />
          (208) 555-0144
        </div>
        <div
          style={{
            marginTop: 28,
            padding: "26px 28px",
            background: RAISED,
            border: `1px solid ${HAIR}`,
            font: `400 30px/1.5 ${sans}`,
            color: CREAM,
          }}
        >
          “Firm electrical quote for Boise VA HVAC, IFB 36C. Panel work and
          controls power, buildings 12 and 14.”
        </div>
      </Panel>
    </div>
  );
}

/** 07 — quotes landing in one place with amounts. */
function ScenePricing({ local, p }: SceneProps) {
  const inCount = QUOTES.filter((q) => p >= q.at).length;
  const total = QUOTES.filter((q) => p >= q.at).reduce(
    (s, q) => s + Number(q.amount.replace(/[$,]/g, "")),
    0
  );
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
        <Label>Quotes received</Label>
        <div style={{ textAlign: "right" }}>
          <span style={{ font: `400 34px/1 ${sans}`, color: MUTED }}>Bid total </span>
          <span style={{ font: `600 54px/1 ${sans}`, color: GOLD }}>
            ${total.toLocaleString("en-US")}
          </span>
        </div>
      </div>
      <div style={{ border: `1px solid ${HAIR}`, background: SURFACE }}>
        {QUOTES.map((q, i) => {
          const on = p >= q.at;
          const a = easeOut((p - q.at) / 0.1);
          return (
            <div
              key={q.company}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 400px 330px",
                gap: 24,
                alignItems: "center",
                padding: "32px 34px",
                borderBottom: i < QUOTES.length - 1 ? `1px solid ${HAIR}` : "none",
                background: on && a < 1 ? `${PURSUE}${Math.round((1 - a) * 40).toString(16).padStart(2, "0")}` : "transparent",
              }}
            >
              <div style={{ font: `500 38px/1.2 ${sans}`, color: on ? CREAM : MUTED }}>
                {q.company}
              </div>
              <div style={{ font: `400 31px/1.2 ${sans}`, color: MUTED }}>{q.trade}</div>
              <div style={{ textAlign: "right" }}>
                {on ? (
                  <span
                    style={{
                      font: `600 44px/1 ${sans}`,
                      color: CREAM,
                      opacity: a,
                      display: "inline-block",
                      transform: `translateY(${(1 - a) * 10}px)`,
                    }}
                  >
                    {q.amount}
                  </span>
                ) : (
                  <span style={{ font: `400 31px/1 ${sans}`, color: "rgba(246,242,235,.35)" }}>
                    awaiting
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 26, font: `400 31px/1.4 ${sans}`, color: MUTED }}>
        {inCount} of {QUOTES.length} trades priced · captured from replies automatically
      </div>
    </div>
  );
}

/** 08 — coverage completes and the bid becomes submittable. */
function SceneCoverage({ local, p }: SceneProps) {
  const filled = COVERAGE.map((c, i) => (c.done ? true : p > 0.45));
  const pct = Math.round((filled.filter(Boolean).length / COVERAGE.length) * 100);
  const ready = pct === 100;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 640px", gap: 56, alignItems: "start" }}>
      <div>
        <Label>Trade coverage</Label>
        <div style={{ marginTop: 26, border: `1px solid ${HAIR}`, background: SURFACE }}>
          {COVERAGE.map((c, i) => (
            <Row
              key={c.trade}
              on={filled[i] ? 0.55 : 0}
              tone={filled[i] ? PURSUE : GOLD}
              style={{
                gridTemplateColumns: "1fr 300px",
                borderBottom: i < COVERAGE.length - 1 ? `1px solid ${HAIR}` : "none",
                padding: "30px 32px",
              }}
            >
              <span style={{ font: `500 38px/1.2 ${sans}`, color: CREAM }}>{c.trade}</span>
              <span style={{ textAlign: "right" }}>
                <Pill
                  text={filled[i] ? "Covered" : "Open"}
                  tone={filled[i] ? PURSUE : GOLD}
                />
              </span>
            </Row>
          ))}
        </div>
      </div>
      <Panel accent={ready ? PURSUE : GOLD} style={{ padding: "44px 46px" }}>
        <Label color={ready ? PURSUE : GOLD}>Submission readiness</Label>
        <div style={{ marginTop: 18, font: `400 150px/1 ${serif}`, color: ready ? PURSUE : GOLD }}>
          {pct}%
        </div>
        <div style={{ height: 16, background: RAISED, marginTop: 12 }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: ready ? PURSUE : GOLD,
              transition: "none",
            }}
          />
        </div>
        <div style={{ marginTop: 26, font: `500 38px/1.35 ${sans}`, color: CREAM }}>
          {ready ? "Every required trade is priced" : "One trade still open"}
        </div>
      </Panel>
    </div>
  );
}

/** 09 — the bid package assembles itself. */
function ScenePackage({ local }: SceneProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 560px", gap: 56, alignItems: "start" }}>
      <div>
        <Label>Bid package</Label>
        <div style={{ marginTop: 20, border: `1px solid ${HAIR}`, background: SURFACE }}>
          {PACKAGE_ITEMS.map((it, i) => {
            const a = stagger(local, i, 0.3, 0.24, 0.45);
            const tone = it.auto ? PURSUE : GOLD;
            return (
              <div
                key={it.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "58px 1fr 300px",
                  gap: 24,
                  alignItems: "center",
                  padding: "16px 32px",
                  borderBottom: i < PACKAGE_ITEMS.length - 1 ? `1px solid ${HAIR}` : "none",
                  background: !it.auto && a > 0.5 ? `${GOLD}14` : "transparent",
                  opacity: clamp01(a * 1.3),
                }}
              >
                <span style={{ color: tone, font: `500 40px/1 ${sans}`, opacity: a }}>
                  {it.auto ? "✓" : "△"}
                </span>
                <div>
                  <div style={{ font: `500 36px/1.2 ${sans}`, color: CREAM }}>{it.label}</div>
                  <div style={{ marginTop: 6, font: `400 33px/1.2 ${sans}`, color: MUTED }}>
                    {it.detail}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <Pill text={it.auto ? "Automatic" : "You"} tone={tone} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          border: `1px solid ${GOLD}80`,
          background: SURFACE,
          padding: "56px 44px",
          textAlign: "center",
          opacity: reveal(local, 1.1, 0.6),
        }}
      >
        <div style={{ font: `400 66px/1.05 ${serif}`, color: CREAM }}>IFB 36C</div>
        <div style={{ marginTop: 14, font: `400 30px/1.3 ${sans}`, color: MUTED }}>
          {HERO.title}
        </div>
        <div style={{ marginTop: 32, paddingTop: 30, borderTop: `1px solid ${HAIR}` }}>
          <div style={{ font: `400 92px/1 ${serif}`, color: GOLD }}>18/18</div>
          <div style={{ marginTop: 10, font: `500 32px/1.2 ${mono}`, letterSpacing: ".16em", color: MUTED }}>
            COMPLIANCE ITEMS
          </div>
        </div>
      </div>
    </div>
  );
}

/** 10 — nothing is sent without the operator. */
function SceneSubmit({ local, cursor }: SceneProps) {
  const hit = clicked(cursor, local);
  const press = cursorAt(cursor, local)?.press ?? 0;
  return (
    <div style={{ maxWidth: 1380, margin: "0 auto" }}>
      <Panel accent={hit ? PURSUE : GOLD} style={{ padding: "52px 56px" }}>
        <Label color={hit ? PURSUE : GOLD}>Final review</Label>
        <div style={{ marginTop: 20, font: `400 68px/1.1 ${serif}`, color: CREAM }}>
          {hit ? "Marked as submitted" : "Nothing goes out until you send it"}
        </div>
        <div style={{ marginTop: 18, font: `400 34px/1.45 ${sans}`, color: MUTED, maxWidth: 1080 }}>
          The package is complete. Brost Co will not file to the agency on your
          behalf. You submit through the agency channel, then mark it sent here.
        </div>

        <div style={{ display: "flex", gap: 72, marginTop: 40, paddingTop: 34, borderTop: `1px solid ${HAIR}` }}>
          {[
            ["Bid total", "$304,300"],
            ["Method", "Contracting officer"],
            ["Deadline", "Aug 24 · 2:00 PM MT"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ font: `500 30px/1.2 ${mono}`, letterSpacing: ".16em", color: GOLD }}>
                {k.toUpperCase()}
              </div>
              <div style={{ marginTop: 10, font: `500 38px/1.2 ${sans}`, color: CREAM }}>{v}</div>
            </div>
          ))}
          <div style={{ marginLeft: "auto", alignSelf: "center" }}>
            <Btn
              text={hit ? "Submitted" : "Mark submitted"}
              tone={PURSUE}
              solid
              press={press}
              target="submit"
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** 11 — the Today list: only what a person has to do. */
function SceneToday({ local }: SceneProps) {
  const handled = Math.round(easeOut((local - 1.2) / 1.2) * TODAY_AUTOMATED);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 30 }}>
        <div>
          <Label>Today</Label>
          <div style={{ marginTop: 14, font: `400 72px/1.05 ${serif}`, color: CREAM }}>
            Two things need you
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ font: `400 78px/1 ${serif}`, color: PURSUE }}>{handled}</div>
          <div style={{ font: `500 30px/1.3 ${mono}`, letterSpacing: ".14em", color: MUTED }}>
            HANDLED FOR YOU
          </div>
        </div>
      </div>
      <div>
        {TODAY.map((t, i) => {
          const a = stagger(local, i, 0.3, 0.3, 0.5);
          return (
            <div
              key={t.title}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 340px",
                gap: 32,
                alignItems: "center",
                background: SURFACE,
                border: `1px solid ${HAIR}`,
                borderLeft: `5px solid ${GOLD}`,
                padding: "34px 40px",
                marginBottom: 22,
                opacity: a,
                transform: `translateY(${(1 - a) * 20}px)`,
              }}
            >
              <div>
                <div style={{ font: `500 30px/1.2 ${mono}`, letterSpacing: ".16em", color: GOLD }}>
                  {t.kicker.toUpperCase()}
                </div>
                <div style={{ marginTop: 12, font: `500 46px/1.2 ${sans}`, color: CREAM }}>
                  {t.title}
                </div>
                <div style={{ marginTop: 8, font: `400 30px/1.3 ${sans}`, color: MUTED }}>
                  {t.meta}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Btn text={t.cta} tone={GOLD} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ beats */

type Beat = {
  id: string;
  kicker: string;
  caption: string;
  tag: "auto" | "you";
  dur: number;
  Scene: (p: SceneProps) => JSX.Element;
  cursor?: CursorKey[];
};

export const BEATS: Beat[] = [
  {
    id: "discovery",
    kicker: "01 · Discovery",
    caption: "Every new SAM.gov posting is read and matched to your company overnight.",
    tag: "auto",
    dur: 4.4,
    Scene: SceneIntake,
  },
  {
    id: "scoring",
    kicker: "02 · Analysis & scoring",
    caption: "Each one gets a fit score you can trace: NAICS, set-aside, past work, distance.",
    tag: "auto",
    dur: 4.6,
    Scene: SceneScore,
  },
  {
    id: "next-step",
    kicker: "03 · Status & next step",
    caption: "You get one decision, not a research project. Pursue or pass.",
    tag: "you",
    dur: 5.0,
    Scene: SceneNextStep,
    // Coordinates are measured from the rendered button, not eyeballed.
    cursor: [
      { t: 0.2, x: 1210, y: 340 },
      { t: 1.9, x: 1558, y: 631 },
      { t: 2.5, x: 1558, y: 631, click: true },
      { t: 4.4, x: 1558, y: 631 },
    ],
  },
  {
    id: "attention",
    kicker: "04 · Attention",
    caption: "The work splits itself: what already ran, and the short list that needs a person.",
    tag: "auto",
    dur: 4.6,
    Scene: SceneAttention,
  },
  {
    id: "sourcing",
    kicker: "05 · Subcontractor sourcing",
    caption: "Local trades are found, ranked, and contacted before you sit down.",
    tag: "auto",
    dur: 4.6,
    Scene: SceneSourcing,
  },
  {
    id: "followup",
    kicker: "06 · Contact & follow-up",
    caption: "Emails and follow-ups send themselves. Silence becomes a call with a script ready.",
    tag: "auto",
    dur: 5.0,
    Scene: SceneFollowUp,
  },
  {
    id: "pricing",
    kicker: "07 · Quotes & pricing",
    caption: "Quotes are captured from replies and totalled as they arrive.",
    tag: "auto",
    dur: 5.0,
    Scene: ScenePricing,
  },
  {
    id: "coverage",
    kicker: "08 · Coverage & readiness",
    caption: "No trade is forgotten. The bid is not submittable until coverage is complete.",
    tag: "auto",
    dur: 4.6,
    Scene: SceneCoverage,
  },
  {
    id: "package",
    kicker: "09 · Bid preparation",
    caption: "Pricing, certifications, and all 18 compliance items assemble on their own.",
    tag: "auto",
    dur: 4.8,
    Scene: ScenePackage,
  },
  {
    id: "submit",
    kicker: "10 · Final review",
    caption: "Nothing reaches the agency without you. You review, you send.",
    tag: "you",
    dur: 4.8,
    Scene: SceneSubmit,
    cursor: [
      { t: 0.3, x: 950, y: 380 },
      { t: 2.1, x: 1463, y: 658 },
      { t: 2.7, x: 1463, y: 658, click: true },
      { t: 4.2, x: 1463, y: 658 },
    ],
  },
  {
    id: "today",
    kicker: "11 · Today",
    caption: "Open Today and the rest already ran. Only your decisions are left.",
    tag: "you",
    dur: 5.0,
    Scene: SceneToday,
  },
];

export const FILM_DURATION =
  BUMPER + BEATS.reduce((s, b) => s + b.dur, 0) + ENDCARD;

/** Absolute start time of each beat. */
export const BEAT_STARTS = BEATS.reduce<number[]>((acc, b, i) => {
  acc.push(i === 0 ? BUMPER : acc[i - 1] + BEATS[i - 1].dur);
  return acc;
}, []);

/* ------------------------------------------------------------------ chrome */

function CaptionBar({ beat, local }: { beat: Beat; local: number }) {
  const a = reveal(local, 0.06, 0.4);
  const isYou = beat.tag === "you";
  const tone = isYou ? GOLD : PURSUE;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 236,
        padding: "0 76px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 18,
        background: "linear-gradient(to top, rgba(9,10,9,.98) 62%, rgba(9,10,9,0))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22, opacity: a }}>
        <span
          style={{
            font: `500 32px/1 ${mono}`,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: GOLD,
          }}
        >
          {beat.kicker}
        </span>
        <span style={{ width: 46, height: 1, background: `${GOLD}80` }} />
        <span
          style={{
            font: `500 30px/1 ${mono}`,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: tone,
            border: `1px solid ${tone}80`,
            background: `${tone}1a`,
            padding: "9px 15px",
          }}
        >
          {isYou ? "Needs you" : "Automatic"}
        </span>
      </div>
      <div
        style={{
          font: `500 62px/1.22 ${sans}`,
          color: CREAM,
          maxWidth: 1660,
          opacity: a,
          transform: `translateY(${(1 - a) * 12}px)`,
        }}
      >
        {beat.caption}
      </div>
    </div>
  );
}

function TopStrip({ index, t }: { index: number; t: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 82,
        padding: "0 76px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid rgba(255,255,255,.07)`,
      }}
    >
      <span
        style={{
          font: `400 30px/1 ${serif}`,
          letterSpacing: ".16em",
          color: "rgba(246,242,235,.85)",
        }}
      >
        BROST<span style={{ fontSize: 19, letterSpacing: ".1em" }}>CO</span>
      </span>
      <div style={{ display: "flex", gap: 9 }}>
        {BEATS.map((b, i) => (
          <span
            key={b.id}
            style={{
              width: i === index ? 40 : 16,
              height: 4,
              background: i === index ? GOLD : i < index ? `${GOLD}66` : "rgba(255,255,255,.16)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Cursor({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 40,
        pointerEvents: "none",
        transform: `translate(-4px,-2px) scale(${1 - press * 0.12})`,
      }}
    >
      {press > 0 && (
        <span
          style={{
            position: "absolute",
            left: -2,
            top: -2,
            width: 26 + press * 62,
            height: 26 + press * 62,
            marginLeft: -(press * 31),
            marginTop: -(press * 31),
            borderRadius: "50%",
            border: `2px solid ${GOLD}`,
            opacity: press * 0.75,
          }}
        />
      )}
      <svg width="44" height="54" viewBox="0 0 26 32" fill="none">
        <path
          d="M2 2.2 2 24.4 8.2 18.8 12.4 29.2 16.1 27.7 11.8 17.1 20.6 16.8 2 2.2Z"
          fill="#f6f2eb"
          stroke="#12130f"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Bumper({ local }: { local: number }) {
  const a = easeOut(local / 0.45);
  const out = 1 - clamp01((local - BUMPER + 0.3) / 0.3);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#090a09",
        opacity: Math.min(a, out),
      }}
    >
      <div style={{ font: `400 96px/1 ${serif}`, letterSpacing: ".14em", color: CREAM }}>
        BROST<span style={{ fontSize: 54 }}>CO</span>
      </div>
      <div style={{ width: 90, height: 1, background: GOLD, margin: "30px 0 24px" }} />
      <div
        style={{
          font: `500 32px/1 ${mono}`,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: MUTED,
        }}
      >
        The government bid, already in motion
      </div>
    </div>
  );
}

function EndCard({ local }: { local: number }) {
  const a = easeOut(local / 0.6);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#090a09",
        opacity: a,
        padding: "0 140px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          font: `400 84px/1.15 ${serif}`,
          color: CREAM,
          transform: `translateY(${(1 - a) * 16}px)`,
        }}
      >
        The slow parts are already done.
      </div>
      <div style={{ width: 90, height: 1, background: GOLD, margin: "40px 0 28px" }} />
      <div style={{ font: `400 40px/1.4 ${sans}`, color: MUTED, maxWidth: 1180 }}>
        You keep the judgment calls. Brost Co keeps the bid moving.
      </div>
      <div
        style={{
          marginTop: 44,
          font: `500 33px/1 ${mono}`,
          letterSpacing: ".2em",
          textTransform: "uppercase",
          color: GOLD,
          border: `1px solid ${GOLD}`,
          padding: "22px 40px",
        }}
      >
        brostco.com
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- stage */

export function FilmCapture() {
  const [t, setT] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.background = "#090a09";
  }, []);

  const seek = useCallback((next: number) => {
    setT(next);
  }, []);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__filmSeek = seek;
    w.__filmDuration = FILM_DURATION;
    // Beat timings are published so the cut and the caption track are
    // generated from the same source and cannot drift apart.
    w.__filmBeats = BEATS.map((b, i) => ({
      id: b.id,
      start: BEAT_STARTS[i],
      dur: b.dur,
      caption: b.caption,
      tag: b.tag,
    }));
    w.__filmReady = true;
  }, [seek]);

  // Which beat is on screen.
  let index = -1;
  for (let i = 0; i < BEATS.length; i++) {
    if (t >= BEAT_STARTS[i] && t < BEAT_STARTS[i] + BEATS[i].dur) {
      index = i;
      break;
    }
  }
  const inEnd = t >= BUMPER + BEATS.reduce((s, b) => s + b.dur, 0);
  const beat = index >= 0 ? BEATS[index] : null;
  const local = beat ? t - BEAT_STARTS[index] : 0;
  const cur = beat ? cursorAt(beat.cursor, local) : null;

  // One repeated transition device: a short rise + fade at every beat start.
  const enter = beat ? reveal(local, 0, TRANS) : 1;
  const exit = beat ? 1 - clamp01((local - (beat.dur - TRANS)) / TRANS) : 1;
  const opacity = Math.min(enter, exit);

  return (
    <div
      id="film-frame"
      style={{
        position: "relative",
        width: 1920,
        height: 1080,
        overflow: "hidden",
        background: "#090a09",
        color: CREAM,
        fontFamily: sans,
      }}
    >
      {beat && (
        <>
          <TopStrip index={index} t={t} />
          <div
            data-film-scene=""
            style={{
              position: "absolute",
              top: 82,
              left: 0,
              right: 0,
              bottom: 236,
              padding: "54px 76px 30px",
              opacity,
              transform: `translateY(${(1 - enter) * 22}px)`,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <beat.Scene p={clamp01(local / beat.dur)} local={local} cursor={beat.cursor} />
          </div>
          <div style={{ opacity }}>
            <CaptionBar beat={beat} local={local} />
          </div>
          {cur && <Cursor x={cur.x} y={cur.y} press={cur.press} />}
        </>
      )}
      {t < BUMPER && <Bumper local={t} />}
      {inEnd && <EndCard local={t - (BUMPER + BEATS.reduce((s, b) => s + b.dur, 0))} />}
    </div>
  );
}
