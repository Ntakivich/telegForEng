import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lesson } from '../src/lesson-types.js';

// ---- in-memory fakes for the database and Gemini ---------------------------

const state = vi.hoisted(() => ({
  users: new Map<number, any>(),
  lessons: new Map<string, any>(),
  media: new Map<string, string>(),
  deliveries: new Set<string>(),
  answers: [] as any[],
}));

vi.mock('../src/db.js', () => ({
  claimUpdate: async () => true,
  cleanupProcessedUpdates: async () => {},
  getUser: async (id: number) => state.users.get(id) ?? null,
  createUser: async (id: number, firstName: string, hintLang: string) => {
    const user = { id, firstName, hintLang, status: 'active', pending: null };
    state.users.set(id, user);
    return user;
  },
  touchUser: async () => {},
  setHintLang: async (id: number, lang: string) => void (state.users.get(id).hintLang = lang),
  setStatus: async (id: number, status: string) => void (state.users.get(id).status = status),
  setPending: async (id: number, pending: unknown) => void (state.users.get(id).pending = pending),
  useCheck: async () => true,
  usersAwaiting: async (day: string, stage: string) =>
    [...state.users.values()].filter((u) => u.status === 'active' && !state.deliveries.has(`${u.id}|${day}|${stage}`)),
  pauseInactiveUsers: async () => [],
  claimDelivery: async (id: number, day: string, stage: string) => {
    const key = `${id}|${day}|${stage}`;
    if (state.deliveries.has(key)) return false;
    state.deliveries.add(key);
    return true;
  },
  getLesson: async (day: string) => state.lessons.get(day) ?? null,
  getRecentLessons: async () => [],
  getUsedWords: async () => [],
  saveLesson: async (l: Lesson) => (state.lessons.set(l.day, l), true),
  getMediaFileId: async (day: string, key: string) => state.media.get(`${day}|${key}`) ?? null,
  saveMediaFileId: async (day: string, key: string, id: string) => void state.media.set(`${day}|${key}`, id),
  saveAnswer: async (a: any) => state.answers.push(a),
  getAnswer: async (id: number) => state.answers[id - 1] ?? null,
  countAnswers: async () => ({ total: state.answers.length, days: 1 }),
}));

const gemini = vi.hoisted(() => ({ generateJson: vi.fn(), speak: vi.fn(async () => new Uint8Array([0xff, 0xf3, 1, 2])) }));
vi.mock('../src/gemini.js', () => gemini);

process.env.TELEGRAM_BOT_TOKEN = '123:TEST';
process.env.CRON_SECRET = 'cron';

const { createBot } = await import('../src/bot.js');
const { runScheduledStage } = await import('../src/stages.js');
const { today } = await import('../src/lesson.js');

// ---- fake Telegram API ------------------------------------------------------

type Call = { method: string; payload: any };
let calls: Call[] = [];
let nextMessageId = 100;

function fakeResult(method: string, payload: any) {
  const base = { message_id: nextMessageId++, date: 0, chat: { id: payload.chat_id, type: 'private' } };
  if (method === 'getMe') return { id: 1, is_bot: true, first_name: 'Bot', username: 'test_bot' };
  if (method === 'getFile') return { file_id: payload.file_id, file_unique_id: 'u', file_path: 'voice/file.oga' };
  if (method === 'sendVoice') return { ...base, voice: { file_id: `voice-${nextMessageId}`, file_unique_id: 'u', duration: 3 } };
  if (method === 'sendPoll') return { ...base, poll: {} };
  if (method.startsWith('send')) return { ...base, text: payload.text };
  return true;
}

async function makeBot() {
  const bot = createBot();
  bot.api.config.use(async (_prev, method, payload: any) => {
    calls.push({ method, payload });
    return { ok: true, result: fakeResult(method, payload) as any };
  });
  await bot.init();
  calls = [];
  return bot;
}

