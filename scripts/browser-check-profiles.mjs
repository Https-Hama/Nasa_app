import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { journalDay } from '../src/health-journal.js';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const chrome = process.env.CHROME_PATH
  ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let page;
const errors = [];
const diagnostics = { consoleErrors: [], failedRequests: [], httpErrors: [], documentStatus: null };
function observe(target) {
  target.on('pageerror', error => errors.push(error.stack || error.message));
  target.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
  target.on('requestfailed', request => diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  target.on('response', response => {
    if (response.request().isNavigationRequest()) diagnostics.documentStatus = response.status();
    if (response.status() >= 400) diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
  });
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  observe(page);
  await page.goto(url);

  const menu = () => page.locator('#player-menu');
  const onboarding = () => page.locator('#player-dialog');
  const health = () => page.getByRole('button', { name: 'Mission health', exact: true });
  const sleep = () => page.locator('[name=sleep]');
  const report = () => page.getByRole('button', { name: 'Open mission report' });
  const continueAs = async name => {
    await expect(page.locator('#player-onboarding-continue')).toHaveText(`Continue as ${name}`);
    await page.locator('#player-onboarding-continue').click();
    await expect(onboarding()).not.toBeVisible();
    await expect(menu()).toHaveText(name);
  };
  const managerReload = async action => {
    await Promise.all([page.waitForEvent('load'), action()]);
  };

  // A first visit cannot bypass naming with Escape or a synthetic Launch click.
  await expect(onboarding()).toBeVisible();
  await expect(page.locator('#player-title')).toHaveText('Who is playing?');
  await page.keyboard.press('Escape');
  await expect(onboarding()).toBeVisible();
  await page.evaluate(() => document.querySelector('#launch').click());
  await expect(page.locator('#live-hud')).not.toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('human-exe-player-profiles-v1')), null);

  // Existing data predating named profiles stays with the first named player.
  await page.evaluate(({ day, timestamp }) => {
    localStorage.setItem('human-exe-checkins-v1', JSON.stringify({
      [day]: { day, sleep: 7.5, diagnosis: 'Existing test note' },
    }));
    localStorage.setItem('human-exe-observations-v2', JSON.stringify([{
      id: 'existing-report', timestamp, source: 'measured', protocol: 'orbital-observation-v2',
      inputMode: 'keyboard', durationSec: 120,
    }]));
    localStorage.setItem('human-exe-preferences-v2', JSON.stringify({ sound: false, saveReports: true }));
  }, { day: journalDay(), timestamp: Date.now() });
  await page.reload();
  await page.locator('#player-onboarding-name').fill('   ');
  await page.locator('#player-onboarding-submit').click();
  await expect(page.locator('#player-onboarding-feedback')).toContainText('Enter a player name');
  await expect(onboarding()).toBeVisible();
  await page.locator('#player-onboarding-name').fill('First Player');
  await page.locator('#player-onboarding-submit').click();
  await expect(onboarding()).not.toBeVisible();
  await expect(menu()).toHaveText('First Player');
  await expect(page.locator('#sound-toggle')).not.toHaveClass(/sound-enabled/);
  await health().click();
  await expect(sleep()).toHaveValue('7.5');
  await expect(report()).toBeVisible();
  await menu().click();
  await page.getByLabel('Current player', { exact: true }).fill('Player One');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Player name saved.' })).toBeVisible();
  await page.getByLabel('New player name').fill('Player Two');
  await managerReload(() => page.getByRole('button', { name: 'Add player', exact: true }).click());
  // Manager changes reload the app and require confirming the newly active name.
  await continueAs('Player Two');
  await expect(page.locator('#sound-toggle')).toHaveClass(/sound-enabled/);

  await health().click();
  await expect(sleep()).toBeEmpty();
  await expect(page.locator('[name=diagnosis]')).toBeEmpty();
  await expect(report()).toHaveCount(0);
  await sleep().fill('5.5');
  await page.locator('[name=diagnosis]').fill('Second player note');
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByText('Check-in saved on this device.')).toBeVisible();

  await page.close();
  page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 640 });
  observe(page);
  await page.goto(url);
  await expect(page.locator('#player-title')).toHaveText('Welcome back, Player Two');
  await page.keyboard.press('Escape');
  await expect(onboarding()).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile onboarding fits the viewport');
  // A duplicate name cannot silently replace another player's data.
  await page.locator('#player-onboarding-name').fill(' player one ');
  await page.locator('#player-onboarding-submit').click();
  await expect(page.locator('#player-onboarding-feedback')).toContainText('already used');
  await continueAs('Player Two');
  await expect(menu()).toHaveText('Player Two');
  await health().click();
  await expect(sleep()).toHaveValue('5.5');
  await menu().click();
  await page.getByLabel('Switch to a saved player').selectOption({ label: 'Player One' });
  await managerReload(() => page.getByRole('button', { name: 'Switch player', exact: true }).click());
  await continueAs('Player One');
  await expect(page.locator('#sound-toggle')).not.toHaveClass(/sound-enabled/);
  await health().click();
  await expect(sleep()).toHaveValue('7.5');
  await expect(page.locator('[name=diagnosis]')).toHaveValue('Existing test note');
  await expect(report()).toBeVisible();

  // If the remembered ID is missing, choose a saved name rather than overwriting it.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('human-exe-player-profiles-v1'));
    state.activeId = 'unknown-player';
    localStorage.setItem('human-exe-player-profiles-v1', JSON.stringify(state));
    sessionStorage.removeItem('human-exe-confirmed-player-v1');
  });
  await page.reload();
  await expect(page.locator('#player-title')).toHaveText('Who is playing?');
  await expect(page.locator('#player-onboarding-continue')).toHaveCount(0);
  await page.locator('#player-onboarding-id').selectOption({ label: 'Player Two' });
  await managerReload(() => page.getByRole('button', { name: 'Use this player', exact: true }).click());
  await expect(onboarding()).not.toBeVisible();
  await expect(menu()).toHaveText('Player Two');
  await health().click();
  await expect(sleep()).toHaveValue('5.5');
  await expect(page.locator('[name=diagnosis]')).toHaveValue('Second player note');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('human-exe-player-profiles-v1')).profiles.length), 2);
  assert.deepEqual(errors, []);
  console.log('Mandatory first names, returning-player confirmation, unknown-player selection, mobile layout, profile isolation and legacy data persistence passed.');
} catch (error) {
  const document = await page?.evaluate(() => ({
    title: document.title,
    readyState: document.readyState,
    body: document.body?.innerText.slice(0, 2500),
    appHTML: document.querySelector('#app')?.innerHTML.slice(0, 1200),
    viteError: document.querySelector('vite-error-overlay')?.shadowRoot?.innerText.slice(0, 2500),
  })).catch(diagnosticError => ({ unavailable: diagnosticError.message }));
  console.error('Profile browser check failed:', JSON.stringify({ url: page?.url(), pageErrors: errors, ...diagnostics, document }, null, 2));
  throw error;
} finally {
  await browser.close();
}
