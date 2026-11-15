import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const chrome = process.env.CHROME_PATH
  ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch({
  executablePath: chrome,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 641 }, permissions: ['camera'] });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#observation-consent').check();
  const start = page.getByRole('button', { name: 'Start 30-second face check' });
  const scan = page.getByRole('dialog', { name: 'Face check' });
  await start.click({ timeout: 60000 });
  await scan.waitFor();
  await page.waitForFunction(() => {
    const timer = document.getElementById('face-check-time');
    const video = document.getElementById('camera-video');
    return Number(timer.textContent) < 30 && video.videoWidth > 0 && !video.paused;
  });

  for (const viewport of [{ width: 1366, height: 641 }, { width: 390, height: 640 }, { width: 667, height: 340 }]) {
    await page.setViewportSize(viewport);
    for (const selector of ['#camera-video', '#pose-overlay', '#face-check-time', '#skip-check']) {
      const bounds = await scan.locator(selector).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
      `${selector} should be in view at ${viewport.width}×${viewport.height}`);
    }
    await assert.doesNotReject(() => scan.getByRole('button', { name: 'Finish check early' }).click({ trial: true }));
    assert.equal(await scan.locator('#camera-video').evaluate(video => getComputedStyle(video).objectFit), 'contain');
  }

  await scan.getByRole('button', { name: 'Finish check early' }).click();
  await scan.waitFor({ state: 'hidden' });
  assert.ok(await page.locator('#tracking-preview-home #camera-video').isVisible());
  assert.ok(await page.locator('#launch').isEnabled());

  await start.click();
  await scan.waitFor();
  await page.keyboard.press('Escape');
  await scan.waitFor({ state: 'hidden' });
  assert.ok(await start.isEnabled());
  assert.deepEqual(errors, []);
  console.log('Live synthetic video, countdown, and finish button stayed visible on desktop, mobile, and landscape. Early finish and Escape restored the camera panel.');
} finally {
  await browser.close();
}
