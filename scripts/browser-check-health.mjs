import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { journalDay } from '../src/health-journal.js';

const childEnv = {...process.env};
delete childEnv.GEMINI_API_KEY;
const server = spawn(process.execPath,['scripts/launch.mjs','--no-open'],{env:childEnv,stdio:['ignore','pipe','inherit']});
let browser;
try {
  const url = await new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>reject(new Error('Launcher did not start')),10000);
    server.once('error',reject);
    server.once('exit',code=>reject(new Error(`Launcher exited with ${code}`)));
    server.stdout.on('data',chunk=>{
      const found = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if(found) { clearTimeout(timeout); resolve(found[0]); }
    });
  });
  const chrome = process.env.CHROME_PATH || (process.platform==='win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  browser = await chromium.launch({executablePath:chrome,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__cueStarts=0;
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function (...args){window.__cueStarts++;return start.apply(this,args);};
  });
  await page.goto(url);
  const dashboard = page.getByRole('button',{name:'Mission health',exact:true});
  await page.getByRole('button',{name:'Daily check-in',exact:true}).click();
  const today = Date.parse(journalDay()+'T12:00:00Z');
  for(let i=4;i>=0;i--){
    await page.locator('#health-day').fill(journalDay(today-i*86400000));
    await page.locator('[name=sleep]').fill(i<2?'5':'7.5');
    await page.getByRole('button',{name:'Save check-in',exact:true}).click();
  }
  await page.getByText('Sleep below your baseline',{exact:true}).waitFor();
  await page.locator('[name=pulse]').fill('71');
  await page.locator('#health-metric').selectOption('pulse');
  assert.equal(await page.locator('[name=pulse]').inputValue(),'71');
  await page.locator('[name=temperature]').fill('36.7');
  await page.locator('[name=mood]').selectOption('4');
  await page.locator('[name=systolic]').fill('171');
  await page.locator('[name=diastolic]').fill('121');
  await page.locator('[name=diagnosis]').fill('Synthetic clinician note');
  await page.getByRole('button',{name:'Save diagnosis note'}).click();
  await page.getByRole('heading',{name:'Very high blood pressure reading'}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Use Gemini suggestions'}).isDisabled());
  await page.reload();
  await dashboard.click();
  assert.equal(await page.locator('[name=diagnosis]').inputValue(),'Synthetic clinician note');
  assert.equal(await page.locator('[name=temperature]').inputValue(),'36.7');
  assert.equal(await page.locator('[name=mood]').inputValue(),'4');
  await page.locator('[name=systolic]').fill('122');
  await page.locator('[name=diastolic]').fill('78');
  await page.getByRole('button',{name:'Save check-in',exact:true}).click();
  await page.getByRole('button',{name:'Use Gemini suggestions'}).click();
  await page.getByText('Gemini is not configured. Local suggestions are still available.').waitFor();
  assert.ok(await page.locator('#health-review-list li').count() >= 2);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export health history'}).click();
  assert.equal((await downloaded).suggestedFilename(),'HUMAN-exe-health-history.json');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

  await page.getByRole('button',{name:'Flight deck',exact:true}).click();
  await page.getByRole('button',{name:'Launch defense'}).click();
  await page.waitForFunction(()=>window.__cueStarts>=3);
  await page.locator('#game-canvas').press('j');
  await page.locator('#pause-button').click();
  await page.getByRole('button',{name:'Finish flight & continue'}).click();
  await page.getByRole('button',{name:'Skip to report'}).click();
  await page.getByRole('heading',{name:'Your session, understood.'}).waitFor();
  await dashboard.click();
  await page.getByRole('button',{name:'Open mission report'}).waitFor();
  await page.reload();
  await dashboard.click();
  await page.getByRole('button',{name:'Open mission report'}).click();
  await page.getByRole('heading',{name:'Your session, understood.'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Production browser checks passed for check-ins, warning, Gemini fallback, export, mobile layout and mission report persistence.');
} finally {
  await browser?.close();
  if(server.exitCode===null && server.signalCode===null){
    const closed=once(server,'exit');
    server.kill();
    await closed;
  }
}
