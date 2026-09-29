import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { config, type HintLang } from './config.js';
import type { Lesson } from './lesson-types.js';

// Neon's HTTP driver: one HTTPS request per query, no connection pool to manage —
// the right fit for short-lived serverless functions.
let client: NeonQueryFunction<false, false> | undefined;
export function sql() {
  return (client ??= neon(config.databaseUrl));
}

export type TaskKind = 'speaking' | 'writing';
export type Pending = { day: string; topic?: string; kind: TaskKind; index: number };
export type Stage = 'morning' | 'midday' | 'evening';

export type User = {
  id: number;
  firstName: string | null;
  hintLang: HintLang;
  status: 'active' | 'paused' | 'blocked';
  pending: Pending | null;
  /** Chosen /topic id, or 'mix'. */
  topic: string;
};

type Row = Record<string, any>;

function toUser(row: Row): User {
  return {
    id: Number(row.id),
    firstName: row.first_name,
    hintLang: row.hint_lang,
    status: row.status,
    pending: row.pending ?? null,
    topic: row.topic ?? 'mix',
  };
}

// ---- updates -------------------------------------------------------------

/** True the first time an update id is seen; false for Telegram redeliveries. */
export async function claimUpdate(updateId: number): Promise<boolean> {
  const rows = await sql()`
    insert into processed_updates (update_id) values (${updateId})
    on conflict do nothing returning update_id`;
  return rows.length > 0;
}

export async function cleanupProcessedUpdates() {
  await sql()`delete from processed_updates where created_at < now() - interval '3 days'`;
}

// ---- users ---------------------------------------------------------------

export async function getUser(id: number): Promise<User | null> {
  const [row] = await sql()`select * from users where id = ${id}`;
  return row ? toUser(row) : null;
}

export async function createUser(id: number, firstName: string | undefined, hintLang: HintLang): Promise<User> {
  const [row] = await sql()`
    insert into users (id, first_name, hint_lang) values (${id}, ${firstName ?? null}, ${hintLang})
    on conflict (id) do update set first_name = excluded.first_name, status = 'active', last_active_at = now()
    returning *`;
  return toUser(row!);
}

/** Records activity; a user who writes to the bot is clearly not “blocked” anymore. */
export async function touchUser(id: number) {
  await sql()`
    update users set last_active_at = now(),
      status = case when status = 'blocked' then 'active' else status end
    where id = ${id}`;
}

export async function setHintLang(id: number, lang: HintLang) {
  await sql()`update users set hint_lang = ${lang} where id = ${id}`;
}

export async function setStatus(id: number, status: User['status']) {
  await sql()`update users set status = ${status} where id = ${id}`;
}

export async function setPending(id: number, pending: Pending | null) {
  await sql()`update users set pending = ${pending === null ? null : JSON.stringify(pending)}::jsonb where id = ${id}`;
}

/** Switches the user's topic; the topic week starts on `startDay`. */
export async function setTopic(id: number, topic: string, startDay: string) {
  await sql()`update users set topic = ${topic}, topic_started = ${startDay}::date where id = ${id}`;
}

/**
 * Users whose topic week ends today. Their next week is booked to start tomorrow
 * (same topic unless they pick another), and they are returned to be asked once.
 */
export async function rollTopicWeeks(day: string, tomorrow: string): Promise<User[]> {
  const rows = await sql()`
    update users set topic_started = ${tomorrow}::date
    where status = 'active' and topic <> 'mix'
      and topic_started is not null and topic_started <= ${day}::date - 6
    returning *`;
  return rows.map(toUser);
}

/** Topics that at least one active user is on. */
export async function activeTopics(): Promise<string[]> {
  const rows = await sql()`select distinct topic from users where status = 'active'`;
  return rows.map((r) => r.topic as string);
}

/** Atomically spends one of today's Gemini checks. False when the daily limit is reached. */
export async function useCheck(id: number, day: string): Promise<boolean> {
  const rows = await sql()`
    update users set
      checks_count = case when checks_day = ${day}::date then checks_count + 1 else 1 end,
      checks_day = ${day}::date
    where id = ${id}
      and (checks_day is distinct from ${day}::date or checks_count < ${config.maxChecksPerDay})
    returning id`;
  return rows.length > 0;
}

