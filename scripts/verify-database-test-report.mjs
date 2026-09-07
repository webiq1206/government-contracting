import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2] ?? "database-test-results.json", "utf8"));
const passed = report.numPassedTests;
const failed = report.numFailedTests;
const skipped = report.numPendingTests;
const failedSuites = report.numFailedTestSuites;
if (
  !Number.isInteger(passed) || passed < 1 ||
  failed !== 0 || skipped !== 0 || failedSuites !== 0 ||
  report.success !== true
) {
  console.error("Database gate failed: every selected test must execute and pass.");
  console.error(JSON.stringify({ passed, failed, skipped, failedSuites }));
  process.exitCode = 1;
} else {
  console.log(`Database gate passed: ${passed} tests, no failures or skips.`);
}
