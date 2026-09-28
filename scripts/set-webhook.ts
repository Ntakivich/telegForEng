// Usage: npm run set-webhook -- https://your-app.vercel.app
import { Api } from 'grammy';
import { BOT_COMMANDS } from '../src/bot.js';
import { config } from '../src/config.js';

const base = process.argv[2]?.replace(/\/$/, '');
if (!base?.startsWith('https://')) {
  console.error('Usage: npm run set-webhook -- https://your-app.vercel.app');
  process.exit(1);
}
const api = new Api(config.telegramToken);
await api.setWebhook(`${base}/api/telegram`, {
  secret_token: config.webhookSecret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
await api.setMyCommands(BOT_COMMANDS);
await api.setMyDescription(
  'Daily English practice for A2 learners: new words in the morning, a short story with voice questions at lunch, a quiz in the evening — with instant, friendly feedback.',
);
console.log('✅ webhook set:', await api.getWebhookInfo());
