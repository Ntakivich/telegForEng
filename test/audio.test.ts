import { describe, expect, it } from 'vitest';
import { decodeTtsAudio, encodeMp3 } from '../src/audio.js';

function wav(samples: Int16Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return new Uint8Array(buf);
}

const tone = (n: number) => Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 10) * 8000));

describe('decodeTtsAudio', () => {
  it('reads WAV with a RIFF header', () => {
    const pcm = decodeTtsAudio(wav(tone(100), 22050));
    expect(pcm.sampleRate).toBe(22050);
    expect([...pcm.samples]).toEqual([...tone(100)]);
  });

  it('reads raw L16 PCM and takes the rate from the mime type', () => {
    const samples = tone(50);
    const bytes = new Uint8Array(samples.length * 2);
    const v = new DataView(bytes.buffer);
    samples.forEach((s, i) => v.setInt16(i * 2, s, true));
    const pcm = decodeTtsAudio(bytes, 'audio/L16;codec=pcm;rate=16000');
    expect(pcm.sampleRate).toBe(16000);
    expect([...pcm.samples]).toEqual([...samples]);
  });
});

describe('encodeMp3', () => {
  it('produces an MP3 frame stream', () => {
    const mp3 = encodeMp3({ samples: tone(24000), sampleRate: 24000 });
    expect(mp3.length).toBeGreaterThan(1000);
    expect(mp3[0]).toBe(0xff); // MPEG frame sync
    expect(mp3[1]! & 0xe0).toBe(0xe0);
  });
});
