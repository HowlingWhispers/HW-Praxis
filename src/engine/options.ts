// A save's own settings for what the narrator is sent, and the token arithmetic behind them.
//
// Tokens are estimated from characters. NovelAI reports the real prompt size with every
// reply, so the estimate is recalibrated from those reports as play goes on.

import { z } from 'zod';

export const optionsSchema = z.object({
  // The model's whole window. GLM-4.6 and Xialong on NovelAI take about 28k.
  contextTokens: z.number().int().min(4000).max(200_000).default(28_000),
  // Kept free for the reply, and the longest reply asked for.
  replyTokens: z.number().int().min(200).max(4000).default(1000),
  // The most the journal may take. Past it, the oldest entries are compressed.
  journalTokens: z.number().int().min(300).max(20_000).default(3000),
  // When the story outgrows its share of the window, this much leaves at once, so the
  // start of the transcript stays put between cuts and the prompt prefix can be reused.
  pieceTokens: z.number().int().min(1000).max(50_000).default(6000),
  // Suggest a journal entry for story that is about to leave the window.
  autoJournal: z.boolean().default(true),
  // Suggest compressing the oldest entries when the journal is over its budget.
  autoCompress: z.boolean().default(true),
  // Settle checks without rolling unless the player asks for the dice.
  alwaysSucceed: z.boolean().default(false),
  // Estimated tokens per character, recalibrated from NovelAI's reports.
  tokensPerChar: z.number().min(0.1).max(1).default(0.3),
});

export type Options = z.infer<typeof optionsSchema>;

export const DEFAULT_OPTIONS: Options = optionsSchema.parse({});

// Room the moment (scene notes and the player's words) is assumed to need. Kept as a fixed
// reserve so the transcript's share does not move with every scene change.
export const MOMENT_RESERVE = 1500;

export function estimateTokens(text: string, tokensPerChar: number): number {
  return text ? Math.ceil(text.length * tokensPerChar) : 0;
}

// Folds one measured prompt into the estimate. Slow to move, so one odd prompt changes little.
export function calibrate(tokensPerChar: number, promptChars: number, promptTokens: number): number {
  if (!(promptChars > 200) || !(promptTokens > 0)) return tokensPerChar;
  const measured = promptTokens / promptChars;
  if (!Number.isFinite(measured)) return tokensPerChar;
  const next = tokensPerChar * 0.7 + measured * 0.3;
  return Math.round(Math.min(1, Math.max(0.1, next)) * 10_000) / 10_000;
}
