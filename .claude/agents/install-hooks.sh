#!/bin/sh
# Run this once to install git hooks for cardsNight: sh .claude/agents/install-hooks.sh

HOOK=.git/hooks/post-commit

cat > "$HOOK" << 'EOF'
#!/bin/sh
echo ""
echo "▶ Running tests after commit..."
cd "$(git rev-parse --show-toplevel)"

if npm test -- --silent 2>&1 | tail -5; then
  echo "✅ All tests passed."
else
  echo ""
  echo "❌ Tests failed — fix before merging to main."
  exit 1
fi
EOF

chmod +x "$HOOK"
echo "✅ post-commit hook installed at $HOOK"
