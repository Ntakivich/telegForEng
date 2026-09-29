-- Applied by `npm run db:migrate`. Safe to re-run.

create table if not exists users (
  id             bigint primary key,           -- Telegram user id (= private chat id)
  first_name     text,
  hint_lang      text not null default 'ru',   -- ru | uk | pl | en
  status         text not null default 'active', -- active | paused | blocked
  pending        jsonb,                        -- current open task: {day, topic, kind, index}
  topic          text not null default 'mix',  -- chosen /topic id, or 'mix'
  topic_started  date,                         -- first day of the current topic week
  checks_day     date,
  checks_count   int not null default 0,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- One lesson per day per topic, shared by everyone on that topic.
create table if not exists lessons (
  day        date not null,
  topic_id   text not null default 'mix',
  topic      text not null,  -- the day's theme/focus, for reading the table by eye
  content    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (day, topic_id)
);

-- Every word taught per topic, so new lessons never repeat one.
create table if not exists used_words (
  topic_id text not null default 'mix',
  word     text not null,
  day      date not null,
  primary key (topic_id, word)
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

-- v2 upgrade (weekly topics) for databases created before topics existed.
alter table users add column if not exists topic text not null default 'mix';
alter table users add column if not exists topic_started date;
alter table lessons add column if not exists topic_id text not null default 'mix';
alter table lessons drop constraint if exists lessons_pkey;
alter table lessons add primary key (day, topic_id);
alter table used_words add column if not exists topic_id text not null default 'mix';
alter table used_words drop constraint if exists used_words_pkey;
alter table used_words add primary key (topic_id, word);
