import { QUESTIONS, REVIEW_TOPICS } from '../src/review-questions.js';

export async function getGeminiSuggestions({ key, model = 'gemini-3.5-flash-lite', fetcher = fetch }) {
  if (!key || !/^[a-z0-9][a-z0-9.-]{0,79}$/i.test(model)) throw new Error('Gemini configuration is unavailable.');
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-goog-api-key':key },
    signal:AbortSignal.timeout(12000),
    body:JSON.stringify({
      contents:[{parts:[{text:'For each of these fictional review topics, select two distinct question IDs from its allowed list. Prioritize questions that help a clinician review observations. Return JSON only, mapping each topic to an array of IDs. This is a generic question bank; no patient information is present. ' + JSON.stringify({topics:REVIEW_TOPICS,questions:QUESTIONS})}]}],
      generationConfig:{ responseMimeType:'application/json', maxOutputTokens:512 },
    }),
  });
  if (!response.ok) throw new Error('Gemini request failed.');
  const envelope = await response.json();
  const candidate = envelope.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new Error('Gemini response was incomplete.');
  const output = JSON.parse(candidate.content?.parts?.filter(part => !part.thought).map(p => p.text ?? '').join('') ?? '');
  return Object.fromEntries(Object.entries(REVIEW_TOPICS).map(([topic,allowed]) => {
    if (!Array.isArray(output?.[topic])) throw new Error('Invalid suggestion response.');
    const ids = [...new Set(output[topic].filter(id => allowed.includes(id)))].slice(0,2);
    if (ids.length !== 2) throw new Error('Invalid suggestion list.');
    return [topic,ids];
  }));
}

export function createSuggestionHandler({ key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL, fetcher } = {}) {
  let cached, pending;
  let nextAttempt = 0;
  return async (req,res) => {
    if (req.url !== '/api/health-suggestions') return false;
    const respond = (status,value) => {
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(value));
      return true;
    };
    // Only the local UI can trigger this call. The endpoint accepts no input.
    const origin = req.headers.origin;
    const host = req.headers.host;
    const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host ?? '');
    if (req.method !== 'POST' || !localHost || origin !== `http://${host}`
        || req.headers['x-human-suggestions'] !== 'generic-v1'
        || Number(req.headers['content-length'] ?? 0) !== 0 || req.headers['transfer-encoding']) {
      req.resume();
      return respond(403,{error:'Only the local app can request generic suggestions.'});
    }
    if (!key) return respond(503,{error:'Gemini is not configured. Local suggestions are still available.'});
    if (cached && Date.now() < cached.expires) return respond(200,{selections:cached.selections});
    if (!pending && Date.now() < nextAttempt) return respond(429,{error:'Try Gemini again in a moment.'});
    if (!pending) {
      nextAttempt = Date.now() + 15000;
      pending = getGeminiSuggestions({key,model,fetcher}).then(selections => {
        cached = {selections,expires:Date.now()+3600000};
        return selections;
      }).finally(() => { pending = undefined; });
    }
    try { return respond(200,{selections:await pending}); }
    catch { return respond(502,{error:'Gemini is unavailable. Local suggestions are still available.'}); }
  };
}
