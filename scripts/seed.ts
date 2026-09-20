/**
 * Seed: register demo repos and run the v1 baseline (synchronous).
 * Usage: npm run seed
 */
import { ensureDemoRepos, runAnalysis } from "../src/lib/sentinel/pipeline";

async function main() {
  const repos = ensureDemoRepos();
  console.log(`demo repos: ${repos.map((r) => r.id).join(", ")}`);
  for (const repo of repos) {
    if (repo.lastAnalysisId) {
      console.log(`${repo.id}: already has analyses, skipping`);
      continue;
    }
    console.log(`${repo.id}: running baseline…`);
    const run = await runAnalysis({ repoId: repo.id, trigger: "manual", actor: "seed" });
    console.log(
      `${repo.id}: ${run.status} — ${run.endpoints.length} endpoints, validation=${run.validation?.valid ? "PASSED" : "n/a"}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
