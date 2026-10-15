/** Offline plan only at the command line. No environment, credential or DB reads. */
import { evaluationPlan } from "./lib/synthetic-evaluation";

if (process.argv.slice(2).some(arg => arg !== "--plan")) {
  console.error("Live evaluation is not wired: the existing application client requires production admission/usage writes. No provider request was made.");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ mode: "offline-plan-only", paidCalls: 0, liveRuntimeBinding: false,
    ...evaluationPlan() }, null, 2));
}
