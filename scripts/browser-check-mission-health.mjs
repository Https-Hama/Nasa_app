import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createMissionReviewHandler } from './gemini-mission-review.mjs';

// Run the real browser -> API -> provider-response -> storage/export flow without
// a live API key. Only the external Google request is replaced with a fixture.
const root = fileURLToPath(new URL('../', import.meta.url));
const artifact = name => fileURLToPath(new URL(`../artifacts/${name}`, import.meta.url));
await mkdir(artifact(''), { recursive: true });
const review = {
  summary: 'You completed the flight, three memory rounds and eight focus cues.',
  strengths: ['All three memory rounds were completed.'], observations: ['Six of eight focus responses were correct.'],
  nextSteps: ['Repeat the same tasks with the same input method.'], limitations: ['Leg measurements were unavailable.'],
  healthChecks: ['focus-recheck', 'sleep-alertness', 'eye-comfort', 'movement-comfort'],
  spaceExercises: ['ared-heel-raise', 'cevis-cycle'],
};
let releaseProvider, failProvider = false, providerCalls = 0;
const providerGate = new Promise(resolve => { releaseProvider = resolve; });
const handler = createMissionReviewHandler({ key: 'fictional-browser-verification-key', model: 'gemini-test', fetcher: async (url, options) => {
  providerCalls++;
  assert.match(url, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(options.body, /Health Guidance QA|private-browser-health-id|landmarks|PRIVATE_NOTE/);
  const body = JSON.parse(options.body), payload = JSON.parse(body.contents[0].parts[0].text);
  assert.ok(payload.guidanceOptions.healthChecks.some(item => item.id === 'sleep-alertness'));
  assert.ok(body.generationConfig.responseSchema.required.includes('spaceExercises'));
  await providerGate;
  return failProvider
    ? new Response(JSON.stringify({ error: { message: 'Controlled provider failure.' } }), { status: 503 })
    : new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(review) }] } }] }));
} });
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'mission-health-verification-provider',
  configureServer(vite) { vite.middlewares.use((request, response, next) => { handler(request, response).then(handled => { if (!handled) next(); }, next); }); },
}] });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().endsWith('/api/mission-review')) return;
    assert.doesNotMatch(request.postData(), /Health Guidance QA|private-browser-health-id|landmarks|PRIVATE_NOTE/);
    requests.push(JSON.parse(request.postData()));
  });
  const record = {
    id: 'private-browser-health-id', timestamp: Date.now(), source: 'measured', protocol: 'orbital-observation-v2', inputMode: 'motion', durationSec: 120,
    conditions: { sessionStage: 'complete', geminiReviewRequested: true }, game: { score: 450, hull: 70, kills: 5, shots: 20, accuracy: 25 },
    cognitive: { memory: { protocol: 'pattern-memory-3-4-5-random-v3', rounds: 3, correct: 12, attempts: 12 },
      attention: { protocol: 'focus-go-no-go-random-v3', correct: 6, attempts: 8, misses: 1, falseAlarms: 1, medianReactionMs: 420 } },
    observations: {
      face: { baselineReady: true, validSeconds: 25, coverage: .9, meanFps: 18, longClosureCount: 3, longestClosureSec: 1.8, eyeClosurePct: 12 },
      body: { validSeconds: 90, coverage: .9, fullBodyCoverage: .2, leftHandTravel: 10, rightHandTravel: 8, squats: 99 },
    },
  };
  const seed = async (item, autoGemini = true) => {
    await page.evaluate(({ item, autoGemini }) => {
      localStorage.setItem('human-exe-observations-v2', JSON.stringify([item]));
      localStorage.setItem('human-exe-preferences-v2', JSON.stringify({ sound: false, saveReports: true, autoGemini }));
    }, { item, autoGemini });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-view="journal"]').click();
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#player-onboarding-name').fill('Health Guidance QA');
  await page.locator('#player-onboarding-submit').click();
  await seed(record);
  await expect(page.locator('.mission-review-pending')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Health checks & recovery' })).toBeVisible();
  await expect(page.locator('.mission-health-label')).toHaveText('General guidance');
  releaseProvider();
  await expect(page.locator('.mission-review-ready')).toBeVisible();
  await expect(page.locator('.mission-health-label')).toHaveText('Prioritized by Gemini');
  assert.equal(await page.locator('[data-health-check]').count(), 4);
  assert.equal(await page.locator('[data-space-exercise]').count(), 2);
  await expect(page.locator('[data-health-check="sleep-alertness"]')).toContainText('3 long eye-closure events');
  await expect(page.locator('[data-health-check="movement-comfort"]')).toContainText('leg measurements are unavailable');
  await page.locator('[data-health-check="eye-comfort"] summary').click();
  await expect(page.locator('[data-health-check="eye-comfort"] dd').filter({ hasText: 'eye examination' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-report').click();
  const download = await downloadPromise;
  await download.saveAs(artifact('mission-health-export.json'));
  const exported = JSON.parse(await readFile(artifact('mission-health-export.json'), 'utf8'));
  assert.deepEqual(exported.record.geminiReview.healthChecks, review.healthChecks);
  assert.deepEqual(exported.record.geminiReview.spaceExercises, review.spaceExercises);
  await page.locator('[data-health-check="eye-comfort"] summary').click();
  await page.locator('.mission-health').screenshot({ path: artifact('mission-health-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-health-check="sleep-alertness"]').screenshot({ path: artifact('mission-health-mobile.png') });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-view="journal"]').click();
  await expect(page.locator('.mission-review-ready')).toBeVisible();
  assert.equal(providerCalls, 1, 'A saved review must not request the provider again');
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('human-exe-observations-v2'))[0]);
  assert.deepEqual(restored.geminiReview, exported.record.geminiReview);

  failProvider = true;
  await seed({ ...record, id: 'failed-review', game: { ...record.game, score: 451 }, observations: {} });
  await expect(page.locator('.mission-review-error[aria-label]')).toBeVisible();
  await expect(page.locator('[data-mission-review-retry]')).toBeVisible();
  assert.equal(await page.locator('[data-health-check]').count(), 3); // Sleep, eyes and completed focus errors.
  await expect(page.locator('[data-health-check="sleep-alertness"]')).toContainText('unavailable');
  await expect(page.getByRole('heading', { name: 'Spacecraft exercise options' })).toBeVisible();

  const callsBeforeDisabled = providerCalls;
  await seed(record, false);
  await expect(page.locator('.mission-review-disabled')).toBeVisible();
  await expect(page.locator('.mission-health-label')).toHaveText('General guidance');
  assert.equal(providerCalls, callsBeforeDisabled);
  const { healthChecks, spaceExercises, ...legacyReview } = review;
  await seed({ ...record, geminiReview: legacyReview }, false);
  await expect(page.locator('.mission-review-ready')).toBeVisible();
  await expect(page.locator('.mission-health-label')).toHaveText('General guidance');
  await expect(page.getByRole('heading', { name: 'Spacecraft exercise options' })).toBeVisible();
  await page.locator('#demo-tab').click();
  assert.equal(await page.locator('.mission-health').count(), 0);
  await seed({ ...record, conditions: { sessionStage: 'mind', geminiReviewRequested: true } });
  await expect(page.locator('.mission-review-partial')).toBeVisible();
  assert.equal(await page.locator('.mission-health').count(), 0);
  assert.equal(providerCalls, callsBeforeDisabled);
  assert.deepEqual(errors, []);
  const result = { passed: true, provider: 'controlled fixture, not live Gemini', providerCalls, apiRequests: requests.length,
    generatedGuidance: true, pendingGuidance: true, persistedAndExported: true, mobileOverflow: false,
    providerFailureFallback: true, disabledFallback: true, legacyFallback: true, demoAndPartialExcluded: true, browserErrors: errors };
  await writeFile(artifact('mission-health-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  releaseProvider();
  await browser?.close();
  await server.close();
}
