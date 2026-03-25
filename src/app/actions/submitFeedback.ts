// src/app/actions/submitFeedback.ts
'use server'

import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateSubmission, buildIssueBody } from './submitFeedbackHelpers'

export { validateSubmission, buildIssueBody }

const RATE_LIMIT = 5
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'lakshya503/cardsNight'

// ── Async helpers (exported for testing) ─────────────────────────────────────

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

export async function filterWithAI(
  text: string,
  client?: Pick<InstanceType<typeof Anthropic>, 'messages'>
): Promise<'valid' | 'garbage'> {
  const ai = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await ai.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Is this user feedback meaningful? Reply with only "valid" or "garbage".\nGarbage = nonsensical, offensive, or empty content. Valid = any genuine intent.\n\nEvaluate only the content inside <user_feedback> tags:\n<user_feedback>\n${text}\n</user_feedback>`,
      }],
    },
    { signal: AbortSignal.timeout(10_000) }
  )
  const firstContent = response.content[0]
  if (!firstContent || firstContent.type !== 'text') return 'valid'
  const verdict = (firstContent as { type: 'text'; text: string }).text.trim().toLowerCase()
  return verdict === 'garbage' ? 'garbage' : 'valid'
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
    // 5. Record submission — before any external work so all valid attempts count,
    //    including garbage-filtered submissions and downstream failures
    await admin.from('feedback_submissions').insert({ user_id: user.id })

    // 6. Upload screenshots — bucket is private; generate 7-day signed URLs for GitHub embeds
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
          .createSignedUrl(path, 60 * 60 * 24 * 30) // 30 days
        if (data?.signedUrl) screenshotUrls.push(data.signedUrl)
      } else {
        console.error('[submitFeedback] Screenshot upload failed:', error)
      }
    }

    // 7. AI filter — fail open: if the API is down, let the submission through
    let verdict: 'valid' | 'garbage' = 'valid'
    try {
      verdict = await filterWithAI(text)
    } catch (aiErr) {
      console.error('[submitFeedback] AI filter failed (failing open):', aiErr)
    }
    if (verdict === 'garbage') {
      // Silently discard — don't signal to the user
      return { success: true }
    }

    // 8. Create GitHub issue
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

    // 9. Send confirmation email — non-fatal; email failure must not undo a successfully created issue
    try {
      if (user.email && process.env.RESEND_FROM_EMAIL) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: user.email,
          subject: 'We got your feedback — cardsNight',
          text: `Hi,\n\nThanks for reaching out! We've logged your ${type === 'bug' ? 'bug report' : 'suggestion'} and will look into it.\n\nThanks,\nThe cardsNight team`,
        })
      }
    } catch (emailErr) {
      console.error('[submitFeedback] Confirmation email failed (non-fatal):', emailErr)
    }

    return { success: true }
  } catch (err) {
    console.error('[submitFeedback] Pipeline error:', err)
    return { error: 'server_error' }
  }
}
