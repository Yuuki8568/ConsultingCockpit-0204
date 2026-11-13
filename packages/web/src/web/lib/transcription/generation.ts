// Whisper's decoder has 448 positions INCLUDING the language/task prompt.
// max_new_tokens: 448 exceeds that capacity when generation reaches the limit.
export const GENERATION_OPTIONS = {
  language: 'japanese', task: 'transcribe', chunk_length_s: 30,
  stride_length_s: 5, return_timestamps: true, max_length: 448,
} as const;

/** Flag runaway phrase loops; never silently delete words that may have been spoken. */
export function hasRunawayRepetition(text: string): boolean {
  const compact = text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
  return /(.{8,80}?)\1{3,}/u.test(compact);
}
