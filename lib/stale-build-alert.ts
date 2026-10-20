/**
 * Tell the operator when production was published from a stale workspace.
 *
 * Production is built from the Replit workspace, not from GitHub. A publish
 * from a workspace that has not merged main ships older code and silently
 * undoes whatever was merged since, which is how a fixed outage comes back.
 * The build records how far behind main it was; this reads that at worker
 * boot and sends one alert per build, however often the worker restarts.
 */
import { queryOne } from "./db";
import { deliverOutageAlert } from "./outage-alert";
import { buildMainFreshness, runtimeBuild, type MainFreshness } from "./runtime-evidence";

export function staleBuildText(freshness: MainFreshness, build: { buildId: string; sourceCommit: string | null } | null): string {
  const commit = build?.sourceCommit ? build.sourceCommit.slice(0, 8) : "an unrecorded commit";
  return (
    `Production is running a build from ${commit} that is missing ${freshness.missingCommits} commit(s) ` +
    "already merged to GitHub main, so those changes are not live. In the Replit workspace, merge origin/main " +
    "(git fetch origin main && git merge origin/main), then publish again."
  );
}

/** Returns true when it sent the alert. */
export async function alertIfStaleBuild(
  freshness: MainFreshness | null = buildMainFreshness,
  build: { buildId: string; sourceCommit: string | null } | null = runtimeBuild
): Promise<boolean> {
  if (!freshness || freshness.upToDate !== false || !freshness.missingCommits) return false;
  // One claim per build: a crash-looping worker must not send it every boot.
  const claimed = await queryOne<{ key: string }>(
    `insert into app_settings (key, value_json, updated_at, updated_by)
     values ($1, $2::jsonb, now(), 'worker')
     on conflict (key) do nothing
     returning key`,
    [`platform:stale-build-alerted:${build?.buildId ?? freshness.checkedAt}`, JSON.stringify(freshness)]
  );
  if (!claimed) return false;
  const text = staleBuildText(freshness, build);
  console.error(`[worker] ${text}`);
  await deliverOutageAlert({ subject: "Production is running an out-of-date build", text, tone: "critical" });
  return true;
}
