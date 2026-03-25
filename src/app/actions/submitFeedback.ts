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
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'lakshya503/cardsNight'

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function validateSubmission(
  text: string,
  type: 'bug' | 'suggestion' | string,
  screenshots: File[]
): 'invalid_type' | 'text_required' | 'text_too_long' | 'too_many_screenshots' | 'file_too_large' | null {
  if (type !== 'bug' && type !== 'suggestion') return 'invalid_type'
  if (!text.trim()) return 'text_required'
  if (text.length > 5000) return 'text_too_long'
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
        content: `Is this user feedback meaningful? Reply with only "valid" or "garbage".\nGarbage = nonsensical, offensive, or empty content. Valid = any genuine intent.\n\nFeedback: ${text}`,
      }],
    },
    { signal: AbortSignal.timeout(10_000) }
  )
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

  return `**Reporter:** \`${userEmail}\`
**Page:** \`${pageUrl}\`
**User Agent:** \`${userAgent}\`
**Screen:** \`${screenSize}\`

---

\`\`\`
${text}
\`\`\`${screenshotSection}`
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
      } else {
        console.error('[submitFeedback] Screenshot upload failed:', error)
      }
    }

    // 6. AI filter
    const verdict = await filterWithAI(text)
    if (verdict === 'garbage') {
      // Silently discard — don't signal to the user
      return { success: true }
    }

    // 7. Record submission for rate limiting — before GitHub call so failures still count
    await admin
      .from('feedback_submissions')
      .insert({ user_id: user.id })

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
      if (user.email) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
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
