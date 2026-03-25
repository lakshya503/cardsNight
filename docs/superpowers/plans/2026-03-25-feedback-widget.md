# Feedback Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating feedback widget to all pages that lets authenticated users report bugs or suggestions with optional screenshots, filters garbage submissions via AI, creates labeled GitHub issues, sends a confirmation email, and notifies the developer at session start.

**Architecture:** A client-side `FeedbackWidget` component mounts in the root layout and calls a single `submitFeedback` server action. The action runs a sequential pipeline: rate-limit check → screenshot upload to Supabase Storage → AI filter via Claude Haiku → GitHub issue creation → confirmation email via Resend. A `SessionStart` hook in `.claude/settings.json` polls GitHub for new feedback issues and surfaces them prominently at the start of every Claude Code session.

**Tech Stack:** Next.js App Router server actions, Supabase Storage, `@anthropic-ai/sdk` (Haiku filter), `resend` (email), GitHub REST API, React Testing Library, Vitest.

---

## Prerequisites (manual steps before any code)

- [ ] **Create GitHub labels** — in the `lakshya503/cardsNight` repo, create two labels:
  - `customer-reported-issue` (color: `#d73a4a`)
  - `customer-suggestion` (color: `#0075ca`)
- [ ] **Generate GitHub token** — create a fine-grained personal access token scoped to `lakshya503/cardsNight`, with **Issues: Read & Write** permission only. Save it — you'll add it to `.env.local` in Task 1.
- [ ] **Set up Resend** — create a free account at resend.com, verify your sending domain (or use `onboarding@resend.dev` for dev/testing). Get the API key.

---

## Feature branch

- [ ] **Create feature branch**

```bash
git checkout -b feat/feedback-widget
```

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/FeedbackWidget.tsx` | CREATE | Floating button + modal UI, screenshot paste/upload, calls server action |
| `src/components/__tests__/FeedbackWidget.test.tsx` | CREATE | Widget unit tests |
| `src/app/actions/submitFeedback.ts` | CREATE | Server action: full submission pipeline |
| `src/app/actions/__tests__/submitFeedback.test.ts` | CREATE | Pipeline unit tests (pure helpers) |
| `src/lib/supabase/database.types.ts` | MODIFY | Add `feedback_submissions` table type |
| `src/app/layout.tsx` | MODIFY | Mount `<FeedbackWidget />` |
| `.env.example` | MODIFY | Add `GITHUB_TOKEN`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `RESEND_FROM_EMAIL` |
| `.claude/settings.json` | MODIFY | Add `SessionStart` hook |

---

## Task 1: Install packages and update env vars

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env.example`
- Modify: `.env.local` (not committed)

- [ ] **Install new packages**

```bash
npm install resend @anthropic-ai/sdk
```

Expected: both packages appear in `package.json` dependencies.

- [ ] **Update `.env.example`** — add these lines:

```
GITHUB_TOKEN=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Update `.env.local`** — fill in the real values from the prerequisites above. `RESEND_FROM_EMAIL` is your verified sending address (e.g. `noreply@yourdomain.com` or `onboarding@resend.dev` for dev).

- [ ] **Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add resend and anthropic-sdk dependencies for feedback widget"
```

---

## Task 2: Database setup

**Files:**
- Modify: `src/lib/supabase/database.types.ts` (manual type addition)
- Supabase dashboard: SQL editor (for table + bucket — no migration file needed for this MVP)

- [ ] **Create `feedback_submissions` table** — run in Supabase SQL editor:

```sql
create table public.feedback_submissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now() not null
);

-- Only the server (service role) needs to read/write this table
alter table public.feedback_submissions enable row level security;
-- No RLS policies needed — admin client bypasses RLS
```

- [ ] **Create `feedback-screenshots` storage bucket** — run in Supabase SQL editor:

```sql
-- Private bucket: only the service role can read; authenticated users can upload.
-- The server action generates signed URLs (7-day expiry) for embedding in GitHub issues.
insert into storage.buckets (id, name, public)
values ('feedback-screenshots', 'feedback-screenshots', false);

create policy "authenticated users can upload feedback screenshots"
on storage.objects for insert
to authenticated
with check (bucket_id = 'feedback-screenshots');

-- Service role (admin client) can read for signed URL generation — no extra policy needed.
```

