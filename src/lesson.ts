import { config } from './config.js';
import { TOPICS } from './content/topics.js';
import { A2_WORDS, type WordEntry } from './content/words-a2.js';
import { getLesson, getRecentLessons, getUsedWords, saveLesson } from './db.js';
import { generateJson } from './gemini.js';
import type { Lesson, QuizItem, WordCard } from './lesson-types.js';

export const NEW_WORDS_PER_DAY = 6;
/** Expanding review intervals: words from 1, 3, 7 and 14 days ago come back. */
const REVIEW_INTERVALS = [1, 3, 7, 14];

// ---- dates -----------------------------------------------------------------

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

export function topicFor(day: string): string {
  return TOPICS[dayNumber(day) % TOPICS.length]!;
}

// ---- word selection --------------------------------------------------------

export function unusedWords(used: Iterable<string>): WordEntry[] {
  const seen = new Set([...used].map((w) => w.toLowerCase()));
  return A2_WORDS.filter((w) => !seen.has(w.word.toLowerCase()));
}

/** One or two words from each lesson taught 1/3/7/14 days before `day`. */
export function pickReviewWords(day: string, recent: Lesson[]): string[] {
  const out: string[] = [];
  for (const interval of REVIEW_INTERVALS) {
    const lesson = recent.find((l) => l.day === addDays(day, -interval));
    if (!lesson?.words.length) continue;
    const take = interval <= 3 ? 2 : 1;
    const start = dayNumber(day) % lesson.words.length;
    for (let i = 0; i < Math.min(take, lesson.words.length); i++) {
      out.push(lesson.words[(start + i) % lesson.words.length]!.word);
    }
  }
  return [...new Set(out)];
}

// ---- generation ------------------------------------------------------------

const str = { type: 'string' };
const strList = (min: number, max: number) => ({ type: 'array', items: str, minItems: min, maxItems: max });

const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    words: {
      type: 'array',
      minItems: NEW_WORDS_PER_DAY,
      maxItems: NEW_WORDS_PER_DAY,
      items: {
        type: 'object',
        properties: {
          word: str,
          pos: str,
          ipa: str,
          meaning: str,
          translation: {
            type: 'object',
            properties: { ru: str, uk: str, pl: str },
            required: ['ru', 'uk', 'pl'],
          },
          examples: strList(2, 2),
          collocations: strList(2, 3),
          tip: str,
        },
        required: ['word', 'pos', 'ipa', 'meaning', 'translation', 'examples', 'collocations', 'tip'],
      },
    },
    story: {
      type: 'object',
      properties: { title: str, text: str },
      required: ['title', 'text'],
    },
    speaking: strList(2, 2),
    writing: strList(2, 2),
    quiz: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          question: str,
          options: strList(3, 4),
          correct_index: { type: 'integer' },
          explanation: str,
        },
        required: ['question', 'options', 'correct_index', 'explanation'],
      },
    },
  },
  required: ['title', 'words', 'story', 'speaking', 'writing', 'quiz'],
};

const LESSON_SYSTEM = `You are an experienced ESL materials writer. You create one short daily micro-lesson
for adult learners of English at CEFR level A2. Everything must be natural, correct, friendly and
easy: short sentences, high-frequency words, A2 grammar only (present simple/continuous, past simple,
be going to, will for simple predictions, can/have to/should, comparatives). Never use rare idioms.`;

function lessonPrompt(topic: string, candidates: WordEntry[], reviewWords: string[]): string {
  const list = candidates.map((w) => `${w.word} (${w.pos})`).join(', ');
  return `Today's topic: ${topic}

NEW WORDS — choose exactly ${NEW_WORDS_PER_DAY} words from the CANDIDATES list that fit the topic best
and are most useful in everyday life. Copy the spelling exactly. Include at least one verb.
CANDIDATES: ${list}

REVIEW WORDS (learned on earlier days — reuse them): ${reviewWords.length ? reviewWords.join(', ') : '(none yet)'}

Fill every field:
- title: a short, warm title for today's lesson with one emoji, e.g. "☕ Coffee break".
- words[]: for each new word —
  pos: part of speech; ipa: British IPA without slashes;
  meaning: simple English definition, max 15 words, only A1–A2 vocabulary;
  translation: the matching meaning in Russian (ru), Ukrainian (uk) and Polish (pl), 1–3 words each;
  examples: 2 natural example sentences, max 12 words each, different situations/forms;
  collocations: 2–3 common word partners, e.g. "make a booking";
  tip: one short note about a typical learner mistake, irregular form or false friend — or "" if nothing useful.
- story: title + text of 120–160 words. A small everyday story with a light, interesting twist, written
  in the third person, not a dialogue. Use ALL ${NEW_WORDS_PER_DAY} new words (any form) and the review words where natural.
- speaking: exactly 2 questions the learner answers with a 30–60 second voice message.
  #1 is about the story (why/how/what — not yes/no). #2 is personal and invites using today's words. Max 20 words each.
- writing: exactly 2 short evening writing tasks (answer = 2–4 sentences), e.g. a message to a friend.
  Each task names 2 of today's new words to use. Max 30 words each.
- quiz: exactly 5 multiple-choice questions: 3 about today's new words (meaning, gap-fill in a NEW sentence,
  word partner) and 2 about review words (use new words if there are no review words).
  3–4 options, exactly one correct, plausible A2 distractors, vary the position of the correct answer.
  question max 200 characters, each option max 60 characters, explanation max 150 characters in simple English.
  correct_index is 0-based.`;
}

