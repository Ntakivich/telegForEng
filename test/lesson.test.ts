import { describe, expect, it } from 'vitest';
import { A2_WORDS } from '../src/content/words-a2.js';
import { addDays, pickReviewWords, topicFor, unusedWords, validateLesson } from '../src/lesson.js';
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
    const lesson = validateLesson(raw, '2026-09-28', 'Food', [], new Set(['plate']));
    expect(lesson.words.map((w) => w.word)).toEqual(['kitchen', 'bake', 'recipe', 'fridge', 'oven']);
    expect(lesson.quiz.map((q) => q.question)).toEqual(['Q1', 'Q4', 'Q5']);
  });

  it('rejects a lesson with too few new words', () => {
    expect(() => validateLesson(raw, '2026-09-28', 'Food', [], new Set(['kitchen', 'bake', 'recipe']))).toThrow();
  });
});

describe('review words and topics', () => {
  const lesson = (day: string, words: string[]) => ({ day, words: words.map(card) }) as Lesson;

  it('takes words from lessons 1, 3, 7 and 14 days back only', () => {
    const day = '2026-09-28';
    const recent = [
      lesson(addDays(day, -1), ['a1', 'a2', 'a3']),
      lesson(addDays(day, -2), ['b1', 'b2']),
      lesson(addDays(day, -3), ['c1', 'c2']),
      lesson(addDays(day, -7), ['d1', 'd2']),
    ];
    const words = pickReviewWords(day, recent);
    expect(words).toHaveLength(5);
    expect(words.some((w) => w.startsWith('b'))).toBe(false);
  });

  it('rotates topics daily and never repeats taught words', () => {
    expect(topicFor('2026-09-28')).not.toBe(topicFor('2026-09-29'));
    const left = unusedWords(['ability', 'ABROAD']);
    expect(left).toHaveLength(A2_WORDS.length - 2);
  });

  it('adds days across month boundaries', () => expect(addDays('2026-09-30', 1)).toBe('2026-10-01'));
});
