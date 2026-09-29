export type WordCard = {
  word: string;
  pos: string;
  ipa: string;
  /** Simple English definition, A2 level. */
  meaning: string;
  translation: { ru: string; uk: string; pl: string };
  examples: string[];
  collocations: string[];
  /** Optional usage note (common mistake, irregular form…); may be empty. */
  tip: string;
};

export type QuizItem = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

export type Lesson = {
  day: string; // YYYY-MM-DD in config.timezone
  /** Topic id from the catalog, or 'mix'. */
  topic: string;
  /** The day's focus, e.g. “At the airport”. */
  theme: string;
  title: string;
  words: WordCard[];
  /** Words from earlier lessons woven into today's story and quiz (spaced review). */
  review_words: string[];
  story: { title: string; text: string };
  /** Asked as voice messages after the story; answered by voice. */
  speaking: string[];
  /** Evening writing tasks; answered by text. */
  writing: string[];
  quiz: QuizItem[];
};
