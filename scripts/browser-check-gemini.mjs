import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { QUESTIONS } from '../src/review-questions.js';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch({executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [];
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 960}});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.locator('#player-onboarding-name').fill('Gemini Check Player');
  await page.locator('#player-onboarding-submit').click();
  await expect(page.locator('#player-dialog')).not.toBeVisible();
  await page.locator('[data-view="health"]').click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/health-suggestions') && response.request().method() === 'POST');
  await page.locator('#health-ai').click();
  const response = await responsePromise;
  const payload = await response.json();
  assert.equal(response.status(), 200, payload.error || 'Gemini request must succeed.');
  assert.ok(payload.selections);
  await expect(page.locator('#health-ai-status')).toHaveText('Gemini prioritized the questions above.', {timeout: 25000});
  const suggestions = await page.locator('#health-review-list li').allTextContents();
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every(text => Object.values(QUESTIONS).includes(text)));
  await expect(page.locator('#health-ai')).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, apiStatus: response.status(), suggestionCount: suggestions.length, browserErrors: errors}));
} finally { await browser.close(); }
