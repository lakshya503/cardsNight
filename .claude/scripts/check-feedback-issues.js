// Surfaced at session start by the SessionStart hook in .claude/settings.json.
// Checks GitHub for new customer feedback issues since the last session and
// prints a notification if any are found.

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const LAST_SEEN_FILE = path.resolve(__dirname, '../feedback-last-seen.txt')
const REPO = 'lakshya503/cardsNight'
const LABELS = ['customer-reported-issue', 'customer-suggestion']

const lastSeen = fs.existsSync(LAST_SEEN_FILE)
  ? fs.readFileSync(LAST_SEEN_FILE, 'utf8').trim()
  : '2000-01-01T00:00:00Z'

try {
  const results = LABELS.map(label =>
    execSync(
      `gh issue list --repo ${REPO} --label "${label}" --state open --json number,title,createdAt,labels --limit 20`,
      { encoding: 'utf8' }
    )
  ).map(r => JSON.parse(r))

  // Merge and deduplicate by issue number (an issue can have both labels)
  const seen = new Set()
  const issues = results.flat().filter(i => {
    if (seen.has(i.number)) return false
    seen.add(i.number)
    return true
  })

  const newIssues = issues.filter(i => new Date(i.createdAt) > new Date(lastSeen))

  if (newIssues.length > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`📬 ${newIssues.length} new customer feedback issue${newIssues.length !== 1 ? 's' : ''}:`)
    newIssues.forEach(i => {
      const type = i.labels.find(l => l.name === 'customer-suggestion') ? 'suggestion' : 'bug'
      const mins = Math.round((Date.now() - new Date(i.createdAt).getTime()) / 60000)
      const age = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
      console.log(`  #${i.number} — "${i.title}" (${type}, ${age})`)
    })
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  }

  fs.writeFileSync(LAST_SEEN_FILE, new Date().toISOString())
} catch (err) {
  // Never block session start, but surface any failure so auth/tool issues are visible
  console.warn('[feedback-issues] Could not fetch issues:', err)
}
