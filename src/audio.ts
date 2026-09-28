import { Mp3Encoder } from '@breezystack/lamejs';

// Gemini TTS returns 16-bit mono PCM (either WAV with a RIFF header or raw
// `audio/L16;rate=24000`). Telegram's sendVoice wants OGG/Opus, MP3 or M4A,
// so we encode to MP3 in pure JS — no ffmpeg binary needed on serverless.

export type Pcm = { samples: Int16Array; sampleRate: number };

function readAscii(view: DataView, offset: number, length: number) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function toInt16(view: DataView, offset: number, byteLength: number): Int16Array {
  const out = new Int16Array(Math.floor(byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(offset + i * 2, true);
  return out;
}

export function decodeTtsAudio(bytes: Uint8Array, mimeType = ''): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 12 && readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE') {
    let sampleRate = 24000;
    let offset = 12;
    while (offset + 8 <= bytes.byteLength) {
      const id = readAscii(view, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const body = offset + 8;
      if (id === 'fmt ') {
        const channels = view.getUint16(body + 2, true);
        const bits = view.getUint16(body + 14, true);
        if (channels !== 1 || bits !== 16) throw new Error(`Unsupported WAV: ${channels}ch ${bits}bit`);
        sampleRate = view.getUint32(body + 4, true);
      } else if (id === 'data') {
        const length = Math.min(size, bytes.byteLength - body);
        return { samples: toInt16(view, body, length), sampleRate };
      }
      offset = body + size + (size % 2);
    }
    throw new Error('WAV has no data chunk');
  }
  const rate = /rate=(\d+)/i.exec(mimeType)?.[1];
  return { samples: toInt16(view, 0, bytes.byteLength), sampleRate: rate ? Number(rate) : 24000 };
}

export function encodeMp3({ samples, sampleRate }: Pcm, kbps = 64): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const block = 1152 * 16;
  for (let i = 0; i < samples.length; i += block) {
    const chunk = encoder.encodeBuffer(samples.subarray(i, i + block));
    if (chunk.length) chunks.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);

  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
