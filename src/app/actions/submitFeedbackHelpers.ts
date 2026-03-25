// src/app/actions/submitFeedbackHelpers.ts
// Pure synchronous helpers — no 'use server' so they can be freely exported
// without Turbopack requiring them to be async.

const MAX_SCREENSHOTS = 2
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 // 2MB

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
