#!/usr/bin/env node
/**
 * .claude/scripts/check-review-gate.js
 *
 * PreToolUse gate: blocks git push/merge until both review stamp files exist for HEAD.
 * Called by the PreToolUse Bash hook.
 *
 * Reads JSON from stdin (Claude Code hook input format).
 * Exits 1 with error message if either review is missing → blocks the tool.
 * Exits 0 if both reviews exist or the command is not a push/merge.
 */

'use strict';

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

const PROJECT_ROOT = '/Users/lakshyalahoty/Desktop/projects/cardsNight';

let input;
try {
  const raw = require('fs').readFileSync('/dev/stdin', 'utf8');
  input = JSON.parse(raw);
} catch {
  process.exit(0); // Can't read input — allow through
}

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/git\s+(merge|push)/.test(cmd) && !/gh\s+pr\s+merge/.test(cmd)) process.exit(0);

let sha;
try {
  sha = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
} catch {
  process.exit(0); // Not a git repo — allow through
}

const reviewsDir = join(PROJECT_ROOT, '.commit-reviews');
const missing = [];

if (!existsSync(join(reviewsDir, `${sha}-correctness.md`))) missing.push('correctness');
if (!existsSync(join(reviewsDir, `${sha}-scalability.md`))) missing.push('scalability');

if (missing.length === 0) process.exit(0);

const shortSha = sha.slice(0, 7);
process.stderr.write(
  `\n[GATE BLOCKED] Reviews not yet complete for commit ${shortSha}.\n` +
  `Missing: ${missing.join(', ')} review.\n\n` +
  `Reviews run automatically in the background after each commit.\n` +
  `If they haven't appeared yet, run manually:\n` +
  `  node .claude/scripts/run-reviews.js\n\n` +
  `Then retry the push.\n`
);
process.exit(1);
