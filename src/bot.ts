import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { config, HINT_LANGS, type HintLang } from './config.js';
import {
  claimDelivery,
  countAnswers,
  createUser,
  getAnswer,
  getLesson,
  getUser,
  saveAnswer,
  setHintLang,
  setStatus,
  touchUser,
  useCheck,
  type Stage,
  type TaskKind,
  type User,
} from './db.js';
import { feedbackMessage, LANG_LABELS, TEXT } from './format.js';
import { ensureLesson, today } from './lesson.js';
import type { Lesson } from './lesson-types.js';
import { reviewAnswer, type Answer, type Feedback } from './review.js';
import { advanceTask, sendHtml, sendModelAnswerVoice, sendStage } from './stages.js';

type Ctx = Context & { user?: User };

const MAX_VOICE_SECONDS = 150;

function langKeyboard(onboarding: boolean) {
  const kb = new InlineKeyboard();
  HINT_LANGS.forEach((lang, i) => {
    kb.text(LANG_LABELS[lang], `lang:${lang}${onboarding ? ':start' : ''}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

const todayKeyboard = () =>
  new InlineKeyboard()
    .text('☀️ Words', 'open:morning')
    .text('📖 Story + speaking', 'open:midday')
    .row()
    .text('🌙 Quiz + writing', 'open:evening');

/** Loads today's lesson, telling the user to wait if it has to be generated first. */
async function lessonForToday(ctx: Ctx): Promise<Lesson | null> {
  const day = today();
  const existing = await getLesson(day);
  if (existing) return existing;
  const note = await ctx.reply(TEXT.preparing);
  try {
    return await ensureLesson(day);
  } catch (error) {
    console.error('lesson generation failed', error);
    await ctx.reply(TEXT.lessonFailed);
    return null;
  } finally {
    await ctx.api.deleteMessage(note.chat.id, note.message_id).catch(() => {});
  }
}

async function openStage(ctx: Ctx, user: User, stage: Stage) {
  const lesson = await lessonForToday(ctx);
  if (!lesson) return;
  await claimDelivery(user.id, lesson.day, stage); // so the scheduled run doesn't send it again
  await sendStage(ctx.api, user, lesson, stage);
}

async function downloadFile(ctx: Ctx, fileId: string): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

type Incoming = { kind: 'text'; text: string } | { kind: 'voice'; fileId: string; mimeType: string };

/** The core loop: an answer (or a free message) → Gemini review → feedback with next-step buttons. */
async function handleAnswer(ctx: Ctx, user: User, incoming: Incoming) {
  const day = today();
  if (!(await useCheck(user.id, day))) {
    await ctx.reply(TEXT.limitReached);
    return;
  }
  await ctx.react('👀').catch(() => {});
  await ctx.replyWithChatAction('typing').catch(() => {});

  const pending = user.pending;
  const lesson = await getLesson(pending?.day ?? day);
  const task = pending && lesson ? (lesson[pending.kind][pending.index] ?? null) : null;

  let feedback: Feedback;
  let answer: Answer;
  try {
    answer =
      incoming.kind === 'text'
        ? incoming
        : { kind: 'voice', audio: await downloadFile(ctx, incoming.fileId), mimeType: incoming.mimeType };
    feedback = await reviewAnswer({ lesson, task, hintLang: user.hintLang, answer });
  } catch (error) {
    console.error('review failed', error);
    await ctx.reply(TEXT.reviewFailed);
    return;
  }

  const answerId = await saveAnswer({
    userId: user.id,
    day: pending?.day ?? day,
    task: task && pending ? `${pending.kind}:${pending.index}` : 'free',
    kind: answer.kind,
    answerText: feedback.transcript,
    feedback,
  });

  const kb = new InlineKeyboard();
  if (feedback.understood && feedback.improved) kb.text('🔊 Listen', `say:${answerId}`);
  let text = feedbackMessage(feedback, answer.kind);
  if (task && pending && lesson) {
    const isLast = pending.index + 1 >= lesson[pending.kind].length;
    kb.text(isLast ? '✅ Finish' : '➡️ Next', `next:${pending.day}:${pending.kind}:${pending.index}`);
    if (pending.kind === 'speaking' && answer.kind === 'text') {
      text += '\n\n🎙 <i>This one is speaking practice — try a voice message next time!</i>';
    }
    text += `\n\n${TEXT.tryAgainHint}`;
  }
  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: kb,
    reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true },
  });
}

export function createBot() {
  const bot = new Bot<Ctx>(config.telegramToken);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  // Only private chats: every learner gets their own feedback loop.
  const pm = bot.chatType('private');

  pm.command('start', async (ctx) => {
    const existing = await getUser(ctx.from.id);
    if (!existing && config.inviteCode && ctx.match.trim() !== config.inviteCode) {
      await ctx.reply(TEXT.inviteRequired);
      return;
    }
    await createUser(ctx.from.id, ctx.from.first_name, existing?.hintLang ?? config.defaultHintLang);
    await ctx.reply(TEXT.welcome(ctx.from.first_name), { parse_mode: 'HTML', reply_markup: langKeyboard(true) });
  });

  // Everything below needs a registered user.
  pm.use(async (ctx, next) => {
    const user = await getUser(ctx.from.id);
    if (!user) {
      await ctx.reply(config.inviteCode ? TEXT.inviteRequired : 'Please press /start first 🙂');
      return;
    }
    ctx.user = user;
    await touchUser(user.id);
    await next();
  });

  pm.command('help', (ctx) => ctx.reply(TEXT.help, { parse_mode: 'HTML' }));
  pm.command('today', (ctx) => ctx.reply(TEXT.todayMenu, { reply_markup: todayKeyboard() }));
  pm.command('lang', (ctx) => ctx.reply(TEXT.chooseLang, { reply_markup: langKeyboard(false) }));
  pm.command('pause', async (ctx) => {
    await setStatus(ctx.user!.id, 'paused');
    await ctx.reply(TEXT.paused);
  });
  pm.command('resume', async (ctx) => {
    await setStatus(ctx.user!.id, 'active');
    await ctx.reply(TEXT.resumed);
  });
  pm.command('stats', async (ctx) => {
    const { total, days } = await countAnswers(ctx.user!.id);
    await ctx.reply(`📈 Answers checked: <b>${total}</b> on <b>${days}</b> day(s). Keep going at your own pace!`, {
      parse_mode: 'HTML',
    });
  });

  pm.callbackQuery(/^lang:(\w+)(:start)?$/, async (ctx) => {
    const lang = ctx.match[1] as HintLang;
    if (!HINT_LANGS.includes(lang)) return ctx.answerCallbackQuery();
    await setHintLang(ctx.user!.id, lang);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(TEXT.langSaved(LANG_LABELS[lang]));
    if (ctx.match[2]) await openStage(ctx, { ...ctx.user!, hintLang: lang }, 'morning');
  });

  pm.callbackQuery(/^open:(morning|midday|evening)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await openStage(ctx, ctx.user!, ctx.match[1] as Stage);
  });

  pm.callbackQuery(/^next:(\d{4}-\d{2}-\d{2}):(speaking|writing):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {}); // one tap only
    await advanceTask(ctx.api, ctx.user!, ctx.match[1]!, ctx.match[2] as TaskKind, Number(ctx.match[3]));
  });

  pm.callbackQuery(/^say:(\d+)$/, async (ctx) => {
    const user = ctx.user!;
    const answer = await getAnswer(Number(ctx.match[1]), user.id);
    if (!answer?.feedback?.improved) return ctx.answerCallbackQuery();
    if (!(await useCheck(user.id, today()))) return ctx.answerCallbackQuery({ text: TEXT.limitReached, show_alert: true });
    await ctx.answerCallbackQuery({ text: '🎧 One moment…' });
    await ctx.replyWithChatAction('record_voice').catch(() => {});
    try {
      await sendModelAnswerVoice(ctx.api, user.id, answer.feedback.improved, ctx.callbackQuery.message?.message_id);
    } catch (error) {
      console.error('model answer TTS failed', error);
      await ctx.reply(TEXT.reviewFailed);
    }
  });

  pm.callbackQuery('resume', async (ctx) => {
    await setStatus(ctx.user!.id, 'active');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(TEXT.resumed);
  });

  pm.on(['message:voice', 'message:audio'], async (ctx) => {
    const media = ctx.msg.voice ?? ctx.msg.audio!;
    if (media.duration > MAX_VOICE_SECONDS) {
      await ctx.reply(TEXT.tooLong);
      return;
    }
    await handleAnswer(ctx, ctx.user!, { kind: 'voice', fileId: media.file_id, mimeType: media.mime_type ?? 'audio/ogg' });
  });

  pm.on('message:text', async (ctx) => {
    const text = ctx.msg.text.trim();
    if (text.startsWith('/')) {
      await ctx.reply(TEXT.help, { parse_mode: 'HTML' });
      return;
    }
    if (!/[a-z]/i.test(text)) {
      await ctx.reply('Please write in English 🙂');
      return;
    }
    await handleAnswer(ctx, ctx.user!, { kind: 'text', text: text.slice(0, 2000) });
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed`, err.error));
  return bot;
}

export const BOT_COMMANDS = [
  { command: 'today', description: 'Today’s words, story and tasks' },
  { command: 'lang', description: 'Language for translations' },
  { command: 'stats', description: 'My progress' },
  { command: 'pause', description: 'Stop daily messages' },
  { command: 'resume', description: 'Start daily messages again' },
  { command: 'help', description: 'How it works' },
];
