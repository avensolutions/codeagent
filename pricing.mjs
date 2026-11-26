// USD per million tokens: [input, output, 5-minute cache write, cache read].
// Source: Anthropic published list prices. Update when prices change.
export const PRICES = {
 'claude-fable-5-2':  [8, 40, 10, 0.20],
 'claude-mythos-5-2': [8, 40, 10, 0.20],
 'claude-fable-5-1':  [10, 50, 12.5, 0.25],
 'claude-mythos-5-1': [10, 50, 12.5, 0.25],
 'claude-opus-5-5':   [4, 20, 5, 0.20],
 'claude-opus-5':     [5, 25, 6.25, 0.50],
 'claude-opus-4-8':   [5, 25, 6.25, 0.50],
 'claude-sonnet-5-5': [2, 10, 2.5, 0.10],
 'claude-sonnet-5':   [2, 10, 2.5, 0.20],
};
// Unknown models (for example a fallback target not listed above) are priced at the highest listed rate.
const CEILING = [0, 1, 2, 3].map(i => Math.max(...Object.values(PRICES).map(p => p[i])));
export const priceOf = model => PRICES[model] ?? CEILING;

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
export const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// Highest output price a fallback attempt can bill at (the documented fallback targets are Opus 5 and Opus 4.8).
export const FALLBACK_OUTPUT_PRICE = 25;

// USD per web search. Web fetch has no per-request charge: fetched pages are billed as input tokens.
export const WEB_SEARCH_PRICE = 0.01;

// Estimated USD cost of one API response. usage.iterations, when present, lists every attempt
// (including declined, fallback and compaction steps) with its own model, so each is priced separately.
export function costOf(message, requestedModel) {
 const u = message.usage ?? {};
 const parts = u.iterations?.length ? u.iterations : [{...u, model: message.model}];
 let total = 0;
 for (const it of parts) {
  const [input, output, write5m, read] = priceOf(it.model ?? requestedModel);
  const write1h = it.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const writes = it.cache_creation_input_tokens ?? 0;
  total += (it.input_tokens ?? 0) * input + (it.output_tokens ?? 0) * output
   + (writes - write1h) * write5m + write1h * input * 2 + (it.cache_read_input_tokens ?? 0) * read;
 }
 return total / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PRICE;
}
