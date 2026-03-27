'use strict';

/**
 * .claude/scripts/cleanup-reviews.js
 *
 * Runs at session start. Deletes stamp files in .commit-reviews/ for commits
 * that have already been pushed to the remote — they've served their purpose.
 *
 * Keeps stamps for commits that are still locally ahead of the remote,
 * since the pre-push gate still needs them.
 */

const { execSync } = require('child_process');
const { readdirSync, unlinkSync, existsSync } = require('fs');
const { join } = require('path');

const PROJECT_ROOT = '/Users/lakshyalahoty/Desktop/projects/cardsNight';
const REVIEWS_DIR = join(PROJECT_ROOT, '.commit-reviews');

if (!existsSync(REVIEWS_DIR)) process.exit(0);

let files;
try {
  files = readdirSync(REVIEWS_DIR);
} catch {
  process.exit(0);
}

if (files.length === 0) process.exit(0);

// Extract unique SHAs from filenames (<sha>-correctness.md / <sha>-scalability.md)
const shas = new Set(
  files
    .map(f => f.match(/^([a-f0-9]{40})-(correctness|scalability)\.md$/))
    .filter(Boolean)
    .map(m => m[1])
);

for (const sha of shas) {
  try {
    // If the commit exists on any remote branch, it's been pushed — safe to delete
    const result = execSync(`git branch -r --contains ${sha} 2>/dev/null`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    if (result.trim().length > 0) {
      // Commit is on the remote — delete both stamp files
      const correctness = join(REVIEWS_DIR, `${sha}-correctness.md`);
      const scalability = join(REVIEWS_DIR, `${sha}-scalability.md`);
      if (existsSync(correctness)) unlinkSync(correctness);
      if (existsSync(scalability)) unlinkSync(scalability);
    }
  } catch {
    // Unknown commit or git error — leave the file alone
  }
}
