import { describe, expect, it } from "vitest";
import {
  PHASES,
  WORKFLOW_STEPS,
  glossaryList,
  noKnowledgeAdvice,
  quickStart,
  searchKnowledge,
  searchTerms,
  settingNotes,
  stepSkipped,
  stepStatus,
  stepViews,
  triggerText,
  type Article,
  type KnowledgeContext,
  type SetupItemLike,
  type WorkflowStep,
} from "@/lib/domain/knowledge";
import { GLOSSARY, termLabel } from "@/lib/domain/glossary";
import { DEFAULT_RULES } from "@/lib/domain/intake";
import { computeSetupChecklist } from "@/lib/domain/setup";
import { describeCron } from "@/lib/domain/cron-describe";
import { scheduledAgents } from "@/lib/agents/registry";

const NOW = new Date("2026-03-10T12:00:00Z");

function ctx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    schedules: { "opportunity-monitor": "0 */3 * * *" },
    rules: { ...DEFAULT_RULES },
    thresholds: { pursueMin: 70, reviewMin: 50, autoDismissHours: 72 },
    evidence: {},
    now: NOW,
    ...over,
  };
}

const step = (key: string): WorkflowStep => {
  const s = WORKFLOW_STEPS.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key}`);
  return s;
};

describe("the map itself", () => {
  it("numbers every step once, in order", () => {
    const numbers = WORKFLOW_STEPS.map((s) => s.n);
    expect(numbers).toEqual(numbers.slice().sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("has a unique key for every step, because the anchors are built from them", () => {
    const keys = WORKFLOW_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every step in a declared phase", () => {
    const phases = new Set(PHASES.map((p) => p.key));
    for (const s of WORKFLOW_STEPS) expect(phases.has(s.phase)).toBe(true);
  });

  it("gives every step a recovery route, because the point is not calling support", () => {
    for (const s of WORKFLOW_STEPS) {
      expect(s.recovery.length).toBeGreaterThan(20);
      expect(s.recoveryHref.startsWith("/")).toBe(true);
      expect(s.recoveryLabel.length).toBeGreaterThan(0);
    }
  });

  /**
   * Owner is one word, and one word cannot say which half of a step is the
   * platform's. A step that runs on its own still has a human edge somewhere,
   * and somebody waiting on automation that was never going to happen is
   * waiting because nobody wrote these two sentences down.
   */
  it("says what is automatic and what needs a person, for every step", () => {
    for (const s of WORKFLOW_STEPS) {
      expect(s.automatic.length, `${s.key} automatic`).toBeGreaterThan(20);
      expect(s.manual.length, `${s.key} manual`).toBeGreaterThan(5);
    }
  });

  it("names what stops every step", () => {
    for (const s of WORKFLOW_STEPS) {
      expect(s.blockers.length, `${s.key} blockers`).toBeGreaterThan(0);
      for (const b of s.blockers) expect(b.length, `${s.key} blocker`).toBeGreaterThan(20);
    }
  });

  it("finds a step by the symptom rather than by its name", () => {
    // What somebody actually types is what went wrong, not what the step is
    // called, and the symptom is written in the blocker list.
    const hits = searchKnowledge("daily quota", []);
    expect(hits.steps.map((s) => s.key)).toContain("found");
  });

  it("only teaches terms the glossary actually defines", () => {
    for (const s of WORKFLOW_STEPS) {
      for (const t of s.terms) expect(GLOSSARY[t], `${s.key} teaches ${t}`).toBeTruthy();
    }
  });

  /**
   * The whole reason this module exists. A step that says it is scheduled must
   * name an agent the registry schedules, or the page invents a cadence.
   */
  it("names a real scheduled agent for every scheduled step", () => {
    const known = new Set(scheduledAgents().map((s) => s.agent.name));
    for (const s of WORKFLOW_STEPS) {
      if (s.trigger.kind !== "schedule") continue;
      if (s.trigger.queuedBy) continue; // queue-driven, no cron expected
      expect(known.has(s.trigger.agent), `${s.key} names ${s.trigger.agent}`).toBe(true);
    }
  });

  it("points every `after` trigger at a step that exists", () => {
    const keys = new Set(WORKFLOW_STEPS.map((s) => s.key));
    for (const s of WORKFLOW_STEPS) {
      if (s.trigger.kind === "after") expect(keys.has(s.trigger.after)).toBe(true);
    }
  });
});

describe("what the step is doing on this account", () => {
  it("says nothing yet when it has never happened", () => {
    const s = stepStatus(step("found"), ctx({ evidence: { found: { recent: 0, lastAt: null } } }));
    expect(s.word).toBe("Nothing yet");
    expect(s.detail).not.toMatch(/0/);
  });

  it("never claims health from an unreadable count", () => {
    const s = stepStatus(step("found"), ctx({ evidence: {} }));
    expect(s.word).toBe("Not recorded");
    expect(s.tone).toBe("unknown");
  });

  it("counts the last seven days when it is running", () => {
    const s = stepStatus(
      step("found"),
      ctx({
        evidence: {
          found: { recent: 4, lastAt: "2026-03-10T09:00:00Z", example: "Roof replacement" },
        },
      })
    );
    expect(s.word).toBe("Running");
    expect(s.detail).toContain("4 in the last 7 days");
    expect(s.detail).toContain("3 hours ago");
    expect(s.detail).toContain("Roof replacement");
  });

  it("calls it quiet, not healthy, when the last one predates the window", () => {
    const s = stepStatus(
      step("found"),
      ctx({ evidence: { found: { recent: 0, lastAt: "2026-01-01T00:00:00Z" } } })
    );
    expect(s.word).toBe("Quiet");
    expect(s.detail).toContain("nothing in the last 7 days");
  });

  it("puts a queue ahead of a cadence", () => {
    const s = stepStatus(
      step("decided"),
      ctx({ evidence: { decided: { recent: 9, lastAt: NOW.toISOString(), waiting: 3 } } })
    );
    expect(s.word).toBe("Waiting on you");
    expect(s.detail).toContain("3 items are waiting");
  });

  it("uses the singular for one waiting item", () => {
    const s = stepStatus(
      step("decided"),
      ctx({ evidence: { decided: { recent: 1, lastAt: null, waiting: 1 } } })
    );
    expect(s.detail).toContain("1 item is waiting");
  });

  it("lets the caller speak for a step whose state is a condition", () => {
    const s = stepStatus(
      step("inbox"),
      ctx({
        evidence: {
          inbox: {
            recent: null,
            lastAt: null,
            override: { word: "Needs you", tone: "attention", detail: "No inbox is connected." },
          },
        },
      })
    );
    expect(s.word).toBe("Needs you");
    expect(s.detail).toBe("No inbox is connected.");
  });

  it("says the call step is turned off rather than quiet when calling is off", () => {
    const rules = { ...DEFAULT_RULES, calls_enabled: false };
    expect(stepSkipped(step("called"), rules)).toBe(true);
    const s = stepStatus(step("called"), ctx({ rules }));
    expect(s.word).toBe("Turned off");
    // The state beats the missing evidence: an account with no call records
    // and calling switched off is not an account whose records failed to read.
    expect(s.tone).toBe("neutral");
  });

  it("leaves every other step alone when calling is off", () => {
    const rules = { ...DEFAULT_RULES, calls_enabled: false };
    for (const s of WORKFLOW_STEPS) {
      if (s.key === "called") continue;
      expect(stepSkipped(s, rules)).toBe(false);
    }
  });
});

describe("when a step starts", () => {
  it("reads the cadence from the schedule it is given", () => {
    expect(triggerText(step("found"), ctx(), describeCron)).toBe("Every 3 hours");
  });

  /**
   * The defect this module was written for: the page said "about every 2
   * hours" while the registry said three. Changing the registry now changes
   * the sentence.
   */
  it("follows the registry when the schedule changes", () => {
    const said = triggerText(
      step("found"),
      ctx({ schedules: { "opportunity-monitor": "0 */6 * * *" } }),
      describeCron
    );
    expect(said).toBe("Every 6 hours");
  });

  it("names what queues an agent that has no clock of its own", () => {
    const said = triggerText(step("scored"), ctx({ schedules: {} }), describeCron);
    expect(said).toContain("Queued by each newly found opportunity");
  });

  it("says a person's trigger as a sentence", () => {
    expect(triggerText(step("outcome"), ctx(), describeCron)).toBe("When the agency tells you");
  });

  it("resolves an `after` trigger to the earlier step's name", () => {
    expect(triggerText(step("waiting"), ctx(), describeCron)).toContain("review and submit");
  });
});

describe("the settings a step is actually using", () => {
  it("quotes this account's follow-up window rather than a default", () => {
    const notes = settingNotes(
      step("emailed"),
      ctx({ rules: { ...DEFAULT_RULES, followup_hours: 24, followup_max: 2 } })
    );
    const followup = notes.find((n) => n.text.includes("follow-up rule"));
    expect(followup?.text).toContain("24 hours");
    expect(followup?.text).toContain("at most 2 follow-ups");
  });

  it("says no follow-up is sent when the limit is zero", () => {
    const notes = settingNotes(
      step("emailed"),
      ctx({ rules: { ...DEFAULT_RULES, followup_max: 0 } })
    );
    expect(notes[0].text).toContain("no follow-up is sent");
  });

  it("describes the calling window in the subcontractor's time zone", () => {
    const notes = settingNotes(
      step("called"),
      ctx({ rules: { ...DEFAULT_RULES, call_hours_start: 9, call_hours_end: 18 } })
    );
    expect(notes[0].text).toContain("9am to 6pm");
    expect(notes[0].text).toContain("own time zone");
  });

  it("says an attempt limit of zero is off rather than showing a zero", () => {
    const notes = settingNotes(
      step("called"),
      ctx({ rules: { ...DEFAULT_RULES, call_max_attempts: 0 } })
    );
    const attempts = notes.find((n) => n.text.includes("attempt limit"));
    expect(attempts?.text).toContain("is off");
  });

  it("spells out the three score bands from the account's own thresholds", () => {
    const notes = settingNotes(step("scored"), ctx());
    expect(notes[0].text).toContain("70 and above");
    expect(notes[0].text).toContain("50 to 69");
    expect(notes[0].text).toContain("below 50");
  });

  it("refuses to explain the bands when the thresholds are missing", () => {
    const notes = settingNotes(
      step("scored"),
      ctx({ thresholds: { pursueMin: null, reviewMin: null, autoDismissHours: null } })
    );
    expect(notes[0].text).toContain("not recorded");
  });

  it("gives every note somewhere to change the setting", () => {
    for (const v of stepViews(ctx(), describeCron)) {
      for (const note of v.settingNotes) expect(note.href.startsWith("/settings/")).toBe(true);
    }
  });
});

describe("search", () => {
  const ARTICLES: Article[] = [
    { key: "agents", title: "What the automation is doing", points: ["Every run is logged."], href: "/agents" },
  ];

  it("drops the words that narrow nothing", () => {
    expect(searchTerms("why did nothing get emailed")).toEqual(["nothing", "emailed"]);
    expect(searchTerms("how do I score an opportunity")).toEqual(["score", "opportunity"]);
  });

  it("finds the outreach step from a question", () => {
    const hits = searchKnowledge("subcontractors emailed", ARTICLES);
    expect(hits.steps.map((s) => s.key)).toContain("emailed");
  });

  it("finds a glossary term by its plain name", () => {
    const hits = searchKnowledge("set aside", ARTICLES);
    expect(hits.terms.map((t) => t.key)).toContain("set_aside");
  });

  it("finds a page's own help", () => {
    const hits = searchKnowledge("automation logged", ARTICLES);
    expect(hits.articles.map((a) => a.key)).toContain("agents");
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchKnowledge("   ", ARTICLES).total).toBe(0);
  });

  it("prefers an exact match over a partial one, and says which it gave", () => {
    const hits = searchKnowledge("subcontractors emailed", ARTICLES);
    expect(hits.partial).toBe(false);
  });

  /**
   * The placeholder in the search box invites a full sentence, and a sentence
   * shares at most one content word with any single answer. Requiring all of
   * them returned nothing for exactly the phrasing the page asks for.
   */
  it("answers a question typed as a sentence", () => {
    const hits = searchKnowledge("why did nothing get emailed", ARTICLES);
    expect(hits.total).toBeGreaterThan(0);
    expect(hits.steps[0].key).toBe("emailed");
  });

  it("falls back to a partial match, and says so, when no answer has every word", () => {
    const hits = searchKnowledge("emailed certifications", ARTICLES);
    expect(hits.total).toBeGreaterThan(0);
    expect(hits.partial).toBe(true);
  });

  it("ranks the best partial match first", () => {
    const hits = searchKnowledge("quote entry trades coverage", ARTICLES);
    expect(hits.steps[0].key).toBe("quoted");
  });

  it("finds nothing at all for a word nothing uses", () => {
    const hits = searchKnowledge("kangaroo", ARTICLES);
    expect(hits.total).toBe(0);
    expect(hits.partial).toBe(false);
  });

  it("advises differently when the query was long", () => {
    expect(noKnowledgeAdvice("one two three four")).toContain("one word that matters most");
    expect(noKnowledgeAdvice("kangaroo")).toContain("workflow map");
  });
});

describe("the glossary", () => {
  it("labels every term it defines", () => {
    for (const key of Object.keys(GLOSSARY)) {
      expect(termLabel(key), key).not.toBe(key.replace(/_/g, " "));
    }
  });

  it("lists every term, alphabetically by label", () => {
    const list = glossaryList();
    expect(list.length).toBe(Object.keys(GLOSSARY).length);
    const labels = list.map((t) => t.label);
    expect(labels).toEqual(labels.slice().sort((a, b) => a.localeCompare(b)));
  });
});

describe("quick start", () => {
  const SETUP: SetupItemLike[] = [
    { key: "sam", label: "Add your SAM.gov API key", hint: "h", done: false, href: "/settings/integrations", required: true },
    { key: "naics", label: "Pick your NAICS codes", hint: "h", done: true, href: "/settings/profile", required: true },
  ];
  const FACTS = { hasOpportunities: true, hasDecided: false, hasSubs: false };
  const label = (r: string | null | undefined) => `Role ${r ?? "none"}`;

  it("carries the setup checklist's own done flags rather than recomputing them", () => {
    const items = quickStart("owner", SETUP, FACTS, label);
    expect(items.find((i) => i.key === "setup:naics")?.done).toBe(true);
    expect(items.find((i) => i.key === "setup:sam")?.done).toBe(false);
  });

  it("shows a step a read-only role cannot do, and says who can", () => {
    const items = quickStart("viewer", SETUP, FACTS, label);
    const sam = items.find((i) => i.key === "setup:sam");
    expect(sam).toBeTruthy();
    expect(sam?.blockedBy).toContain("Ask an account owner");
  });

  it("blocks nothing for an owner", () => {
    const items = quickStart("owner", SETUP, FACTS, label);
    expect(items.every((i) => i.blockedBy === null)).toBe(true);
  });

  it("marks the first runs from the account's own records", () => {
    const items = quickStart("owner", SETUP, FACTS, label);
    expect(items.find((i) => i.key === "first:watch")?.done).toBe(true);
    expect(items.find((i) => i.key === "first:decide")?.done).toBe(false);
  });

  /**
   * The keys come from computeSetupChecklist, and one of them is "email"
   * rather than "gmail". Mapped wrong, an item silently gets no capability
   * and stops being gated at all.
   *
   * Two steps genuinely need no capability: having an account, and waiting
   * for the platform to find the first opportunity. They are named here, so
   * a key that is ungated by accident cannot hide among them.
   */
  const UNGATED = new Set(["setup:account", "setup:first_opportunity"]);

  it("gates every step the real setup checklist emits", () => {
    const real = computeSetupChecklist({
      profile: null,
      integrations: { sam: false, claude: false, googleMaps: false, gmail: false },
      access: { level: "trial", trialDaysLeft: 9 },
      firstRun: { opportunities: 0 },
    });
    const items = quickStart("viewer", real.items, FACTS, label);
    for (const item of items.filter((i) => i.key.startsWith("setup:"))) {
      if (UNGATED.has(item.key)) {
        expect(item.blockedBy, item.key).toBeNull();
        continue;
      }
      expect(item.blockedBy, item.key).not.toBeNull();
    }
  });

  it("labels each link by where it actually goes", () => {
    const real = computeSetupChecklist({
      profile: null,
      integrations: { sam: false, claude: false, googleMaps: false, gmail: false },
      access: { level: "none" },
      firstRun: { opportunities: 0 },
    });
    const items = quickStart("owner", real.items, FACTS, label);
    const byKey = (k: string) => items.find((i) => i.key === k)!;
    expect(byKey("setup:rules").hrefLabel).toBe("Open automation rules");
    expect(byKey("setup:access").hrefLabel).toBe("Open billing");
    expect(byKey("setup:sam").hrefLabel).toBe("Open integrations");
    expect(byKey("setup:naics").hrefLabel).toBe("Open company profile");
  });

  it("never marks reading the rules done, because reading leaves no record", () => {
    const items = quickStart("owner", SETUP, { ...FACTS, hasDecided: true, hasSubs: true }, label);
    expect(items.find((i) => i.key === "first:rules")?.done).toBe(false);
  });
});
