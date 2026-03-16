-- =============================================================
-- cardsNight: Initial Schema
-- =============================================================

-- ---------------------------------------------------------------
-- profiles
-- Extends Supabase auth.users with display info.
-- Created automatically on first Google Sign-In via a trigger.
-- ---------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------
-- rooms
-- Lobby/session container. Holds invite code and game config.
-- ---------------------------------------------------------------
create table public.rooms (
  id                   uuid primary key default gen_random_uuid(),
  code                 varchar(7) not null unique,
  host_id              uuid not null references public.profiles (id),
  game_type            text not null default 'judgement',
  status               text not null default 'waiting'
                         check (status in ('waiting', 'in_progress', 'finished', 'cancelled')),
  turn_timer_seconds   int check (turn_timer_seconds > 0),  -- null = no timer
  max_players          int not null default 6 check (max_players between 4 and 10),
  -- expires_at rules:
  --   unstarted room: 24h after created_at
  --   finished game:  2h after game finishes (updated by application)
  expires_at           timestamptz not null default (now() + interval '24 hours'),
  created_at           timestamptz not null default now()
);

create index idx_rooms_code on public.rooms (code) where status != 'cancelled';
create index idx_rooms_expires_at on public.rooms (expires_at);

-- ---------------------------------------------------------------
-- room_players
-- One row per player per room. Join table with presence/status.
-- ---------------------------------------------------------------
create table public.room_players (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  user_id          uuid not null references public.profiles (id),
  seat_order       int,  -- null until game starts; assigned then locked
  status           text not null default 'active'
                     check (status in ('active', 'disconnected', 'dropped')),
  disconnected_at  timestamptz,
  joined_at        timestamptz not null default now(),
  unique (room_id, user_id)  -- a player can only be in a room once
);

create index idx_room_players_room_id on public.room_players (room_id);

-- ---------------------------------------------------------------
-- games
-- One game instance per play-through of a room.
-- A room may host multiple sequential games in future (M4+).
-- ---------------------------------------------------------------
create table public.games (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.rooms (id),
  status              text not null default 'in_progress'
                        check (status in ('in_progress', 'finished')),
  starting_hand_size  int not null,  -- derived from player count at start
  created_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create index idx_games_room_id on public.games (room_id);

-- ---------------------------------------------------------------
-- rounds
-- One row per round in a game (pyramid structure).
-- ---------------------------------------------------------------
create table public.rounds (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games (id),
  round_number      int not null,
  hand_size         int not null,
  trump_suit        text not null
                      check (trump_suit in ('hearts', 'diamonds', 'clubs', 'spades')),
  trump_card_value  text not null,
  status            text not null default 'bidding'
                      check (status in ('bidding', 'playing', 'finished')),
  current_player_id uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  unique (game_id, round_number)
);

create index idx_rounds_game_id on public.rounds (game_id);

-- ---------------------------------------------------------------
-- hands
-- Cards dealt to each player per round. Immutable after dealing.
-- Current hand = dealt cards minus cards found in trick_cards.
-- ---------------------------------------------------------------
create table public.hands (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id),
  player_id  uuid not null references public.profiles (id),
  cards      jsonb not null,  -- [{suit: 'hearts', value: 'K'}, ...]
  unique (round_id, player_id)
);

create index idx_hands_round_id on public.hands (round_id);

-- ---------------------------------------------------------------
-- bids
-- One bid per player per round.
-- ---------------------------------------------------------------
create table public.bids (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id),
  player_id  uuid not null references public.profiles (id),
  amount     int not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create index idx_bids_round_id on public.bids (round_id);

-- ---------------------------------------------------------------
-- tricks
-- One row per trick in a round.
-- ---------------------------------------------------------------
create table public.tricks (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references public.rounds (id),
  trick_number  int not null,
  led_suit      text check (led_suit in ('hearts', 'diamonds', 'clubs', 'spades')),
  winner_id     uuid references public.profiles (id),  -- null until trick completes
  created_at    timestamptz not null default now(),
  unique (round_id, trick_number)
);

create index idx_tricks_round_id on public.tricks (round_id);

-- ---------------------------------------------------------------
-- trick_cards
-- Individual cards played within a trick.
-- ---------------------------------------------------------------
create table public.trick_cards (
  id         uuid primary key default gen_random_uuid(),
  trick_id   uuid not null references public.tricks (id),
  player_id  uuid not null references public.profiles (id),
  suit       text not null check (suit in ('hearts', 'diamonds', 'clubs', 'spades')),
  value      text not null,
  played_at  timestamptz not null default now(),
  unique (trick_id, player_id)  -- one card per player per trick
);

create index idx_trick_cards_trick_id on public.trick_cards (trick_id);

-- ---------------------------------------------------------------
-- round_scores
-- Written by application when a round finishes.
-- ---------------------------------------------------------------
create table public.round_scores (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rounds (id),
  player_id   uuid not null references public.profiles (id),
  bid         int not null,
  tricks_won  int not null,
  score       int not null,  -- computed by app: exact bid = 10*bid (0 bid = 10), else 0
  unique (round_id, player_id)
);

create index idx_round_scores_round_id on public.round_scores (round_id);

-- ---------------------------------------------------------------
-- game_results
-- Final standings written when a game finishes.
-- ---------------------------------------------------------------
create table public.game_results (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id),
  player_id    uuid not null references public.profiles (id),
  total_score  int not null,
  placement    int not null,  -- 1 = first place
  result       text not null check (result in ('win', 'loss', 'tie')),
  created_at   timestamptz not null default now(),
  unique (game_id, player_id)
);

create index idx_game_results_game_id on public.game_results (game_id);
create index idx_game_results_player_id on public.game_results (player_id);

-- ---------------------------------------------------------------
-- Row Level Security
-- Enable RLS on all tables. Policies added per feature in later migrations.
-- ---------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_players  enable row level security;
alter table public.games         enable row level security;
alter table public.rounds        enable row level security;
alter table public.hands         enable row level security;
alter table public.bids          enable row level security;
alter table public.tricks        enable row level security;
alter table public.trick_cards   enable row level security;
alter table public.round_scores  enable row level security;
alter table public.game_results  enable row level security;
