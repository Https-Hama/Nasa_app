import { QUESTIONS, REVIEW_TOPICS } from '../src/review-questions.js';
import { DEFAULT_GEMINI_MODEL } from './gemini-config.mjs';

export class GeminiSuggestionError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'GeminiSuggestionError';
    this.code = code;
    this.status = status;
  }
}
const invalidResponse = () => new GeminiSuggestionError('invalid_response', 'Gemini could not return a complete suggestion list. Please try again.');

export async function getGeminiSuggestions({ key, model = DEFAULT_GEMINI_MODEL, fetcher = fetch }) {
  if (!key) throw new GeminiSuggestionError('not_configured', 'Gemini is not configured on the local server. Add the key to .env.local and restart the app.', 503);
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/i.test(model)) throw new GeminiSuggestionError('invalid_configuration', 'The configured Gemini model is invalid. Check GEMINI_MODEL and restart the app.', 503);
  let response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'For each of these fictional review topics, select two distinct question IDs from its allowed list. Prioritize questions that help a clinician review observations. Return JSON only, mapping each topic to an array of IDs. This is a generic question bank; no patient information is present. ' + JSON.stringify({ topics: REVIEW_TOPICS, questions: QUESTIONS }) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
      }),
    });
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new GeminiSuggestionError('timeout', 'Gemini took too long to respond. Please try again.', 504);
    throw new GeminiSuggestionError('network_error', 'The server could not connect to Gemini. Check the internet connection and try again.');
  }
  if (!response.ok) {
    // Never return upstream bodies: providers can include credential details in errors.
    let reason = '';
    try { const data = await response.json(); reason = JSON.stringify(data.error?.details ?? []).toUpperCase(); } catch {}
    if ([401, 403].includes(response.status) || (response.status === 400 && /API_KEY|CREDENTIAL|AUTHENTICATION/.test(reason))) {
      throw new GeminiSuggestionError('authentication', 'Google rejected the Gemini key or its permissions. Check the server key and its Gemini API access.');
    }
    if (response.status === 404) throw new GeminiSuggestionError('model_unavailable', 'The configured Gemini model is unavailable for this key. Check GEMINI_MODEL on the server.');
    if (response.status === 429) throw new GeminiSuggestionError('rate_limited', 'Gemini has reached its request or quota limit. Try again later or check the Google project quota.', 503);
    throw new GeminiSuggestionError('upstream_unavailable', 'Gemini could not process this request. Please try again shortly.');
  }
  try {
    const envelope = await response.json();
    const candidate = envelope.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw invalidResponse();
    const output = JSON.parse(candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? '');
    return Object.fromEntries(Object.entries(REVIEW_TOPICS).map(([topic, allowed]) => {
      if (!Array.isArray(output?.[topic])) throw invalidResponse();
      const ids = [...new Set(output[topic].filter(id => allowed.includes(id)))].slice(0, 2);
      if (ids.length !== 2) throw invalidResponse();
      return [topic, ids];
    }));
  } catch { throw invalidResponse(); }
}

export function createSuggestionHandler({ key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, model = process.env.GEMINI_MODEL, fetcher } = {}) {
  let cached, pending;
  let nextAttempt = 0;
  return async (req, res) => {
    if (req.url?.split('?')[0] !== '/api/health-suggestions') return false;
    const respond = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
      return true;
    };
    const origin = req.headers.origin;
    const host = req.headers.host;
    const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host ?? '');
    // No health readings, names, notes or reports are accepted by this endpoint.
    if (req.method !== 'POST' || !localHost || origin !== `http://${host}`
        || req.headers['x-human-suggestions'] !== 'generic-v1'
        || Number(req.headers['content-length'] ?? 0) !== 0 || req.headers['transfer-encoding']) {
      req.resume();
      return respond(403, { error: 'Only the local app can request generic suggestions.', code: 'forbidden' });
    }
    if (!key) return respond(503, { error: 'Gemini is not configured on the local server. Add the key to .env.local and restart the app.', code: 'not_configured' });
    if (cached && Date.now() < cached.expires) return respond(200, { selections: cached.selections });
    if (!pending && Date.now() < nextAttempt) return respond(429, { error: 'Try Gemini again in a moment.', code: 'retry_later' });
    if (!pending) {
      nextAttempt = Date.now() + 15000;
      pending = getGeminiSuggestions({ key, model, fetcher }).then(selections => {
        cached = { selections, expires: Date.now() + 3600000 };
        return selections;
      }).finally(() => { pending = undefined; });
    }
    try { return respond(200, { selections: await pending }); }
    catch (error) {
      const safe = error instanceof GeminiSuggestionError ? error : invalidResponse();
      return respond(safe.status, { error: safe.message, code: safe.code });
    }
  };
}
