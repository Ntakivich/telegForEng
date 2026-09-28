// Local development: long polling instead of the webhook.
// Note: while this runs, the Vercel webhook is removed — run `npm run set-webhook` afterwards.
import { BOT_COMMANDS, createBot } from '../src/bot.js';

const bot = createBot();
await bot.api.deleteWebhook();
await bot.api.setMyCommands(BOT_COMMANDS);
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
console.log('🤖 polling… (Ctrl+C to stop)');
await bot.start({ allowed_updates: ['message', 'callback_query'] });
