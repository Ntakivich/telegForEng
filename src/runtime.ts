import type { Update } from 'grammy/types';
import { createBot } from './bot.js';
import { config } from './config.js';
import { claimUpdate, type Stage } from './db.js';
import { runScheduledStage } from './stages.js';

// One bot instance per warm function instance.
let bot: ReturnType<typeof createBot> | undefined;
let ready: Promise<void> | undefined;

async function getBot() {
  bot ??= createBot();
  ready ??= bot.init().catch((error) => {
    ready = undefined;
    throw error;
  });
  await ready;
  return bot;
}

export async function processUpdate(update: Update) {
  if (!(await claimUpdate(update.update_id))) return; // Telegram redelivery
  await (await getBot()).handleUpdate(update);
}

/** Vercel Hobby allows 300 s per function; keep a margin for the last message. */
const BUDGET_MS = 270_000;

export async function handleCron(request: Request, stage: Stage): Promise<Response> {
  if (request.headers.get('authorization') !== `Bearer ${config.cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const started = Date.now();
  const report = await runScheduledStage((await getBot()).api, stage, started + BUDGET_MS);
  console.log('cron done', { ...report, ms: Date.now() - started });
  return Response.json(report);
}
