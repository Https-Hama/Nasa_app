import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Exercises the real app and game with controlled tracking callbacks; no webcam is used.
const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const chrome = process.env.CHROME_PATH
  ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const bodyStub = `
export class BodyController {
  constructor(callbacks) {
    Object.assign(this, callbacks);
    this.phase = 'idle';
    window.__cameraTest = {
      emit: state => this.emit(state),
      lost: () => this.emit('lost'),
      tracking: () => this.emit('tracking'),
    };
  }
  emit(state) {
    this.onMetrics({ calibrated: true, fullBody: false, confidence: state === 'tracking' ? 1 : 0, fps: 30, gesture: 'neutral' });
    this.onInput({ x: 0, y: 0, tracked: state === 'tracking', fullBody: false, calibrated: true, controlsReady: true, fire: false, shield: false });
    this.onStatus({ state, message: state === 'tracking' ? 'Portrait tracking ready.' : 'Tracking temporarily unavailable.' });
    return performance.now();
  }
  async start() { this.emit('tracking'); return true; }
  calibrate() { this.emit('tracking'); }
  stop() { this.emit('off'); }
  setObservationPhase(phase) { this.phase = phase; }
  resetObservations() {}
  getObservationSummary() {
    return { protocol: 'orbital-observation-v2', durationSec: 0,
      face: { validSeconds: 0, coverage: 0, meanFps: 0, baselineReady: false, qualityReasons: ['Synthetic integration test: no face evidence.'], landmarks: [[1, 2, 3]], video: 'must-not-save', image: 'must-not-save' },
      body: { validSeconds: 0, coverage: 0, fullBodyCoverage: 0, qualityReasons: ['Synthetic integration test: no camera evidence.'] } };
  }
  async enableObservations(enabled) {
    this.onObservation({ faceReady: enabled, summary: this.getObservationSummary() });
    return true;
  }
}
`;
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true });
await context.route('**/src/body-controller.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: bodyStub }));
const page = await context.newPage();
const pageErrors = [];
const checks = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
const pass = check => { checks.push(check); console.log('PASS:', check); };
const emit = state => page.evaluate(value => window.__cameraTest.emit(value), state);
const pause = page.locator('#pause-overlay');
const sustainedLoss = async () => {
  await emit('lost');
  await expect(pause).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#pause-reason')).toContainText('tracking is recovering');
};

try {
  await page.goto(url);
  await expect(page.locator('#player-onboarding-name')).toBeVisible();
  await page.locator('#player-onboarding-name').fill('Recovery test player');
  await page.locator('#player-onboarding-submit').click();
  await expect(page.locator('#player-dialog')).not.toBeVisible();
  await page.locator('#enable-camera').click();
  await expect(page.locator('#camera-status-pill')).toHaveText('CONNECTED');
  await expect(page.locator('#body-view')).toHaveText('UPPER');

  await page.locator('#observation-consent').check();
  await expect(page.locator('#face-check')).toBeEnabled();
  await page.locator('#face-check').click();
  await expect(page.locator('#face-scan-dialog[open]')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#skip-check').click();
  await expect(page.locator('#face-scan-dialog')).not.toBeVisible();
  const faceChecks = await page.evaluate(() => JSON.parse(localStorage.getItem('human-exe-face-checks-v1')));
  assert.equal(faceChecks.length, 1);
  assert.ok(faceChecks[0].durationSec > 0 && faceChecks[0].durationSec < 30);
  assert.equal(faceChecks[0].protocol, 'face-check-30s-v2');
  assert.equal(faceChecks[0].face.baselineReady, false);
  assert.equal(JSON.stringify(faceChecks).includes('must-not-save'), false);
  assert.equal('landmarks' in faceChecks[0].face, false);
  pass('An early face check archives a derived summary before any flight, without camera pixels or landmarks.');

  await page.reload();
  await expect(page.locator('#player-dialog')).not.toBeVisible();
  await page.locator('[data-view="health"]').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#health-export').click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(exported.player, 'Recovery test player');
  assert.equal(exported.faceChecks.length, 1);
  assert.equal(exported.faceChecks[0].id, faceChecks[0].id);
  assert.equal(exported.missionReports.length, 0);
  pass('The saved face check survives reload and appears in the selected player’s health export.');
  await page.locator('[data-view="flight"]').click();
  await page.locator('#enable-camera').click();
  await expect(page.locator('#camera-status-pill')).toHaveText('CONNECTED');
  await page.locator('#launch').click();
  await expect(page.locator('#live-hud')).toBeVisible();
  await expect(pause).not.toBeVisible();

  await emit('lost');
  await page.waitForTimeout(600);
  await expect(pause).not.toBeVisible();
  await emit('tracking');
  await expect(pause).not.toBeVisible();
  pass('Brief portrait tracking loss does not pause flight.');

  await sustainedLoss();
  await emit('tracking');
  await expect(pause).not.toBeVisible();
  pass('Sustained tracking loss pauses; returning tracking resumes automatically.');

  await sustainedLoss();
  // Opening the guide intentionally takes ownership of an existing recovery pause.
  await page.locator('#controls-help').click();
  await expect(page.locator('#help-dialog[open]')).toBeVisible();
  await page.locator('#help-dialog .dialog-close').click();
  await emit('tracking');
  await page.waitForTimeout(300);
  await expect(pause).toBeVisible();
  await page.locator('#resume').click();
  await expect(pause).not.toBeVisible();
  pass('An intentional guide/manual pause stays paused when tracking returns.');

  await sustainedLoss();
  await emit('tracking');
  await expect(pause).not.toBeVisible();
  pass('Explicit Resume re-arms tracking recovery for the next loss.');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  await expect(pause).not.toBeVisible();
  pass('Window focus loss alone does not pause flight.');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(pause).toBeVisible();
  await expect(page.locator('#pause-reason')).toContainText('Tab hidden');
  await emit('lost');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await emit('tracking');
  await page.waitForTimeout(300);
  await expect(pause).toBeVisible();
  await page.locator('#resume').click();
  await expect(pause).not.toBeVisible();
  pass('A hidden tab pauses and requires explicit Resume after tracking returns.');

  await page.evaluate(() => {
    window.__originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'human-exe-observations-v2') throw new DOMException('Synthetic report storage failure', 'QuotaExceededError');
      return window.__originalStorageSetItem.call(this, key, value);
    };
  });
  await page.locator('#pause-button').click();
  await expect(pause).toBeVisible();
  await page.locator('#end-flight').click();
  await expect(page.locator('#mind-dialog[open]')).toBeVisible();
  await page.locator('#skip-mind').click();
  await expect(page.locator('#journal-view')).toBeVisible();
  await expect(page.locator('#storage-warning')).toBeVisible();
  await expect(page.locator('#storage-warning-text')).toContainText('Not saved');
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__originalStorageSetItem;
    delete window.__originalStorageSetItem;
  });
  await page.locator('#retry-save').click();
  await expect(page.locator('#storage-warning')).not.toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('human-exe-observations-v2')));
  assert.equal(saved.length, 1, 'Retry updates the existing progress record rather than duplicating it');
  assert.equal(saved[0].conditions.sessionStage, 'complete');
  assert.ok(saved[0].durationSec > 0);
  pass('A failed final report save stays visible and Retry saving persists the completed report after the session ends.');

  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: true, checks: checks.length, pageErrors }, null, 2));
} catch (error) {
  const document = await page.evaluate(() => ({
    body: document.body?.innerText.slice(0, 3500),
    viteError: document.querySelector('vite-error-overlay')?.shadowRoot?.innerText.slice(0, 1500),
    cameraStubLoaded: !!window.__cameraTest,
  })).catch(diagnosticError => ({ unavailable: diagnosticError.message }));
  console.error('Recovery browser check failed:', JSON.stringify({ pageErrors, checks, document }, null, 2));
  throw error;
} finally {
  await browser.close();
}
