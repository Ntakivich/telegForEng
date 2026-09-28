import { ApiError, GoogleGenAI, type Part } from '@google/genai';
import { decodeTtsAudio, encodeMp3 } from './audio.js';
import { config } from './config.js';

let client: GoogleGenAI | undefined;
function ai() {
  return (client ??= new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: 120_000 } }));
}

const TRANSIENT = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tries each model in order. A transient error (overloaded/5xx) gets one retry
 * on the same model; quota (429), unsupported-model and other errors move on
 * to the next model — on the free tier each model has its own daily quota.
 */
async function withFallback<T>(models: string[], run: (model: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await run(model);
      } catch (error) {
        lastError = error;
        const status = error instanceof ApiError ? error.status : undefined;
        console.warn(`gemini ${model} attempt ${attempt} failed`, status ?? '', String(error).slice(0, 300));
        if (!status || !TRANSIENT.has(status)) break;
        await sleep(2000);
      }
    }
  }
  throw lastError;
}

export async function generateJson<T>(opts: {
  models: string[];
  system: string;
  parts: Part[];
  schema: object;
  temperature?: number;
}): Promise<T> {
  return withFallback(opts.models, async (model) => {
    const res = await ai().models.generateContent({
      model,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: 'application/json',
        responseJsonSchema: opts.schema,
        temperature: opts.temperature,
      },
    });
    const text = res.text;
    if (!text) throw new Error(`Empty response from ${model} (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`);
    return JSON.parse(text) as T;
  });
}

/** Text → MP3 voice clip. `style` is a spoken-delivery instruction. */
export async function speak(text: string, style: string): Promise<Uint8Array> {
  return withFallback(config.ttsModels, async (model) => {
    const res = await ai().models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `${style}\n\n${text}` }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.ttsVoice } } },
      },
    });
    const audio = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new Error(`No audio from ${model}`);
    return encodeMp3(decodeTtsAudio(Buffer.from(audio.data, 'base64'), audio.mimeType));
  });
}
