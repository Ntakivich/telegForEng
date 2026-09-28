import { describe, expect, it } from 'vitest';
import { esc, feedbackMessage, highlightWords, splitMessage } from '../src/format.js';

describe('highlightWords', () => {
  it('bolds words and their regular forms, but not other words that contain them', () => {
    const out = highlightWords('She baked a cake. Baking is fun. He carries bags and a carrot.', ['bake', 'carry', 'car']);
    expect(out).toBe('She <b>baked</b> a cake. <b>Baking</b> is fun. He <b>carries</b> bags and a carrot.');
  });
});

describe('feedbackMessage', () => {
  it('escapes model output', () => {
    const html = feedbackMessage(
      {
        transcript: 'I <3 tea',
        understood: true,
        praise: 'Good',
        corrections: [{ original: 'I goed', better: 'I went', why: 'irregular' }],
        improved: 'I love tea & coffee.',
        tip: '',
        used_words: [],
      },
      'voice',
    );
    expect(html).toContain('I &lt;3 tea');
    expect(html).toContain('<s>I goed</s> → <b>I went</b>');
    expect(html).toContain('tea &amp; coffee');
  });
});

describe('splitMessage', () => {
  it('splits on blank lines under the limit', () => {
    const parts = splitMessage(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n\n'), 70);
    expect(parts).toEqual(['a'.repeat(30) + '\n\n' + 'b'.repeat(30), 'c'.repeat(30)]);
  });
  it('esc handles html', () => expect(esc('<a&b>')).toBe('&lt;a&amp;b&gt;'));
});
