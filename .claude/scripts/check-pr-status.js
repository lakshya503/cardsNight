'use strict';

/**
 * .claude/scripts/check-pr-status.js
 *
 * Runs at session start. Checks for any open PRs with failing CI checks
 * and prints a warning to the console so the user sees it immediately.
 */

const { execSync } = require('child_process');

const REPO = 'lakshya503/cardsNight';

try {
  const prsJson = execSync(
    `gh pr list --repo ${REPO} --state open --json number,title,headRefName`,
    { encoding: 'utf8' }
  );
  const prs = JSON.parse(prsJson);

  if (prs.length === 0) process.exit(0);

  const failing = [];

  for (const pr of prs) {
    try {
      const checksJson = execSync(
        `gh pr checks ${pr.number} --repo ${REPO} --json name,bucket,state`,
        { encoding: 'utf8' }
      );
      const checks = JSON.parse(checksJson);
      const failed = checks.filter(c => c.bucket === 'fail');
      if (failed.length > 0) {
        failing.push({ pr, failed });
      }
    } catch {
      // Ignore errors on individual PRs (e.g. no checks yet)
    }
  }

  if (failing.length === 0) process.exit(0);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔴 ${failing.length} PR${failing.length !== 1 ? 's' : ''} with failing CI checks:`);
  failing.forEach(({ pr, failed }) => {
    console.log(`  PR #${pr.number} — "${pr.title}" (${pr.headRefName})`);
    failed.forEach(c => console.log(`    ✗ ${c.name}`));
  });
  console.log('\n  Fix the issues and push to re-trigger CI before merging.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
} catch {
  // Never block session start
  process.exit(0);
}
