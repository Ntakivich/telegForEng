import { GrammyError, InlineKeyboard, InputFile, type Api } from 'grammy';
import { config } from './config.js';
import { MIX, MIX_LABEL, TOPICS, topicLabel } from './content/topics.js';
import {
  activeTopics,
  claimDelivery,
  cleanupProcessedUpdates,
  getLesson,
  getMediaFileId,
  pauseInactiveUsers,
  rollTopicWeeks,
  saveMediaFileId,
  setPending,
  setStatus,
  usersAwaiting,
  type Stage,
  type TaskKind,
  type User,
} from './db.js';
import {
  eveningIntro,
  speakingCaption,
  splitMessage,
  storyMessage,
  TEXT,
  wordsMessage,
  wordsScript,
  writingMessage,
} from './format.js';
import { speak } from './gemini.js';
import { addDays, ensureLesson, today } from './lesson.js';
import type { Lesson } from './lesson-types.js';

const STYLE = {
  words: 'Read this slowly and clearly for a beginner learner of English. Make a short pause after each line:',
  story: 'Read this story aloud in a warm, calm voice, a little slower than normal, for a learner of English:',
  question: 'Ask this question in a friendly, clear voice, a little slowly:',
  model: 'Say this naturally and clearly, a little slower than normal, for a learner of English:',
};

export async function sendHtml(api: Api, chatId: number, html: string, reply_markup?: InlineKeyboard) {
  const pieces = splitMessage(html);
  for (const [i, piece] of pieces.entries()) {
    await api.sendMessage(chatId, piece, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: i === pieces.length - 1 ? reply_markup : undefined,
    });
  }
}

/**
 * Sends a generated voice clip. TTS runs once per clip: after the first upload the
 * Telegram file_id is stored and reused for every other user. Returns false if TTS failed.
 */
async function sendClip(
  api: Api,
  chatId: number,
  day: string,
  key: string,
  script: string,
  style: string,
  extra: { caption?: string; reply_markup?: InlineKeyboard } = {},
): Promise<boolean> {
  const other = { ...extra, parse_mode: 'HTML' as const };
  const cached = await getMediaFileId(day, key);
  if (cached) {
    await api.sendVoice(chatId, cached, other);
    return true;
  }
  let mp3: Uint8Array;
  try {
    mp3 = await speak(script, style);
  } catch (error) {
    console.warn(`TTS failed for ${day}/${key}`, error);
    return false;
  }
  const msg = await api.sendVoice(chatId, new InputFile(mp3, `${key.replace(/\W/g, '-')}.mp3`), other);
  const fileId = msg.voice?.file_id ?? (msg as { audio?: { file_id: string } }).audio?.file_id;
  if (fileId) await saveMediaFileId(day, key, fileId);
  return true;
}

/** Sends a one-off voice clip that is not cached (e.g. the “better version” of an answer). */
export async function sendModelAnswerVoice(api: Api, chatId: number, text: string, replyTo?: number) {
  const mp3 = await speak(text, STYLE.model);
  await api.sendVoice(chatId, new InputFile(mp3, 'better-version.mp3'), {
    reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
  });
}

// ---- keyboards -------------------------------------------------------------

