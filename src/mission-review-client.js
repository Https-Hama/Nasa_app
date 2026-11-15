import { buildMissionReviewPayload, sanitizeMissionReview } from './mission-review-model.js';

const isLocal = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
const timedOut = error => ['TimeoutError', 'AbortError'].includes(error?.name);
const timeoutMessage = 'Gemini took too long to review this mission. Your measured report remains available. Please try again.';

export async function requestMissionReview(record, previous = null, { fetcher = fetch, hostname = globalThis.location?.hostname || 'localhost' } = {}) {
  const mission = buildMissionReviewPayload(record, previous);
  if (!mission) {
    throw new Error(record?.source === 'demo'
      ? 'Gemini reviews are available for measured missions. This fictional preview stays separate.'
      : 'Finish the flight and mind check before generating a review of this mission.');
  }
  let response;
  try {
    response = await fetcher('/api/mission-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Human-Mission-Review': 'mission-v1' },
      body: JSON.stringify({ mission }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    throw new Error(timedOut(error) ? timeoutMessage : 'The Gemini review service could not be reached. Your measured report remains available. Check the connection and try again.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(isLocal(hostname)
      ? 'The Gemini review service is not running at this address. Start the app with START_HUMAN_EXE.cmd or npm run dev, then use its localhost link.'
      : 'The Gemini review API is missing from this deployment. Redeploy the latest project with its mission-review API function and set GEMINI_API_KEY for the Production environment.');
  }
  let result;
  try { result = await response.json(); }
  catch (error) {
    throw new Error(timedOut(error) ? timeoutMessage : 'The Gemini review service returned an unreadable response. Restart or redeploy the app server and try again.');
  }
  if (!response.ok) {
    throw new Error(typeof result?.error === 'string' && result.error.trim()
      ? result.error.trim().slice(0, 700)
      : 'Gemini could not review this mission. Your measured report remains available. Please try again.');
  }
  const review = sanitizeMissionReview(result?.review);
  if (!review) throw new Error('Gemini returned an incomplete mission review. Your measured report remains available. Please try again.');
  return review;
}