- [ ] **Add type to `database.types.ts`** — find the `public: { Tables: {` section and add:

```typescript
feedback_submissions: {
  Row: {
    id: string
    user_id: string
    created_at: string
  }
  Insert: {
    id?: string
    user_id: string
    created_at?: string
  }
  Update: {
    id?: string
    user_id?: string
    created_at?: string
  }
  Relationships: []
}
```

- [ ] **Commit**

```bash
git add src/lib/supabase/database.types.ts
git commit -m "chore: add feedback_submissions table type; create table and storage bucket in Supabase"
```

---

## Task 3: Server action — tests first

**Files:**
- Create: `src/app/actions/__tests__/submitFeedback.test.ts`

The server action will be structured with pure helper functions that are easy to test. Write tests for those helpers now — the action itself is just orchestration.

- [ ] **Create directories**

```bash
mkdir -p src/app/actions/__tests__
```

- [ ] **Create test file**

```typescript
// src/app/actions/__tests__/submitFeedback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isRateLimited,
  filterWithAI,
  buildIssueBody,
  validateSubmission,
} from '../submitFeedback'

// vi.mock calls are hoisted by Vitest — must be at the top level, not inside beforeEach
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}))

// ── validateSubmission ────────────────────────────────────────────────────────

describe('validateSubmission', () => {
  it('returns error when text is empty', () => {
    expect(validateSubmission('', 'bug', [])).toBe('text_required')
  })

  it('returns error when text is whitespace only', () => {
    expect(validateSubmission('   ', 'bug', [])).toBe('text_required')
  })

  it('returns error when screenshots exceed limit', () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png'), new File(['c'], 'c.png')]
    expect(validateSubmission('valid text', 'bug', files)).toBe('too_many_screenshots')
  })

  it('returns null when input is valid', () => {
    expect(validateSubmission('Something broke', 'bug', [])).toBeNull()
  })

  it('returns null with up to 2 screenshots', () => {
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')]
    expect(validateSubmission('Works great', 'suggestion', files)).toBeNull()
  })
})

// ── filterWithAI ──────────────────────────────────────────────────────────────

describe('filterWithAI', () => {
  // The top-level vi.mock('@anthropic-ai/sdk') is already hoisted — use vi.mocked() to configure per-test

  it('returns "valid" for meaningful feedback', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'valid' }],
        }),
      },
    } as never))

    const result = await filterWithAI('The scoreboard does not update after round 2')
    expect(result).toBe('valid')
  })

  it('returns "garbage" for nonsensical input', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'garbage' }],
        }),
      },
    } as never))

    const result = await filterWithAI('asdfghjkl qwerty 123')
    expect(result).toBe('garbage')
  })
})

// ── buildIssueBody ────────────────────────────────────────────────────────────

describe('buildIssueBody', () => {
  it('includes all context fields', () => {
    const body = buildIssueBody({
      text: 'Something broke',
      userEmail: 'alice@example.com',
      pageUrl: '/game/abc123',
      userAgent: 'Mozilla/5.0',
      screenSize: '1440x900',
      screenshotUrls: [],
    })

    expect(body).toContain('alice@example.com')
    expect(body).toContain('/game/abc123')
    expect(body).toContain('Something broke')
    expect(body).toContain('1440x900')
  })

  it('embeds screenshot image links when provided', () => {
    const body = buildIssueBody({
      text: 'See screenshot',
      userEmail: 'bob@example.com',
      pageUrl: '/',
      userAgent: 'Mozilla/5.0',
      screenSize: '1280x800',
      screenshotUrls: ['https://example.com/img1.png', 'https://example.com/img2.png'],
    })

    expect(body).toContain('![screenshot-1](https://example.com/img1.png)')
    expect(body).toContain('![screenshot-2](https://example.com/img2.png)')
  })

  it('omits screenshot section when none provided', () => {
    const body = buildIssueBody({
      text: 'No images',
      userEmail: 'c@c.com',
      pageUrl: '/',
      userAgent: 'ua',
      screenSize: '1024x768',
      screenshotUrls: [],
    })

    expect(body).not.toContain('screenshot')
  })
})

// ── isRateLimited ─────────────────────────────────────────────────────────────

describe('isRateLimited', () => {
  it('returns true when user has 5 or more submissions in the last 24h', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      }),
    }

    const result = await isRateLimited('user-123', mockAdmin as never)
    expect(result).toBe(true)
  })

  it('returns false when user has fewer than 5 submissions', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }),
      }),
    }

    const result = await isRateLimited('user-123', mockAdmin as never)
    expect(result).toBe(false)
  })
})
```

