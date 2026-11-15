import { REVIEW_TOPICS } from './review-questions.js';

export async function requestGeminiSuggestions({ fetcher = fetch, hostname = globalThis.location?.hostname || 'localhost' } = {}) {
  let response;
  try {
    response = await fetcher('/api/health-suggestions', {
      method: 'POST', headers: { 'X-Human-Suggestions': 'generic-v1' }, signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('Gemini took too long to respond. Please try again.');
    throw new Error('The suggestions service could not be reached. Check the connection and try again.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
    throw new Error(local
      ? 'The Gemini service is not running at this address. Start the app with START_HUMAN_EXE.cmd or npm run dev, then use its localhost link.'
      : 'The Gemini API is missing from this deployment. Redeploy the latest project version with its API function, and set GEMINI_API_KEY for the Production environment.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The Gemini service returned an unreadable response. Restart or redeploy the app server and try again.'); }
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Gemini could not provide suggestions. Please try again.');
  for (const [topic, allowed] of Object.entries(REVIEW_TOPICS)) {
    const ids = result?.selections?.[topic];
    if (!Array.isArray(ids) || new Set(ids).size < 2 || ids.some(id => !allowed.includes(id))) {
      throw new Error('Gemini returned an incomplete suggestion list. Please try again.');
    }
  }
  return result.selections;
}
