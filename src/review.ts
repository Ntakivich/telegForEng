import type { Part } from '@google/genai';
import { config, type HintLang } from './config.js';
import { generateJson } from './gemini.js';
import type { Lesson } from './lesson-types.js';

export type Correction = { original: string; better: string; why: string };

export type Feedback = {
  /** Verbatim transcript for voice answers (errors kept); the typed text otherwise. */
  transcript: string;
  /** False if the audio was silent/unintelligible or the text is empty/gibberish. */
  understood: boolean;
  praise: string;
  corrections: Correction[];
  /** A natural, slightly better version of the whole answer, keeping the learner's ideas. */
  improved: string;
  tip: string;
  used_words: string[];
};

export type Answer = { kind: 'text'; text: string } | { kind: 'voice'; audio: Uint8Array; mimeType: string };

export const LANG_NAMES: Record<HintLang, string> = {
  ru: 'Russian',
  uk: 'Ukrainian',
  pl: 'Polish',
  en: 'very simple English',
};

const str = { type: 'string' };
const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    transcript: str,
    understood: { type: 'boolean' },
    praise: str,
    corrections: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { original: str, better: str, why: str },
        required: ['original', 'better', 'why'],
      },
    },
    improved: str,
    tip: str,
    used_words: { type: 'array', items: str },
  },
  required: ['transcript', 'understood', 'praise', 'corrections', 'improved', 'tip', 'used_words'],
};

function system(hintLang: HintLang) {
  const lang = LANG_NAMES[hintLang];
  return `You are a warm, patient English tutor for an adult learner at CEFR level A2.
You check one short answer and give focused, encouraging feedback. Research-based rules:
- Correct at most 3 things. Prioritise errors that change or hide the meaning, then errors with today's words,
  then frequent grammar (verb forms, articles, prepositions, word order). Ignore tiny issues and style.
- Do not "correct" things that are already natural. A perfect answer gets an empty corrections list.
- "original" is the learner's exact fragment, "better" the fixed fragment, "why" a one-line rule.
- praise: one specific, honest compliment (what exactly was good). Never generic, never over the top.
- improved: the whole answer rewritten naturally at A2–B1 level, keeping the learner's ideas, max 4 sentences.
- tip: one short, practical next step (or pronunciation note for voice), may be "".
- Write praise, why and tip in ${lang}. Write transcript, original, better and improved in English.
- For voice answers: transcript = exactly what the learner said, keeping their mistakes. Do not judge
  individual sounds; only if some words were hard to understand, mention them gently in tip.
- If the audio is silent/unclear or the text is not a real attempt, set understood=false, keep other
  fields short and use tip to kindly ask them to try again.
- If the answer is off-topic, still give feedback on the language, and kindly mention the question in tip.
- used_words: which of today's words the learner used (any form).`;
}

export async function reviewAnswer(opts: {
  lesson: Lesson | null;
  task: string | null;
  hintLang: HintLang;
  answer: Answer;
}): Promise<Feedback> {
  const { lesson, task, hintLang, answer } = opts;
  const words = lesson ? lesson.words.map((w) => w.word).join(', ') : '(none)';
  const context = task
    ? `Task: ${task}`
    : 'There is no task: the learner sent a free message. Check their English and add a short friendly reply to its content at the start of praise.';
  const intro = `${context}
Today's words: ${words}
${lesson ? `Today's story (for questions about it): ${lesson.story.text}` : ''}
The learner answered by ${answer.kind === 'voice' ? 'voice message (audio attached)' : 'text'}:`;

  const parts: Part[] =
    answer.kind === 'voice'
      ? [{ text: intro }, { inlineData: { mimeType: answer.mimeType, data: Buffer.from(answer.audio).toString('base64') } }]
      : [{ text: `${intro}\n"""${answer.text}"""` }];

  const fb = await generateJson<Feedback>({
    models: config.reviewModels,
    system: system(hintLang),
    parts,
    schema: FEEDBACK_SCHEMA,
    temperature: 0.3,
  });
  return {
    ...fb,
    transcript: answer.kind === 'text' ? answer.text : (fb.transcript ?? '').trim(),
    corrections: (fb.corrections ?? []).slice(0, 3),
    used_words: fb.used_words ?? [],
  };
}
