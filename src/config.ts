// All settings come from environment variables (see .env.example).
// Getters are lazy so modules can be imported (e.g. in tests) without a full env.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function list(name: string, fallback: string): string[] {
  return optional(name, fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const HINT_LANGS = ['ru', 'uk', 'pl', 'en'] as const;
export type HintLang = (typeof HINT_LANGS)[number];

export const config = {
  get telegramToken() {
    return required('TELEGRAM_BOT_TOKEN');
  },
  get webhookSecret() {
    return required('TELEGRAM_WEBHOOK_SECRET');
  },
  get geminiApiKey() {
    return required('GEMINI_API_KEY');
  },
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get cronSecret() {
    return required('CRON_SECRET');
  },

  /** Daily lesson (1 call/day) — worth the best free model. Fallbacks follow. */
  get lessonModels() {
    return list('GEMINI_LESSON_MODELS', 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite');
  },
  /** Per-answer reviews (text + voice) — many calls/day, so Flash-Lite first. */
  get reviewModels() {
    return list('GEMINI_REVIEW_MODELS', 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash');
  },
  get ttsModels() {
    return list('GEMINI_TTS_MODELS', 'gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts');
  },
  get ttsVoice() {
    return optional('GEMINI_TTS_VOICE', 'Kore');
  },

  /** Lesson days and the “today” boundary follow this timezone. */
  get timezone() {
    return optional('TIMEZONE', 'Europe/Warsaw');
  },
  get defaultHintLang(): HintLang {
    const lang = optional('DEFAULT_HINT_LANG', 'ru');
    return (HINT_LANGS as readonly string[]).includes(lang) ? (lang as HintLang) : 'ru';
  },
  /** If set, new users must open t.me/<bot>?start=<INVITE_CODE>. */
  get inviteCode() {
    return process.env.INVITE_CODE || '';
  },
  /** Gemini checks (reviews + “listen” audio) per user per day — protects the free quota. */
  get maxChecksPerDay() {
    return Number(optional('MAX_CHECKS_PER_DAY', '30'));
  },
  /** Stop scheduled posts after this many days without any reply from the user. */
  get inactiveDaysBeforePause() {
    return Number(optional('INACTIVE_DAYS_BEFORE_PAUSE', '7'));
  },
};
