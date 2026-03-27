#!/usr/bin/env node
/**
 * .claude/scripts/run-reviews.js
 *
 * Runs correctness (Haiku) + scalability (Haiku) reviews IN PARALLEL after every commit.
 * Called by the asyncRewake PostToolUse hook — runs in the background, non-blocking.
 *
 * Outputs:
 *   .commit-reviews/<SHA>-correctness.md
 *   .commit-reviews/<SHA>-scalability.md
 *
 * Exits 2 if any HIGH priority issues are found → asyncRewake notifies the model.
 * Exits 0 otherwise (clean or low/medium issues only).
 */

'use strict';

const { execSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const PROJECT_ROOT = '/Users/lakshyalahoty/Desktop/projects/cardsNight';
const REVIEWS_DIR = join(PROJECT_ROOT, '.commit-reviews');

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[reviews] ANTHROPIC_API_KEY not set — skipping reviews');
    process.exit(0);
  }

  let sha, diff;
  try {
    sha = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
    diff = execSync('git show HEAD --stat --patch', { cwd: PROJECT_ROOT }).toString();
  } catch (err) {
    console.error('[reviews] Could not read git state:', err.message);
    process.exit(0);
  }

  mkdirSync(REVIEWS_DIR, { recursive: true });

  // Lazy-require SDK so script fails gracefully if not installed
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (err) {
    console.error('[reviews] @anthropic-ai/sdk not found — skipping reviews');
    process.exit(0);
  }

  const client = new Anthropic();
  const shortSha = sha.slice(0, 7);
  const truncatedDiff = diff.slice(0, 8000); // Keep prompt sizes reasonable

  console.log(`[reviews] Starting parallel reviews for ${shortSha}...`);

  const [correctness, scalability] = await Promise.all([
    callAPI(client, 'claude-haiku-4-5-20251001', correctnessPrompt(truncatedDiff, shortSha)),
    callAPI(client, 'claude-haiku-4-5-20251001', scalabilityPrompt(truncatedDiff, shortSha)),
  ]);

  const timestamp = new Date().toISOString();

  writeFileSync(
    join(REVIEWS_DIR, `${sha}-correctness.md`),
    `# Correctness Review — ${shortSha}\n_${timestamp}_\n\n${correctness}\n`
  );
  writeFileSync(
    join(REVIEWS_DIR, `${sha}-scalability.md`),
    `# Scalability Review — ${shortSha}\n_${timestamp}_\n\n${scalability}\n`
  );

  const hasHigh = /\*\*HIGH\*\*/i.test(correctness) || /\*\*HIGH\*\*/i.test(scalability);

  if (hasHigh) {
    // Exit 2 → asyncRewake wakes the model with the review output
    console.log(`\n[reviews] HIGH priority issues found for ${shortSha}. See .commit-reviews/ for details.\n`);
    console.log('--- CORRECTNESS REVIEW ---\n' + correctness);
    console.log('\n--- SCALABILITY REVIEW ---\n' + scalability);
    process.exit(2);
  }

  console.log(`[reviews] Both reviews complete for ${shortSha} — no HIGH issues.`);
}

async function callAPI(client, model, prompt) {
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0].text;
  } catch (err) {
    return `_Review failed: ${err.message}_`;
  }
}

function correctnessPrompt(diff, sha) {
  return `You are a senior code reviewer for cardsNight — a Next.js 16 / Supabase / TypeScript multiplayer card game.

Review commit ${sha}. Diff:

\`\`\`
${diff}
\`\`\`

Focus ONLY on correctness and code health:
- Does the change achieve its stated goal? Trace the happy path.
- Logic errors, off-by-one bugs, missing edge cases
- Supabase RLS: new table access must have correct policies; admin client only server-side
- Game rules: scoring = 10 + (10 × bid); last bidder can't make total bids = hand_size
- TypeScript: no \`any\`, no unsafe casts
- Dead code, unused imports, functions doing too many things
- New logic must have unit tests; bug fixes must have regression tests

Categorise as HIGH / MEDIUM / LOW — skip empty sections:

**HIGH** — broken functionality, data loss, security hole, failing tests

**MEDIUM** — incorrect behaviour under edge cases, missing tests, maintenance debt

**LOW** — naming, style, optional polish

**Verdict:** one sentence — ready to merge or not.

Keep total under 30 lines.`;
}

function scalabilityPrompt(diff, sha) {
  return `You are a scalability reviewer for cardsNight — a Next.js 16 / Supabase / TypeScript multiplayer card game.

Review commit ${sha} for scaling issues only. Diff:

\`\`\`
${diff}
\`\`\`

Focus ONLY on whether this code holds up under load (100+ concurrent games, 1000+ users):
- N+1 queries: DB calls inside loops
- Unbounded queries without LIMIT on growing tables (game_results, round_scores, bids)
- Missing indexes on columns used in WHERE / JOIN / ORDER BY
- Realtime channels: too many per client, or re-subscribing on every render
- O(n) server-side operations where n grows with users or game history
- RLS policies that cause full-table scans

Categorise as HIGH / MEDIUM / LOW — skip empty sections:

**HIGH** — will break or be unacceptably slow with 100+ concurrent games

**MEDIUM** — degrades noticeably at scale; fix before public launch

**LOW** — minor inefficiency; acceptable now

**Verdict:** one sentence — scale-ready or not.

Keep total under 25 lines.`;
}

main().catch((err) => {
  console.error('[reviews] Unexpected error:', err.message);
  process.exit(0); // Don't block the workflow on unexpected failures
});
