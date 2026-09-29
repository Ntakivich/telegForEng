import { describe, expect, it } from 'vitest';
import { A2_WORDS } from '../src/content/words-a2.js';
import { addDays, pickReviewWords, themeFor, unusedWords, validateLesson } from '../src/lesson.js';
import type { Lesson, WordCard } from '../src/lesson-types.js';

const card = (word: string): WordCard => ({
  word, pos: 'noun', ipa: 'x', meaning: 'm', translation: { ru: 'р', uk: 'у', pl: 'p' },
  examples: ['e1', 'e2'], collocations: ['c'], tip: '',
});

const raw = {
  title: 'T',
  words: ['kitchen', 'Kitchen', 'bake', 'recipe', 'fridge', 'oven', 'plate'].map(card),
  story: { title: 'S', text: 'Once…' },
  speaking: ['Why?', 'And you?'],
  writing: ['Write to a friend.', 'Describe.'],
  quiz: [
    { question: 'Q1', options: ['a', 'b', 'c'], correct_index: 1, explanation: 'x' },
    { question: 'Q2', options: ['a', 'b'], correct_index: 5, explanation: '' }, // bad index
    { question: 'Q3', options: ['a', 'a'], correct_index: 0, explanation: '' }, // duplicate options
    { question: 'Q4', options: ['a', 'b', 'c', 'd'], correct_index: 3, explanation: '' },
    { question: 'Q5', options: ['a', 'b', 'c'], correct_index: 0, explanation: '' },
  ],
};

describe('validateLesson', () => {
  it('drops duplicate/used words and broken quiz items', () => {
    const lesson = validateLesson(raw, { day: '2026-09-28', topic: 'food', theme: 'Cooking' }, [], new Set(['plate']));
    expect(lesson.words.map((w) => w.word)).toEqual(['kitchen', 'bake', 'recipe', 'fridge', 'oven']);
    expect(lesson.quiz.map((q) => q.question)).toEqual(['Q1', 'Q4', 'Q5']);
  });

  it('rejects a lesson with too few new words', () => {
    const meta = { day: '2026-09-28', topic: 'food', theme: 'Cooking' };
    expect(() => validateLesson(raw, meta, [], new Set(['kitchen', 'bake', 'recipe']))).toThrow();
  });
});

describe('review words and topics', () => {
  const lesson = (day: string, words: string[]) => ({ day, words: words.map(card) }) as Lesson;

  it('takes words from the lessons 1, 3, 7 and 14 lessons back only (newest first)', () => {
    const day = '2026-09-28';
    const recent = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p, i) => lesson(addDays(day, -1 - i), [`${p}1`, `${p}2`]));
    const words = pickReviewWords(day, recent);
    expect(words).toHaveLength(5); // 2 + 2 + 1
    expect(words.map((w) => w[0]).sort()).toEqual(['a', 'a', 'c', 'c', 'g']);
  });

  it('gives each day of a topic week its own focus; mix rotates themes', () => {
    const week = Array.from({ length: 7 }, (_, i) => themeFor('food', addDays('2026-09-28', i)));
    expect(new Set(week).size).toBe(7);
    expect(themeFor('mix', '2026-09-28')).not.toBe(themeFor('mix', '2026-09-29'));
    const left = unusedWords(['ability', 'ABROAD']);
    expect(left).toHaveLength(A2_WORDS.length - 2);
  });

  it('adds days across month boundaries', () => expect(addDays('2026-09-30', 1)).toBe('2026-10-01'));
});
