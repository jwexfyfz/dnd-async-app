// Single place to swap the DM model or tune AI behaviour.
// Upgrade to claude-sonnet-4-6 if narrative quality feels thin.
export const DM_MODEL = "claude-haiku-4-5" as const;

// Max tokens per DM response.
// 2-4 sentences of narrative + stateDeltas + 5 chips fits in ~512 tokens.
export const DM_MAX_TOKENS = 600;

// How many past messages to include in the AI context window.
// Older messages are still stored for the Chronicle display but are not
// sent to the AI, keeping costs and latency predictable.
export const ROLLING_WINDOW_SIZE = 15;
