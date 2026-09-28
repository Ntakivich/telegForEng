import type { HintLang } from './config.js';
import type { Lesson } from './lesson-types.js';
import type { Feedback } from './review.js';

// All messages use Telegram HTML parse mode.

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bolds today's words (and their regular forms) in an already-escaped text. */
export function highlightWords(escapedText: string, words: string[]): string {
  const stems = words.flatMap((w) => {
    const base = escapeRegex(w.toLowerCase());
    const forms = [base];
    if (/e$/.test(w)) forms.push(escapeRegex(w.toLowerCase().slice(0, -1)));
    if (/[^aeiou]y$/.test(w)) forms.push(escapeRegex(w.toLowerCase().slice(0, -1) + 'i'));
    return forms;
  });
  if (!stems.length) return escapedText;
  stems.sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(?:${stems.join('|')})(?:s|es|d|ed|ing|er|ers|est|ly)?\\b`, 'gi');
  return escapedText.replace(re, (m) => `<b>${m}</b>`);
}

export const LANG_LABELS: Record<HintLang, string> = {
  ru: '🇷🇺 Русский',
  uk: '🇺🇦 Українська',
  pl: '🇵🇱 Polski',
  en: '🇬🇧 English only',
};

export function wordsMessage(lesson: Lesson, lang: HintLang): string {
  const cards = lesson.words.map((w, i) => {
    const lines = [`<b>${i + 1}. ${esc(w.word)}</b> <i>${esc(w.pos)}</i> · /${esc(w.ipa.replace(/^\/|\/$/g, ''))}/`, esc(w.meaning)];
    if (lang !== 'en') lines.push(`🔤 <i>${esc(w.translation[lang])}</i>`);
    for (const ex of w.examples) lines.push(`▸ ${esc(ex)}`);
    if (w.collocations.length) lines.push(`🔗 ${w.collocations.map(esc).join(' · ')}`);
    if (w.tip) lines.push(`💡 ${esc(w.tip)}`);
    return lines.join('\n');
  });
  return [
    `☀️ <b>Good morning!</b>\nToday: <b>${esc(lesson.title)}</b>`,
    ...cards,
    '🎧 Listen below and repeat each word out loud.\nAt lunch — a short story with these words.',
  ].join('\n\n');
}

/** What the voice clip for the morning words says. */
export function wordsScript(lesson: Lesson): string {
  return lesson.words.map((w) => `${w.word}. ${w.examples[0] ?? ''}`).join('\n\n');
}

export function storyMessage(lesson: Lesson): string {
  const words = [...lesson.words.map((w) => w.word), ...lesson.review_words];
  return `📖 <b>${esc(lesson.story.title)}</b>\n\n${highlightWords(esc(lesson.story.text), words)}\n\n🎧 Listen and read along. Then answer two questions by voice.`;
}

export function speakingCaption(lesson: Lesson, index: number): string {
  return `🎙 <b>Question ${index + 1}/${lesson.speaking.length}</b>\nListen and answer with a voice message (30–60 seconds). Tap to see the text:\n\n<tg-spoiler>${esc(lesson.speaking[index]!)}</tg-spoiler>`;
}

export function eveningIntro(): string {
  return '🌙 <b>Evening practice</b>\nA short quiz and a little writing. No rush — do it whenever you like.';
}

export function writingMessage(lesson: Lesson, index: number): string {
  return `✍️ <b>Writing ${index + 1}/${lesson.writing.length}</b>\n${esc(lesson.writing[index]!)}\n\n<i>Write 2–4 sentences and send them here.</i>`;
}

export function feedbackMessage(fb: Feedback, kind: 'voice' | 'text'): string {
  if (!fb.understood) {
    return `🤔 ${esc(fb.tip || "I couldn't understand this one. Can you try again?")}`;
  }
  const parts: string[] = [];
  if (kind === 'voice' && fb.transcript) parts.push(`🎧 <i>I heard:</i> “${esc(fb.transcript)}”`);
  if (fb.praise) parts.push(`👍 ${esc(fb.praise)}`);
  if (fb.corrections.length) {
    parts.push(
      '✏️ <b>Let’s fix</b>\n' +
        fb.corrections.map((c) => `• <s>${esc(c.original)}</s> → <b>${esc(c.better)}</b>\n   <i>${esc(c.why)}</i>`).join('\n'),
    );
  } else {
    parts.push('✅ No mistakes — great job!');
  }
  if (fb.improved) parts.push(`✨ <b>A natural way to say it:</b>\n${esc(fb.improved)}`);
  if (fb.tip) parts.push(`💡 ${esc(fb.tip)}`);
  return parts.join('\n\n');
}

export const TEXT = {
  welcome: (name?: string) =>
    `👋 Hi${name ? `, ${esc(name)}` : ''}! I’m your English practice buddy (level A2).\n\n` +
    'Every day, calm and short (about 10 minutes in total):\n' +
    '☀️ <b>Morning</b> — 6 new words with examples and audio\n' +
    '📖 <b>Lunch</b> — a short story with these words + 2 questions to answer <b>by voice</b>\n' +
    '🌙 <b>Evening</b> — a quiz + a short writing task\n\n' +
    'After each answer you get quick feedback: what was good, what to fix, and a better way to say it.\n' +
    'Missed something? No problem — nothing is urgent. Use /today anytime.\n\n' +
    'First, which language should I use for translations and explanations?',
  chooseLang: 'Which language should I use for translations and explanations?',
  langSaved: (label: string) => `Saved: ${label}. You can change it anytime with /lang.`,
  help:
    '<b>What I can do</b>\n' +
    '/today — today’s words, story, speaking and evening tasks\n' +
    '/lang — language for translations and explanations\n' +
    '/pause — stop daily messages · /resume — start again\n' +
    '/stats — your progress\n\n' +
    'You can also just write or send me a voice message in English anytime — I’ll check it.\n\n',
  todayMenu: 'What would you like to open?',
  preparing: '⏳ Preparing today’s lesson…',
  lessonFailed: '😔 I couldn’t prepare the lesson right now. Please try /today again a bit later.',
  checking: '🎧 Checking…',
  reviewFailed: '😔 Sorry, I couldn’t check this right now. Please try again in a minute.',
  limitReached: '😊 That’s a lot of practice today — great! I can check more tomorrow.',
  tooLong: 'That’s a long one! Please keep voice answers under 2 minutes.',
  inviteRequired: '🔒 This bot is private. Please use the invite link from your teacher.',
  paused: '⏸ Paused. I won’t send daily messages. Come back anytime with /resume.',
  resumed: '▶️ Welcome back! Daily messages are on again. Here’s /today if you want to start now.',
  inactivePause:
    '👋 I haven’t heard from you for a while, so I’ll stop the daily messages for now — no pressure at all.\n' +
    'When you want to continue, just tap below.',
  speakingDone: '🎉 That’s all for speaking today. Well done! See you in the evening 🌙',
  writingDone: '🌟 You’re done for today! New words tomorrow morning ☀️',
  tryAgainHint: '<i>Want to try again? Just send another answer.</i>',
  noLessonYet: 'Today’s lesson isn’t ready yet — try /today in a minute.',
};

/** Splits a long HTML message on blank lines so each piece fits Telegram’s 4096-char limit. */
export function splitMessage(html: string, max = 4000): string[] {
  if (html.length <= max) return [html];
  const out: string[] = [];
  let cur = '';
  for (const block of html.split('\n\n')) {
    const next = cur ? `${cur}\n\n${block}` : block;
    if (next.length > max && cur) {
      out.push(cur);
      cur = block;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
