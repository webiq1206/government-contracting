import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, oldText, newText) {
  const text = readFileSync(path, "utf8");
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}: ${oldText.slice(0, 120)}`);
  writeFileSync(path, text.replace(oldText, newText));
}

// My Work no longer uses the old verbose summary helper.
replaceOnce("app/(dash)/workbench/page.tsx", "  summarizeQueue,\n", "");

// Today: the work list is primary. Secondary themed sections stay closed until requested.
replaceOnce(
  "app/(dash)/today/page.tsx",
  `<div className="flex min-h-0 flex-1 overflow-hidden">\n      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">`,
  `<div className="min-w-0 flex-1">\n      <div className="min-w-0">`
);
replaceOnce(
  "app/(dash)/today/page.tsx",
  `{!automation.paused && <PipelinePulse findings={pulse} compact />}`,
  `{!automation.paused && !health?.interrupt && <PipelinePulse findings={pulse} compact />}`
);
for (const key of ["urgent", "reply-reviews", "calls"]) {
  const oldText = `defaultOpen={firstOpen === "${key}"}` + `}`;
  const text = readFileSync("app/(dash)/today/page.tsx", "utf8");
  if (text.includes(oldText)) {
    writeFileSync("app/(dash)/today/page.tsx", text.replace(oldText, "defaultOpen={false}"));
  }
}

// Calls: keep the header to one useful count and one instruction.
replaceOnce(
  "app/(dash)/call-queue/page.tsx",
  `            : cards.length === 0
              ? "No calls waiting"
              : [
                  \`${'${counts.remaining}'} to make\`,
                  counts.urgent > 0 ? \`${'${counts.urgent}'} on a bid due inside two days\` : null,
                  counts.badHour > 0 ? \`${'${counts.badHour}'} outside your calling hours there\` : null,
                  counts.attemptsSpent > 0
                    ? \`${'${counts.attemptsSpent}'} past the attempt limit\`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
`,
  `            : cards.length === 0
              ? "No calls waiting"
              : \`${'${counts.remaining}'} to make${'${counts.urgent > 0 ? ` · ${counts.urgent} urgent` : ""}'}\`
`
);
replaceOnce(
  "app/(dash)/call-queue/page.tsx",
  `            : focusTitle
              ? \`Just the subs for ${'${focusTitle}'}, one card per trade. Open a card to start the guided call.\`
              : "Soonest deadline first. Select several to skip or snooze together, or open a card to start the guided call."
`,
  `            : focusTitle
              ? \`Calls for ${'${focusTitle}'}.\`
              : "Open the next call and work through the queue."
`
);

console.log("Final UX page cleanup applied.");
