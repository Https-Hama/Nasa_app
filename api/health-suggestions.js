import { createSuggestionHandler } from '../scripts/gemini-suggestions.mjs';
import { readHostedGeminiConfig } from '../scripts/hosted-gemini-config.mjs';

const PRODUCTION_ORIGIN = 'https://nasa-app-ashy.vercel.app';

export function createVercelSuggestionHandler({ env = process.env, fetcher } = {}) {
  const config = readHostedGeminiConfig(env);
  const handle = createSuggestionHandler({
    ...config,
    key: config.key ?? '',
    // Keep the production alias working even if Vercel system variables are disabled.
    allowedOrigins: [...new Set([PRODUCTION_ORIGIN, ...config.allowedOrigins])],
    fetcher,
  });
  return async (request, response) => {
    if (await handle(request, response)) return;
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Suggestions endpoint not found.', code: 'not_found' }));
  };
}

export default createVercelSuggestionHandler();