- [ ] **Run tests — verify they fail**

```bash
npm test -- src/app/actions/__tests__/submitFeedback.test.ts
```

Expected: FAIL — `Cannot find module '../submitFeedback'`

---

## Task 4: Server action — implementation

**Files:**
- Create: `src/app/actions/submitFeedback.ts`

- [ ] **Create the server action**

```typescript
// src/app/actions/submitFeedback.ts
'use server'

import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_SCREENSHOTS = 2
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 // 2MB
const RATE_LIMIT = 5
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000
const GITHUB_REPO = 'lakshya503/cardsNight'

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function validateSubmission(
  text: string,
  _type: 'bug' | 'suggestion',
  screenshots: File[]
): 'text_required' | 'too_many_screenshots' | 'file_too_large' | null {
  if (!text.trim()) return 'text_required'
  if (screenshots.length > MAX_SCREENSHOTS) return 'too_many_screenshots'
  if (screenshots.some(f => f.size > MAX_FILE_SIZE_BYTES)) return 'file_too_large'
  return null
}

export async function isRateLimited(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('feedback_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT
}

export async function filterWithAI(text: string): Promise<'valid' | 'garbage'> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content: `Is this user feedback meaningful? Reply with only "valid" or "garbage".\nGarbage = nonsensical, offensive, or empty content. Valid = any genuine intent.\n\nFeedback: ${text}`,
    }],
  })
  const verdict = (response.content[0] as { text: string }).text.trim().toLowerCase()
  return verdict === 'garbage' ? 'garbage' : 'valid'
}

export function buildIssueBody(params: {
  text: string
  userEmail: string
  pageUrl: string
  userAgent: string
  screenSize: string
  screenshotUrls: string[]
}): string {
  const { text, userEmail, pageUrl, userAgent, screenSize, screenshotUrls } = params

  const screenshotSection = screenshotUrls.length > 0
    ? `\n\n**Screenshots:**\n${screenshotUrls.map((url, i) => `![screenshot-${i + 1}](${url})`).join('\n')}`
    : ''

  return `**Reporter:** ${userEmail}
**Page:** ${pageUrl}
**User Agent:** ${userAgent}
**Screen:** ${screenSize}

---