const USER = { id: 42, is_bot: false, first_name: 'Olena' };
let updateId = 1;
const message = (extra: object) => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: { id: USER.id, type: 'private' as const, first_name: 'Olena' }, from: USER, ...extra },
});
const callback = (data: string) => ({
  update_id: updateId++,
  callback_query: {
    id: `cb${updateId}`,
    from: USER,
    chat_instance: 'c',
    data,
    message: { message_id: 7, date: 0, chat: { id: USER.id, type: 'private' as const, first_name: 'Olena' }, text: 'x' },
  },
});

const lessonFor = (day: string): Lesson => ({
  day,
  topic: 'Food and cooking',
  title: '🍳 Kitchen time',
  words: ['bake', 'recipe', 'oven', 'fridge', 'plate', 'taste'].map((word) => ({
    word, pos: 'noun', ipa: 'x', meaning: `meaning of ${word}`, translation: { ru: 'р', uk: 'у', pl: 'p' },
    examples: [`I like the ${word}.`, 'Second.'], collocations: ['c1', 'c2'], tip: '',
  })),
  review_words: [],
  story: { title: 'The cake', text: 'Anna wanted to bake a cake but her oven was broken.' },
  speaking: ['Why was Anna sad?', 'What do you like to bake?'],
  writing: ['Write to a friend about a recipe.', 'Describe your fridge.'],
  quiz: [
    { question: 'What is an oven for?', options: ['cooking', 'sleeping', 'running'], correct_index: 0, explanation: 'You cook in it.' },
    { question: 'Pick the verb', options: ['plate', 'bake', 'fridge'], correct_index: 1, explanation: '' },
    { question: 'A ___ tells you how to cook.', options: ['recipe', 'taste'], correct_index: 0, explanation: '' },
  ],
});

beforeEach(() => {
  calls = [];
  state.users.clear();
  state.lessons.clear();
  state.media.clear();
  state.deliveries.clear();
  state.answers.length = 0;
  gemini.generateJson.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
});

