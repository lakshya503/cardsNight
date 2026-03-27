#!/usr/bin/env node
/**
 * .github/scripts/ci-review.js
 *
 * Runs correctness (Sonnet) + scalability (Haiku) reviews IN PARALLEL for a PR.
 * Called by the GitHub Actions `review` job on pull_request events.
 *
 * Posts results as a PR comment and exits 1 if any HIGH priority issues found
 * (which fails the required status check, blocking merge).
 *
 * Required environment variables:
 *   ANTHROPIC_API_KEY  — Anthropic API key (set as a GitHub Actions secret)
 *   GITHUB_TOKEN       — auto-provided by Actions
 *   BASE_SHA           — PR base commit SHA (github.event.pull_request.base.sha)
 *   HEAD_SHA           — PR head commit SHA (github.sha)
 *   PR_NUMBER          — PR number (github.event.pull_request.number)
 *   REPO               — "owner/repo" (github.repository)
 */

'use strict';

const { execSync } = require('child_process');
const https = require('https');

const { BASE_SHA, HEAD_SHA, PR_NUMBER, REPO } = process.env;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[ci-review] ANTHROPIC_API_KEY not set — skipping reviews');
    process.exit(0);
  }

  let diff;
  try {
    diff = execSync(`git diff ${BASE_SHA}...${HEAD_SHA} --stat --patch`, { encoding: 'utf8' });
  } catch (err) {
    console.error('[ci-review] Could not get diff:', err.message);
    process.exit(0);
  }

  if (!diff.trim()) {
    console.log('[ci-review] Empty diff — skipping reviews');
    process.exit(0);
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    console.error('[ci-review] @anthropic-ai/sdk not found — skipping reviews');
    process.exit(0);
  }

  const client = new Anthropic();
  const shortSha = HEAD_SHA.slice(0, 7);
  const truncatedDiff = diff.slice(0, 8000);

  console.log(`[ci-review] Running parallel reviews for ${shortSha}...`);

  const [correctness, scalability] = await Promise.all([
    callAPI(client, 'claude-haiku-4-5-20251001', correctnessPrompt(truncatedDiff, shortSha)),
    callAPI(client, 'claude-haiku-4-5-20251001', scalabilityPrompt(truncatedDiff, shortSha)),
  ]);

  const hasHigh =
    /\*\*HIGH\*\*/i.test(correctness) || /\*\*HIGH\*\*/i.test(scalability);

  console.log('\n--- CORRECTNESS REVIEW ---\n' + correctness);
  console.log('\n--- SCALABILITY REVIEW ---\n' + scalability);

  if (PR_NUMBER && REPO) {
    await postComment(formatComment(shortSha, correctness, scalability, hasHigh));
  }

  if (hasHigh) {
    console.log('\n[ci-review] HIGH priority issues found — failing CI. Fix before merging.');
    process.exit(1);
  }

  console.log(`\n[ci-review] Both reviews complete for ${shortSha} — no HIGH issues. Ready to merge.`);
  process.exit(0);
}

function formatComment(sha, correctness, scalability, hasHigh) {
  const badge = hasHigh
    ? '🔴 **HIGH priority issues found — merge blocked**'
    : '✅ **No critical issues — ready to merge**';

  return [
    `## AI Code Review — \`${sha}\``,
    '',
    badge,
    '',
    '### Correctness Review (Sonnet)',
    '',
    correctness,
    '',
    '---',
    '',
    '### Scalability Review (Haiku)',
    '',
    scalability,
  ].join('\n');
}

async function postComment(body) {
  const [owner, repo] = REPO.split('/');
  const payload = JSON.stringify({ body });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'cardsNight-ci-review',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 300) {
            console.error(`[ci-review] Failed to post comment (HTTP ${res.statusCode}):`, data);
          }
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      console.error('[ci-review] Comment post error:', err.message);
      resolve(); // Don't fail CI for a comment error
    });
    req.write(payload);
    req.end();
  });
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
  console.error('[ci-review] Unexpected error:', err.message);
  process.exit(0); // Don't block CI on unexpected failures
});