/** `mode`: 'start' (onboarding), 'week' (weekly offer, applies tomorrow) or '' (/topic, applies now). */
export function topicKeyboard(mode: '' | 'start' | 'week', current?: string) {
  const kb = new InlineKeyboard();
  const suffix = mode ? `:${mode}` : '';
  TOPICS.forEach((t, i) => {
    kb.text(t.id === current ? `✅ ${t.label}` : t.label, `topic:${t.id}${suffix}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text(current === MIX ? `✅ ${MIX_LABEL}` : MIX_LABEL, `topic:${MIX}${suffix}`);
}

export function nextCallback(lesson: Pick<Lesson, 'day' | 'topic'>, kind: TaskKind, index: number) {
  return `next:${lesson.day}:${lesson.topic}:${kind}:${index}`;
}

// ---- tasks (one question at a time) ---------------------------------------

export async function startTask(api: Api, user: User, lesson: Lesson, kind: TaskKind, index: number) {
  const keyboard = new InlineKeyboard().text('⏭ Skip', nextCallback(lesson, kind, index));
  if (kind === 'speaking') {
    const caption = speakingCaption(lesson, index);
    const ok = await sendClip(api, user.id, lesson.day, `${lesson.topic}:speaking:${index}`, lesson.speaking[index]!, STYLE.question, {
      caption,
      reply_markup: keyboard,
    });
    if (!ok) await sendHtml(api, user.id, caption.replace(/<\/?tg-spoiler>/g, ''), keyboard);
  } else {
    await sendHtml(api, user.id, writingMessage(lesson, index), keyboard);
  }
  await setPending(user.id, { day: lesson.day, topic: lesson.topic, kind, index });
}

/** Moves on from task `index` (after “Next” or “Skip”). */
export async function advanceTask(api: Api, user: User, day: string, topic: string, kind: TaskKind, index: number) {
  const lesson = await getLesson(day, topic);
  if (!lesson) return;
  const next = index + 1;
  if (next < lesson[kind].length) {
    await startTask(api, user, lesson, kind, next);
    return;
  }
  await setPending(user.id, null);
  await sendHtml(api, user.id, kind === 'speaking' ? TEXT.speakingDone : TEXT.writingDone);
}

// ---- stages ----------------------------------------------------------------

export async function sendStage(api: Api, user: User, lesson: Lesson, stage: Stage) {
  if (stage === 'morning') {
    await sendHtml(api, user.id, wordsMessage(lesson, user.hintLang));
    await sendClip(api, user.id, lesson.day, `${lesson.topic}:words`, wordsScript(lesson), STYLE.words);
  } else if (stage === 'midday') {
    await sendHtml(api, user.id, storyMessage(lesson));
    await sendClip(api, user.id, lesson.day, `${lesson.topic}:story`, `${lesson.story.title}.\n\n${lesson.story.text}`, STYLE.story);
    await startTask(api, user, lesson, 'speaking', 0);
  } else {
    await sendHtml(api, user.id, eveningIntro());
    for (const q of lesson.quiz) {
      await api.sendPoll(user.id, q.question, q.options, {
        type: 'quiz',
        correct_option_ids: [q.correct_index],
        explanation: q.explanation || undefined,
      });
    }
    await startTask(api, user, lesson, 'writing', 0);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Generates the lessons for several topics in parallel (Gemini-bound, so a few at a time).
 * With `startBefore`, topics not started by then are skipped (the morning run or /today makes them).
 */
async function ensureLessons(day: string, topics: string[], startBefore = Infinity): Promise<Map<string, Lesson>> {
  const results = await mapLimit(topics, 3, async (topic) => {
    if (Date.now() > startBefore) throw new Error('out of time, skipped');
    return ensureLesson(day, topic);
  });
  const lessons = new Map<string, Lesson>();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') lessons.set(topics[i]!, r.value);
    else console.error(`lesson ${day}/${topics[i]} failed`, r.reason);
  });
  return lessons;
}

/** Cron entry point: sends `stage` of today's lesson to every active user who hasn't had it. */
export async function runScheduledStage(api: Api, stage: Stage, deadline: number) {
  const day = today();
  const report = { day, stage, sent: 0, failed: 0, skipped: 0, paused: 0, topicOffers: 0 };

  if (stage === 'morning') {
    await cleanupProcessedUpdates();
    for (const user of await pauseInactiveUsers(config.inactiveDaysBeforePause)) {
      report.paused++;
      await api
        .sendMessage(user.id, TEXT.inactivePause, { reply_markup: new InlineKeyboard().text('▶️ Continue', 'resume') })
        .catch((e) => console.warn(`pause notice to ${user.id} failed`, e));
    }
  }

  const users = await usersAwaiting(day, stage);
  const lessons = await ensureLessons(day, [...new Set(users.map((u) => u.topic))]);
  for (const user of users) {
    if (Date.now() > deadline) {
      report.skipped = users.length - report.sent - report.failed;
      console.warn('time budget reached, stopping broadcast', report);
      break;
    }
    const lesson = lessons.get(user.topic);
    if (!lesson) {
      report.failed++; // lesson generation failed; the user can still open it later via /today
      continue;
    }
    if (!(await claimDelivery(user.id, day, stage))) continue;
    try {
      await sendStage(api, user, lesson, stage);
      report.sent++;
    } catch (error) {
      report.failed++;
      if (error instanceof GrammyError && error.error_code === 403) await setStatus(user.id, 'blocked');
      else console.error(`sending ${stage} to ${user.id} failed`, error);
    }
  }

  if (stage === 'evening') {
    // A topic week is over: offer the next topic once. Staying silent = one more week of the same topic.
    for (const user of await rollTopicWeeks(day, addDays(day, 1))) {
      report.topicOffers++;
      await api
        .sendMessage(user.id, TEXT.weekOffer(topicLabel(user.topic)), {
          parse_mode: 'HTML',
          reply_markup: topicKeyboard('week', user.topic),
        })
        .catch((e) => console.warn(`topic offer to ${user.id} failed`, e));
    }
    // Prepare tomorrow's lessons in advance so the morning run only has to send them.
    await ensureLessons(addDays(day, 1), await activeTopics(), deadline - 90_000);
  }
  return report;
}