/** Active users who have not received `stage` for `day` yet. */
export async function usersAwaiting(day: string, stage: Stage): Promise<User[]> {
  const rows = await sql()`
    select u.* from users u
    where u.status = 'active'
      and not exists (select 1 from deliveries d where d.user_id = u.id and d.day = ${day}::date and d.stage = ${stage})
    order by u.id`;
  return rows.map(toUser);
}

/** Pauses users who have been silent for `days` days and returns them (to say goodbye once). */
export async function pauseInactiveUsers(days: number): Promise<User[]> {
  const rows = await sql()`
    update users set status = 'paused'
    where status = 'active' and last_active_at < now() - make_interval(days => ${days})
    returning *`;
  return rows.map(toUser);
}

// ---- deliveries ----------------------------------------------------------

/** True if this call is the one that gets to send `stage` to the user today. */
export async function claimDelivery(userId: number, day: string, stage: Stage): Promise<boolean> {
  const rows = await sql()`
    insert into deliveries (user_id, day, stage) values (${userId}, ${day}::date, ${stage})
    on conflict do nothing returning user_id`;
  return rows.length > 0;
}

// ---- lessons -------------------------------------------------------------

// The row's topic_id is the source of truth (lessons saved before topics existed have none in content).
const toLesson = (row: Row): Lesson => ({ ...row.content, topic: row.topic_id, theme: row.content.theme ?? row.topic });

export async function getLesson(day: string, topic: string): Promise<Lesson | null> {
  const [row] = await sql()`select * from lessons where day = ${day}::date and topic_id = ${topic}`;
  return row ? toLesson(row) : null;
}

/** Most recent lessons of `topic` before `day`, newest first. */
export async function getRecentLessons(day: string, topic: string, limit: number): Promise<Lesson[]> {
  const rows = await sql()`
    select * from lessons where day < ${day}::date and topic_id = ${topic} order by day desc limit ${limit}`;
  return rows.map(toLesson);
}

export async function getUsedWords(topic: string): Promise<string[]> {
  const rows = await sql()`select word from used_words where topic_id = ${topic}`;
  return rows.map((r) => r.word as string);
}

/** Stores the lesson and marks its words as used. If another run saved this day first, keeps that one. */
export async function saveLesson(lesson: Lesson): Promise<boolean> {
  const inserted = await sql()`
    insert into lessons (day, topic_id, topic, content)
    values (${lesson.day}::date, ${lesson.topic}, ${lesson.theme}, ${JSON.stringify(lesson)}::jsonb)
    on conflict do nothing returning day`;
  if (inserted.length === 0) return false;
  const words = lesson.words.map((w) => w.word.toLowerCase());
  await sql()`
    insert into used_words (topic_id, word, day)
    select ${lesson.topic}, w, ${lesson.day}::date from unnest(${words}::text[]) as w
    on conflict do nothing`;
  return true;
}

// ---- media ---------------------------------------------------------------

export async function getMediaFileId(day: string, key: string): Promise<string | null> {
  const [row] = await sql()`select file_id from media where day = ${day}::date and key = ${key}`;
  return row ? (row.file_id as string) : null;
}

export async function saveMediaFileId(day: string, key: string, fileId: string) {
  await sql()`
    insert into media (day, key, file_id) values (${day}::date, ${key}, ${fileId})
    on conflict (day, key) do nothing`;
}

// ---- answers -------------------------------------------------------------

export async function saveAnswer(a: {
  userId: number;
  day: string;
  task: string;
  kind: 'voice' | 'text';
  answerText: string;
  feedback: unknown;
}): Promise<number> {
  const [row] = await sql()`
    insert into answers (user_id, day, task, kind, answer_text, feedback)
    values (${a.userId}, ${a.day}::date, ${a.task}, ${a.kind}, ${a.answerText}, ${JSON.stringify(a.feedback)}::jsonb)
    returning id`;
  return Number(row!.id);
}

export async function getAnswer(id: number, userId: number): Promise<{ feedback: any } | null> {
  const [row] = await sql()`select feedback from answers where id = ${id} and user_id = ${userId}`;
  return row ? { feedback: row.feedback } : null;
}

export async function countAnswers(userId: number): Promise<{ total: number; days: number }> {
  const [row] = await sql()`
    select count(*)::int as total, count(distinct day)::int as days from answers where user_id = ${userId}`;
  return { total: row?.total ?? 0, days: row?.days ?? 0 };
}
