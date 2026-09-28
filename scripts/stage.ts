// Runs a scheduled stage by hand (same as the cron), e.g. `npm run stage -- morning`.
import { Api } from 'grammy';
import { config } from '../src/config.js';
import type { Stage } from '../src/db.js';
import { runScheduledStage } from '../src/stages.js';

const stage = process.argv[2] as Stage;
if (!['morning', 'midday', 'evening'].includes(stage)) {
  console.error('Usage: npm run stage -- morning|midday|evening');
  process.exit(1);
}
console.log(await runScheduledStage(new Api(config.telegramToken), stage, Date.now() + 270_000));
