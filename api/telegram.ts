import { waitUntil } from '@vercel/functions';
import { config } from '../src/config.js';
import { processUpdate } from '../src/runtime.js';

// Telegram webhook. We answer 200 right away and do the slow part (Gemini)
// in waitUntil — otherwise Telegram times out and resends the update.
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== config.webhookSecret) {
    return new Response('unauthorized', { status: 401 });
  }
  const update = await request.json();
  waitUntil(processUpdate(update).catch((error) => console.error('update failed', error)));
  return new Response('ok');
}
