-- Applied by `npm run db:migrate`. Safe to re-run.

create table if not exists users (
  id             bigint primary key,           -- Telegram user id (= private chat id)
  first_name     text,
  hint_lang      text not null default 'ru',   -- ru | uk | pl | en
  status         text not null default 'active', -- active | paused | blocked
  pending        jsonb,                        -- current open task: {day, kind, index}
  checks_day     date,
  checks_count   int not null default 0,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table if not exists lessons (
  day        date primary key,
  topic      text not null,
  content    jsonb not null,
  created_at timestamptz not null default now()
);

-- Every word ever taught, so new lessons never repeat one.
create table if not exists used_words (
  word text primary key,
  day  date not null
);

-- Telegram file_id of generated voice clips: TTS once, reuse for every user.
create table if not exists media (
  day     date not null,
  key     text not null,
  file_id text not null,
  primary key (day, key)
);

-- Which scheduled part each user already got (makes cron runs idempotent).
create table if not exists deliveries (
  user_id bigint not null references users (id) on delete cascade,
  day     date not null,
  stage   text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day, stage)
);

create table if not exists answers (
  id          bigserial primary key,
  user_id     bigint not null references users (id) on delete cascade,
  day         date not null,
  task        text not null,   -- speaking:0 | writing:1 | free
  kind        text not null,   -- voice | text
  answer_text text,            -- typed text or voice transcript
  feedback    jsonb not null,
  created_at  timestamptz not null default now()
);

-- Telegram may redeliver an update; remember recent ones to process each once.
create table if not exists processed_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);