${text}${screenshotSection}`
}

// ── Server action ─────────────────────────────────────────────────────────────

export type SubmitFeedbackResult =
  | { success: true }
  | { error: 'unauthenticated' | 'validation' | 'rate_limited' | 'server_error'; message?: string }

export async function submitFeedback(formData: FormData): Promise<SubmitFeedbackResult> {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthenticated' }

  const admin = createAdminClient()

  // 2. Parse inputs
  const text = (formData.get('text') as string) ?? ''
  const type = (formData.get('type') as 'bug' | 'suggestion') ?? 'bug'
  const pageUrl = (formData.get('pageUrl') as string) ?? '/'
  const userAgent = (formData.get('userAgent') as string) ?? ''
  const screenSize = (formData.get('screenSize') as string) ?? ''
  const screenshotFiles = formData.getAll('screenshots') as File[]

  // 3. Validate
  const validationError = validateSubmission(text, type, screenshotFiles)
  if (validationError) return { error: 'validation', message: validationError }

  // 4. Rate limit
  const rateLimited = await isRateLimited(user.id, admin)
  if (rateLimited) return { error: 'rate_limited' }

  try {
    // 5. Upload screenshots — bucket is private; generate 7-day signed URLs for GitHub embeds
    const screenshotUrls: string[] = []
    for (const file of screenshotFiles) {
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await admin.storage
        .from('feedback-screenshots')
        .upload(path, file, { contentType: file.type })
      if (!error) {
        const { data } = await admin.storage
          .from('feedback-screenshots')
          .createSignedUrl(path, 60 * 60 * 24 * 7) // 7 days
        if (data?.signedUrl) screenshotUrls.push(data.signedUrl)
      }
    }

    // 6. AI filter
    const verdict = await filterWithAI(text)
    if (verdict === 'garbage') {
      // Silently discard — don't signal to the user
      return { success: true }
    }

    // 7. Create GitHub issue
    const label = type === 'bug' ? 'customer-reported-issue' : 'customer-suggestion'
    const issueTitle = `[${type === 'bug' ? 'Bug' : 'Suggestion'}] ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`
    const issueBody = buildIssueBody({
      text,
      userEmail: user.email ?? 'unknown',
      pageUrl,
      userAgent,
      screenSize,
      screenshotUrls,
    })

    const ghResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: issueTitle, body: issueBody, labels: [label] }),
    })

    if (!ghResponse.ok) {
      console.error('[submitFeedback] GitHub issue creation failed:', ghResponse.status, await ghResponse.text())
      return { error: 'server_error' }
    }

    // 8. Send confirmation email — non-fatal; email failure must not undo a successfully created issue
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: user.email!,
        subject: 'We got your feedback — cardsNight',
        text: `Hi,\n\nThanks for reaching out! We've logged your ${type === 'bug' ? 'bug report' : 'suggestion'} and will look into it.\n\nThanks,\nThe cardsNight team`,
      })
    } catch (emailErr) {
      console.error('[submitFeedback] Confirmation email failed (non-fatal):', emailErr)
    }

    // 9. Record submission for rate limiting (only after confirmed success)
    await admin
      .from('feedback_submissions')
      .insert({ user_id: user.id })

    return { success: true }
  } catch (err) {
    console.error('[submitFeedback] Pipeline error:', err)
    return { error: 'server_error' }
  }
}
```

- [ ] **Run tests — verify they pass**

```bash
npm test -- src/app/actions/__tests__/submitFeedback.test.ts
```

Expected: all tests PASS.

- [ ] **Run full test suite — verify no regressions**

```bash
npm test
```

Expected: all existing tests still PASS.

- [ ] **Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/app/actions/submitFeedback.ts src/app/actions/__tests__/submitFeedback.test.ts
git commit -m "feat: add submitFeedback server action with AI filter, GitHub issue creation, and email"
```

---

## Task 5: FeedbackWidget component — tests first

**Files:**
- Create: `src/components/__tests__/FeedbackWidget.test.tsx`

- [ ] **Create directories**

```bash
mkdir -p src/components/__tests__
```

- [ ] **Create test file**

