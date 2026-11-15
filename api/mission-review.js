import { createMissionReviewHandler } from '../scripts/gemini-mission-review.mjs';
import { readHostedGeminiConfig } from '../scripts/hosted-gemini-config.mjs';

export function createVercelMissionReviewHandler({ env = process.env, fetcher } = {}) {
  const config = readHostedGeminiConfig(env);
  const handle = createMissionReviewHandler({ ...config, key: config.key ?? '', fetcher,
    allowedOrigins: [...new Set(['https://nasa-app-ashy.vercel.app', ...config.allowedOrigins])] });
  return async (request, response) => {
    if (await handle(request, response)) return;
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Mission review endpoint not found.', code: 'not_found' }));
  };
}

export default createVercelMissionReviewHandler();