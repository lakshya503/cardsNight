// src/components/rules/JudgementRules.tsx
// Rules content for Judgement. Kept separate so adding a second game only
// requires a new sibling file + one entry in HowToPlayModal's switch.

export function JudgementRules() {
  return (
    <div className="space-y-4 text-sm" style={{ color: 'var(--color-text)' }}>

      <section className="space-y-1">
        <h3 className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Goal</h3>
        <p>Predict exactly how many tricks you&apos;ll win each round. The player with the highest cumulative score after all rounds wins.</p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Rounds</h3>
        <p>Hand size starts high and decreases by 1 each round down to 1. The trump suit changes every round — it&apos;s revealed by flipping the top card of the undealt deck and stays visible to everyone.</p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Bidding</h3>
        <p>Before play, each player bids how many tricks they&apos;ll win. Bids go in turn order. The last bidder cannot bid a number that would make the total bids equal the number of cards dealt — someone must be set up to fail.</p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Playing a trick</h3>
        <p>The leader plays any card. Other players must follow the led suit if they can. If you&apos;re void in the led suit, you may play a trump card (cut) or any other card (fuse). Highest trump wins; if no trump was played, highest card of the led suit wins.</p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Scoring</h3>
        <div className="space-y-1">
          <p><span className="font-medium">Exact bid</span> — 10 + (10 × bid). Bid 0 and win 0 = 10 pts. Bid 3 and win 3 = 40 pts.</p>
          <p><span className="font-medium">Any other result</span> — 0 pts for that round.</p>
        </div>
      </section>

    </div>
  )
}