```typescript
// src/components/__tests__/FeedbackWidget.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeedbackWidget } from '../FeedbackWidget'

// Mock the server action
vi.mock('@/app/actions/submitFeedback', () => ({
  submitFeedback: vi.fn(),
}))

import { submitFeedback } from '@/app/actions/submitFeedback'

describe('FeedbackWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Button ──────────────────────────────────────────────────────────────────

  it('renders a floating trigger button', () => {
    render(<FeedbackWidget />)
    expect(screen.getByTestId('feedback-trigger')).toBeInTheDocument()
  })

  it('opens the modal when the trigger is clicked', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument()
  })

  it('closes the modal when the close button is clicked', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    await userEvent.click(screen.getByTestId('feedback-close'))
    expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument()
  })

  // ── Form ────────────────────────────────────────────────────────────────────

  it('disables the submit button when text is empty', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-submit')).toBeDisabled()
  })

  it('enables the submit button when text is entered', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Something is broken')
    expect(screen.getByTestId('feedback-submit')).not.toBeDisabled()
  })

  it('shows type toggle with bug selected by default', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    expect(screen.getByTestId('feedback-type-bug')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('feedback-type-suggestion')).toHaveAttribute('aria-pressed', 'false')
  })

  // ── Submission ──────────────────────────────────────────────────────────────

  it('shows success message after successful submission', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: true })

    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Something broke')
    await userEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-success')).toHaveTextContent("Thanks! We're working on it.")
    })
  })

  it('shows rate limit error when rate limited', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ error: 'rate_limited' })

    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))
    await userEvent.type(screen.getByTestId('feedback-text'), 'Another report')
    await userEvent.click(screen.getByTestId('feedback-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('feedback-error')).toBeInTheDocument()
    })
  })

  // ── Screenshots ─────────────────────────────────────────────────────────────

  it('shows screenshot preview after file is selected', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))

    const file = new File(['image'], 'screenshot.png', { type: 'image/png' })
    const input = screen.getByTestId('feedback-screenshot-input')
    await userEvent.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('feedback-screenshot-preview-0')).toBeInTheDocument()
    })
  })

  it('does not allow more than 2 screenshots', async () => {
    render(<FeedbackWidget />)
    await userEvent.click(screen.getByTestId('feedback-trigger'))

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.png', { type: 'image/png' }),
    ]
    const input = screen.getByTestId('feedback-screenshot-input')
    await userEvent.upload(input, files)

    // Only 2 previews should appear
    expect(screen.getAllByTestId(/feedback-screenshot-preview-/)).toHaveLength(2)
  })
})
```

- [ ] **Run tests — verify they fail**

```bash
npm test -- src/components/__tests__/FeedbackWidget.test.tsx
```

Expected: FAIL — `Cannot find module '../FeedbackWidget'`

---

## Task 6: FeedbackWidget component — implementation

**Files:**
- Create: `src/components/FeedbackWidget.tsx`

- [ ] **Create the component**

