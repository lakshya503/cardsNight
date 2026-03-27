#!/usr/bin/env node
/**
 * .claude/scripts/check-review-gate.js
 *
 * PreToolUse gate: blocks git push/merge/gh pr merge until:
 *   1. Both review stamp files exist for HEAD
 *   2. Neither stamp contains HIGH or MEDIUM findings
 *
 * Called by the PreToolUse Bash hook.
 * Exits 1 with error message to block the tool.
 * Exits 0 to allow through.
 */

'use strict';

const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const PROJECT_ROOT = '/Users/lakshyalahoty/Desktop/projects/cardsNight';

let input;
try {
  const raw = require('fs').readFileSync('/dev/stdin', 'utf8');
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/git\s+(merge|push)/.test(cmd) && !/gh\s+pr\s+merge/.test(cmd)) process.exit(0);

let sha;
try {
  sha = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
} catch {
  process.exit(0);
}

const reviewsDir = join(PROJECT_ROOT, '.commit-reviews');
const correctnessFile = join(reviewsDir, `${sha}-correctness.md`);
const scalabilityFile = join(reviewsDir, `${sha}-scalability.md`);
const shortSha = sha.slice(0, 7);

// Stage 1: stamps exist?
const missing = [];
if (!existsSync(correctnessFile)) missing.push('correctness');
if (!existsSync(scalabilityFile)) missing.push('scalability');

if (missing.length > 0) {
  process.stderr.write(
    `\n[GATE BLOCKED] Reviews not yet complete for commit ${shortSha}.\n` +
    `Missing: ${missing.join(', ')} review.\n\n` +
    `Run the ${missing.map(m => m === 'correctness' ? 'code-reviewer' : 'scalability-reviewer').join(' and ')} agent${missing.length > 1 ? 's' : ''}, then retry.\n`
  );
  process.exit(1);
}

// Stage 2: stamps contain HIGH or MEDIUM?
const blocking = [];
const correctness = readFileSync(correctnessFile, 'utf8');
const scalability = readFileSync(scalabilityFile, 'utf8');

if (/\*\*(HIGH|MEDIUM)\*\*/i.test(correctness)) blocking.push('correctness');
if (/\*\*(HIGH|MEDIUM)\*\*/i.test(scalability)) blocking.push('scalability');

if (blocking.length > 0) {
  process.stderr.write(
    `\n[GATE BLOCKED] Blocking issues found in ${blocking.join(' and ')} review for commit ${shortSha}.\n\n` +
    `Fix the HIGH or MEDIUM findings, commit the fix, re-run the agents, then retry.\n`
  );
  process.exit(1);
}

// All clear
process.exit(0);
