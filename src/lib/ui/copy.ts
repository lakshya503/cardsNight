/**
 * All user-facing strings in one place.
 * Keeps tone consistent and makes copy changes trivial.
 * Tone: friendly, warm, slightly quirky. Never cold or corporate.
 */

export const copy = {
  // ── Auth ──────────────────────────────────────────────
  auth: {
    signInHeading:    'Ready to play?',
    signInSubheading: 'Sign in to join the fun.',
    signInButton:     'Continue with Google',
    signOutButton:    'Sign out',
  },

  // ── Home ──────────────────────────────────────────────
  home: {
    heading:     "Let's play cards.",
    subheading:  'Grab your friends. No download needed.',
    createRoom:  'Create a room',
    joinRoom:    'Join a room',
  },

  // ── Room creation ─────────────────────────────────────
  createRoom: {
    heading:          'Set up your room',
    maxPlayersLabel:  'Max players',
    timerLabel:       'Turn timer',
    timerNoneOption:  'No timer',
    submitButton:     "Let's go!",
    submitting:       'Creating your room...',
  },

  // ── Join room ─────────────────────────────────────────
  joinRoom: {
    heading:     'Got an invite code?',
    codePlaceholder: 'Enter code (e.g. AB3CD7X)',
    submitButton:    'Join game',
    submitting:      'Joining...',
  },

  // ── Waiting room ──────────────────────────────────────
  waitingRoom: {
    heading:           'Waiting for your crew...',
    hostBadge:         'Host',
    youBadge:          'You',
    inviteHeading:     'Invite friends',
    copyLink:          'Copy invite link',
    linkCopied:        'Link copied — send it!',
    roomCodeLabel:     'Room code',
    startGame:         'Start game',
    startGameDisabled: 'Round up at least 4 friends first!',
    waitingForHost:    "Hang tight — the host will start soon.",
    leaveRoom:         'Leave room',
    leaveRoomConfirm:  'Leave this room?',
    playerCount:       (current: number, max: number) =>
                         `${current} of ${max} players joined`,
  },

  // ── Errors ────────────────────────────────────────────
  errors: {
    roomNotFound:    "Hmm, we couldn't find that room. Double-check the code?",
    roomExpired:     "This room has expired. Ask your host to create a new one!",
    roomInvalid:     "That room doesn't exist or has expired. Want to start your own?",
    roomFull:        "Looks like this party's packed! Try creating your own.",
    roomInProgress:  "This game's already started. Next time!",
    alreadyInRoom:   "You're already in this room — no need to join twice!",
    generic:         "Something went wrong. Give it another shot?",
  },

  // ── Disconnection ─────────────────────────────────────
  disconnection: {
    playerDisconnected: (name: string) =>
      `Uh oh — ${name} seems to have vanished.`,
    reconnectCountdown: (seconds: number) =>
      `${seconds}s to reconnect before we move on...`,
    playerDropped: (name: string) =>
      `${name} has left the game. Their score stays on the board.`,
    youDisconnected: "You lost connection! Trying to get you back in...",
  },

  // ── Game (stubs for M2) ───────────────────────────────
  game: {
    yourTurn:       "Your turn!",
    waitingForTurn: (name: string) => `Waiting for ${name}...`,
    trumpLabel:     'Trump',
    bidLabel:       'Your bid',
    tricksWon:      'Tricks won',
    roundLabel:     (n: number) => `Round ${n}`,
    howToPlay:      'How to play',
  },
} as const