```tsx
// src/components/FeedbackWidget.tsx
'use client'

import { useState, useRef } from 'react'
import { submitFeedback } from '@/app/actions/submitFeedback'

type FeedbackType = 'bug' | 'suggestion'

interface Screenshot {
  file: File
  preview: string
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [text, setText] = useState('')
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error' | 'rate_limited'>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function close() {
    setOpen(false)
    setType('bug')
    setText('')
    setScreenshots([])
    setStatus('idle')
  }

  const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

  function addScreenshots(files: File[]) {
    const remaining = 2 - screenshots.length
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE)
    const toAdd = valid.slice(0, remaining)
    const newScreenshots = toAdd.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setScreenshots(prev => [...prev, ...newScreenshots])
  }

  function removeScreenshot(index: number) {
    setScreenshots(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSubmit() {
    setStatus('submitting')

    const formData = new FormData()
    formData.set('text', text)
    formData.set('type', type)
    formData.set('pageUrl', window.location.pathname)
    formData.set('userAgent', navigator.userAgent)
    formData.set('screenSize', `${window.screen.width}x${window.screen.height}`)
    screenshots.forEach(s => formData.append('screenshots', s.file))

    const result = await submitFeedback(formData)

    if ('success' in result) {
      setStatus('success')
    } else if (result.error === 'rate_limited') {
      setStatus('rate_limited')
    } else {
      setStatus('error')
    }
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        data-testid="feedback-trigger"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-5 right-5 z-50 flex items-center justify-center w-11 h-11 rounded-full shadow-lg transition-transform hover:scale-105"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-strong)',
          color: 'var(--color-text-muted)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal backdrop + panel */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end p-4 sm:p-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget) close() }}
        >
          <div
            data-testid="feedback-modal"
            className="w-full sm:w-96 rounded-xl p-5 space-y-4 shadow-lg"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Send feedback
              </h2>
              <button
                data-testid="feedback-close"
                onClick={close}
                aria-label="Close"
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ✕
              </button>
            </div>

            {status === 'success' ? (
              <p data-testid="feedback-success" className="text-sm py-4 text-center" style={{ color: 'var(--color-success)' }}>
                Thanks! We&apos;re working on it.
              </p>
            ) : (
              <>
                {/* Type toggle */}
                <div className="flex gap-2">
                  {(['bug', 'suggestion'] as FeedbackType[]).map(t => (
                    <button
                      key={t}
                      data-testid={`feedback-type-${t}`}
                      aria-pressed={type === t}
                      onClick={() => setType(t)}
                      className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: type === t ? 'var(--color-primary-light)' : 'var(--color-surface-raised)',
                        color: type === t ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        border: `1px solid ${type === t ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      }}
                    >
                      {t === 'bug' ? '🐛 Bug' : '💡 Suggestion'}
                    </button>
                  ))}
                </div>

                {/* Text area */}
                <textarea
                  data-testid="feedback-text"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={type === 'bug' ? "What's going wrong?" : "What would you improve?"}
                  rows={4}
                  className="w-full resize-none rounded-md px-3 py-2 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--color-surface-raised)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                />

                {/* Screenshots */}
                <div className="space-y-2">
                  {screenshots.length < 2 && (
                    <>
                      <input
                        ref={fileInputRef}
                        data-testid="feedback-screenshot-input"
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={e => {
                          if (e.target.files) addScreenshots(Array.from(e.target.files))
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        + Attach screenshot (optional, up to 2)
                      </button>
                    </>
                  )}
                  {screenshots.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {screenshots.map((s, i) => (
                        <div key={i} data-testid={`feedback-screenshot-preview-${i}`} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.preview} alt={`screenshot ${i + 1}`} className="w-16 h-16 rounded object-cover" />
                          <button
                            onClick={() => removeScreenshot(i)}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center"
                            style={{ backgroundColor: 'var(--color-error)', color: '#fff' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Error states */}
                {(status === 'error' || status === 'rate_limited') && (
                  <p data-testid="feedback-error" className="text-xs" style={{ color: 'var(--color-error)' }}>
                    {status === 'rate_limited'
                      ? "You've sent a lot of feedback recently — try again tomorrow."
                      : 'Something went wrong. Please try again.'}
                  </p>
                )}

                {/* Submit */}
                <button
                  data-testid="feedback-submit"
                  onClick={handleSubmit}
                  disabled={!text.trim() || status === 'submitting'}
                  className="w-full py-2 rounded-md text-sm font-semibold disabled:opacity-40 transition-opacity"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-text-on-primary)',
                  }}
                >
                  {status === 'submitting' ? 'Sending…' : 'Send feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Run widget tests — verify they pass**

```bash
npm test -- src/components/__tests__/FeedbackWidget.test.tsx
```

Expected: all tests PASS.

- [ ] **Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/components/FeedbackWidget.tsx src/components/__tests__/FeedbackWidget.test.tsx
git commit -m "feat: add FeedbackWidget floating button and modal"
```

---

## Task 7: Mount widget in root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Add `<FeedbackWidget />` to the layout**

Import and mount it inside `<body>`, after `{children}`:

```tsx
import { FeedbackWidget } from '@/components/FeedbackWidget'

// Inside <body>:
<body className={`${fraunces.variable} ${dmSans.variable}`}>
  {children}
  <FeedbackWidget />
</body>
```

- [ ] **Start dev server and verify visually**

```bash
npm run dev
```

- Open any page — the floating chat-bubble button should appear bottom-right
- Click it — modal opens
- Enter text, click submit — success message appears (requires env vars to be set for full pipeline)
- Close button dismisses the modal

- [ ] **Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: mount FeedbackWidget in root layout"
```

---

## Task 8: SessionStart hook — developer notifications

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Add the `SessionStart` hook** — add a `SessionStart` key to the `hooks` object. `SessionStart` hooks have no matcher. The script checks GitHub for new feedback issues since the last session and outputs a prominent notification if any exist.

The **complete** `hooks` object in `.claude/settings.json` after this change (merge carefully — preserve the existing `PreToolUse` and `PostToolUse` entries):

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "node -e \"const i=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const cmd=(i.tool_input&&i.tool_input.command)||'';if(/git\\s+(merge|push)/.test(cmd)){const fs=require('fs');const f='/Users/lakshyalahoty/Desktop/cardsNight/.review-pending';try{const sha=fs.readFileSync(f,'utf8').trim();console.error('\\n[GATE BLOCKED] Code review is pending for commit '+sha+'.\\nYou must:\\n  1. Wait for the code-reviewer task-notification\\n  2. Confirm zero Must Fix findings\\n  3. Delete .review-pending (rm .review-pending)\\nThen retry the merge/push.');process.exit(1);}catch(e){}}\" 2>&1 || exit 1"
        }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "node -e \"const i=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const cmd=(i.tool_input&&i.tool_input.command)||'';if(/git commit/.test(cmd)){const fs=require('fs');const {execSync}=require('child_process');try{const sha=execSync('git rev-parse HEAD',{cwd:'/Users/lakshyalahoty/Desktop/cardsNight'}).toString().trim();fs.writeFileSync('/Users/lakshyalahoty/Desktop/cardsNight/.review-pending',sha);console.log('[gate] .review-pending written for '+sha+'. Launch code-reviewer agent now. After zero Must Fix confirmed, run: rm .review-pending');}catch(e){console.log('[gate] Commit detected — launch code-reviewer agent now.');}}\" 2>/dev/null || true"
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node -e \"const {execSync}=require('child_process');const fs=require('fs');const f='/Users/lakshyalahoty/Desktop/cardsNight/.claude/feedback-last-seen.txt';const lastSeen=fs.existsSync(f)?fs.readFileSync(f,'utf8').trim():'2000-01-01T00:00:00Z';try{const r1=execSync('gh issue list --repo lakshya503/cardsNight --label customer-reported-issue --state open --json number,title,createdAt,labels --limit 20',{encoding:'utf8'});const r2=execSync('gh issue list --repo lakshya503/cardsNight --label customer-suggestion --state open --json number,title,createdAt,labels --limit 20',{encoding:'utf8'});const seen=new Set();const issues=[...JSON.parse(r1),...JSON.parse(r2)].filter(i=>{if(seen.has(i.number))return false;seen.add(i.number);return true;});const newIssues=issues.filter(i=>new Date(i.createdAt)>new Date(lastSeen));if(newIssues.length>0){console.log('\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('📬 '+newIssues.length+' new customer feedback issue'+(newIssues.length!==1?'s':'')+':');newIssues.forEach(i=>{const t=i.labels.find(l=>l.name==='customer-suggestion')?'suggestion':'bug';const mins=Math.round((Date.now()-new Date(i.createdAt).getTime())/60000);const age=mins<60?mins+'m ago':Math.round(mins/60)+'h ago';console.log('  #'+i.number+' — \"'+i.title+'\" ('+t+', '+age+')');});console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n');}fs.writeFileSync(f,new Date().toISOString());}catch(e){}\" 2>/dev/null || true"
        }
      ]
    }
  ]
}
```

- [ ] **Validate JSON syntax**

```bash
jq -e '.hooks.SessionStart[0].hooks[0].command' /Users/lakshyalahoty/Desktop/cardsNight/.claude/settings.json
```

Expected: exits 0, prints the command string.

- [ ] **Test the hook script manually** — simulate what the hook does:

```bash
gh issue list --repo lakshya503/cardsNight --label customer-reported-issue --state open --json number,title,createdAt,labels --limit 5
gh issue list --repo lakshya503/cardsNight --label customer-suggestion --state open --json number,title,createdAt,labels --limit 5
```

Expected: returns JSON (empty array `[]` is fine if no issues exist yet — that's correct).

- [ ] **Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add SessionStart hook to surface new customer feedback issues at session start"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm test` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] **Manual: submit a bug report** — widget opens, text entered, submit → GitHub issue created with `customer-reported-issue` label, confirmation email received
- [ ] **Manual: submit a suggestion** — GitHub issue created with `customer-suggestion` label
- [ ] **Manual: garbage input** — submit "aaaaaa qwerty" → success message shown but no GitHub issue created
- [ ] **Manual: SessionStart** — open `/hooks` to reload config, then start a new session → if a feedback issue exists, it surfaces in the notification
- [ ] **Manual: rate limit** — submit 5 times → 6th attempt shows rate limit message