type RawLesson = Omit<Lesson, 'day' | 'topic' | 'review_words'>;

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Checks and normalises the model output; throws if it is not usable. */
export function validateLesson(raw: RawLesson, day: string, topic: string, reviewWords: string[], used: Set<string>): Lesson {
  const seen = new Set<string>();
  const words: WordCard[] = [];
  for (const w of raw.words ?? []) {
    const key = w.word?.trim().toLowerCase();
    if (!key || seen.has(key) || used.has(key)) continue;
    seen.add(key);
    words.push({ ...w, word: w.word.trim(), examples: w.examples ?? [], collocations: w.collocations ?? [], tip: w.tip ?? '' });
  }
  if (words.length < 4) throw new Error(`Lesson has only ${words.length} usable new words`);

  const quiz: QuizItem[] = (raw.quiz ?? [])
    .map((q) => ({
      question: clip(q.question.trim(), 300),
      options: q.options.map((o) => clip(o.trim(), 100)),
      correct_index: q.correct_index,
      explanation: clip((q.explanation ?? '').trim(), 200),
    }))
    .filter(
      (q) =>
        q.question &&
        q.options.length >= 2 &&
        q.options.length <= 12 &&
        new Set(q.options).size === q.options.length &&
        Number.isInteger(q.correct_index) &&
        q.correct_index >= 0 &&
        q.correct_index < q.options.length,
    );

  const speaking = (raw.speaking ?? []).map((s) => s.trim()).filter(Boolean);
  const writing = (raw.writing ?? []).map((s) => s.trim()).filter(Boolean);
  if (!raw.story?.text?.trim() || !speaking.length || !writing.length || quiz.length < 3) {
    throw new Error('Lesson is missing the story, tasks or quiz');
  }

  return {
    day,
    topic,
    title: raw.title?.trim() || topic,
    words,
    review_words: reviewWords,
    story: { title: raw.story.title?.trim() || topic, text: raw.story.text.trim() },
    speaking,
    writing,
    quiz,
  };
}

async function generateLesson(day: string): Promise<Lesson> {
  const [usedList, recent] = await Promise.all([getUsedWords(), getRecentLessons(day, 15)]);
  const used = new Set(usedList.map((w) => w.toLowerCase()));
  const topic = topicFor(day);
  const reviewWords = pickReviewWords(day, recent);
  let candidates = unusedWords(used);
  if (candidates.length < NEW_WORDS_PER_DAY * 3) {
    // The whole A2 list has been taught: start a second round with the oldest words.
    candidates = A2_WORDS;
    used.clear();
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await generateJson<RawLesson>({
        models: config.lessonModels,
        system: LESSON_SYSTEM,
        parts: [{ text: lessonPrompt(topic, candidates, reviewWords) }],
        schema: LESSON_SCHEMA,
        temperature: 0.9,
      });
      return validateLesson(raw, day, topic, reviewWords, used);
    } catch (error) {
      lastError = error;
      console.warn(`lesson generation attempt ${attempt} failed`, error);
    }
  }
  throw lastError;
}

/** Returns the lesson for `day`, generating and storing it on first use. */
export async function ensureLesson(day: string): Promise<Lesson> {
  const existing = await getLesson(day);
  if (existing) return existing;
  const lesson = await generateLesson(day);
  const saved = await saveLesson(lesson);
  return saved ? lesson : ((await getLesson(day)) ?? lesson);
}