describe('bot flows', () => {
  it('onboards a new user and sends today’s words after the language is chosen', async () => {
    const bot = await makeBot();
    state.lessons.set(today(), lessonFor(today()));
    await bot.handleUpdate(message({ text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(state.users.get(42)).toMatchObject({ firstName: 'Olena', status: 'active' });
    const welcome = calls.find((c) => c.method === 'sendMessage')!;
    expect(welcome.payload.text).toContain('Hi, Olena');

    calls = [];
    await bot.handleUpdate(callback('lang:uk:start'));
    expect(state.users.get(42).hintLang).toBe('uk');
    const words = calls.find((c) => c.method === 'sendMessage' && c.payload.text.includes('Good morning'))!;
    expect(words.payload.text).toContain('<b>1. bake</b>');
    expect(words.payload.text).toContain('🔤 <i>у</i>');
    expect(calls.some((c) => c.method === 'sendVoice')).toBe(true);
    expect(state.deliveries.has(`42|${today()}|morning`)).toBe(true);
  });

  it('reviews a voice answer to the pending question and moves to the next one', async () => {
    const bot = await makeBot();
    const day = today();
    state.lessons.set(day, lessonFor(day));
    state.users.set(42, { id: 42, firstName: 'Olena', hintLang: 'ru', status: 'active', pending: { day, kind: 'speaking', index: 0 } });
    gemini.generateJson.mockResolvedValueOnce({
      transcript: 'Anna was sad because oven broken',
      understood: true,
      praise: 'Хорошо!',
      corrections: [{ original: 'oven broken', better: 'her oven was broken', why: 'Нужен глагол was.' }],
      improved: 'Anna was sad because her oven was broken.',
      tip: '',
      used_words: ['oven'],
    });

    await bot.handleUpdate(message({ voice: { file_id: 'v1', file_unique_id: 'u', duration: 5, mime_type: 'audio/ogg' } }));

    const prompt = gemini.generateJson.mock.calls[0]![0];
    expect(prompt.parts[0].text).toContain('Task: Why was Anna sad?');
    expect(prompt.parts[1].inlineData.mimeType).toBe('audio/ogg');
    const reply = calls.find((c) => c.method === 'sendMessage')!;
    expect(reply.payload.text).toContain('<s>oven broken</s> → <b>her oven was broken</b>');
    const buttons = reply.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(buttons).toEqual(['say:1', `next:${day}:speaking:0`]);
    expect(state.answers[0]).toMatchObject({ task: 'speaking:0', kind: 'voice' });

    calls = [];
    await bot.handleUpdate(callback(`next:${day}:speaking:0`));
    const q2 = calls.find((c) => c.method === 'sendVoice')!;
    expect(q2.payload.caption).toContain('Question 2/2');
    expect(state.users.get(42).pending).toEqual({ day, kind: 'speaking', index: 1 });
    expect(state.media.get(`${day}|speaking:1`)).toBeDefined();

    calls = [];
    await bot.handleUpdate(callback(`next:${day}:speaking:1`));
    expect(state.users.get(42).pending).toBeNull();
    expect(calls.some((c) => c.method === 'sendMessage' && c.payload.text.includes('all for speaking'))).toBe(true);
  });

  it('checks a free text message without a task', async () => {
    const bot = await makeBot();
    state.users.set(42, { id: 42, firstName: 'Olena', hintLang: 'en', status: 'active', pending: null });
    gemini.generateJson.mockResolvedValueOnce({
      transcript: '', understood: true, praise: 'Nice!', corrections: [], improved: '', tip: '', used_words: [],
    });
    await bot.handleUpdate(message({ text: 'I have a cat' }));
    expect(gemini.generateJson.mock.calls[0]![0].parts[0].text).toContain('There is no task');
    const reply = calls.find((c) => c.method === 'sendMessage')!;
    expect(reply.payload.text).toContain('No mistakes');
    expect(state.answers[0]).toMatchObject({ task: 'free', answerText: 'I have a cat' });
  });

  it('asks unknown users to /start and ignores group chats', async () => {
    const bot = await makeBot();
    await bot.handleUpdate(message({ text: 'hello' }));
    expect(calls.find((c) => c.method === 'sendMessage')!.payload.text).toContain('/start');
    calls = [];
    await bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: 1, date: 0, chat: { id: -5, type: 'group', title: 'g' }, from: USER, text: 'hi' },
    });
    expect(calls.filter((c) => c.method.startsWith('send'))).toHaveLength(0);
  });
});

describe('scheduled evening run', () => {
  it('sends quiz polls + first writing task once per user, and pre-generates tomorrow', async () => {
    const bot = await makeBot();
    const day = today();
    state.lessons.set(day, lessonFor(day));
    state.users.set(42, { id: 42, firstName: 'Olena', hintLang: 'ru', status: 'active', pending: null });
    state.users.set(43, { id: 43, firstName: 'Max', hintLang: 'ru', status: 'paused', pending: null });
    gemini.generateJson.mockImplementation(async () => {
      const { day: _d, topic: _t, review_words: _r, ...raw } = lessonFor('x');
      return { ...raw, words: [...raw.words.map((w) => ({ ...w, word: `${w.word}2` }))] };
    });

    const report = await runScheduledStage(bot.api, 'evening', Date.now() + 270_000);
    expect(report).toMatchObject({ sent: 1, failed: 0 });
    const polls = calls.filter((c) => c.method === 'sendPoll');
    expect(polls).toHaveLength(3);
    expect(polls[0]!.payload).toMatchObject({ chat_id: 42, type: 'quiz', correct_option_ids: [0] });
    expect(state.users.get(42).pending).toEqual({ day, kind: 'writing', index: 0 });
    expect(calls.every((c) => c.payload.chat_id !== 43)).toBe(true);
    expect([...state.lessons.keys()]).toHaveLength(2); // tomorrow prepared

    calls = [];
    const again = await runScheduledStage(bot.api, 'evening', Date.now() + 270_000);
    expect(again.sent).toBe(0);
    expect(calls.filter((c) => c.method === 'sendPoll')).toHaveLength(0);
  });
});
