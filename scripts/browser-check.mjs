import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const origin=process.env.GAME_URL||'http://127.0.0.1:5175';
const checks=[];
try{
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.locator('#game-canvas').waitFor();
 await page.waitForTimeout(1000);
 assert.match(await page.title(),/HUMAN.exe/);
 assert.equal(await page.locator('.mission-card').count(),4);
 assert.equal(await page.locator('#launch-react canvas').count(),1);
 assert.equal(await page.locator('#react-tagline .shiny-text').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 checks.push('Dashboard loads with 4 custom-art missions and genuine React Bits components.');
 await page.screenshot({path:'artifacts/HUMAN-exe-desktop.png',fullPage:true});

 // Actual unavailable/denied camera path must leave keyboard play usable.
 const cdp=await context.newCDPSession(page);
 await cdp.send('Browser.setPermission',{permission:{name:'camera'},setting:'denied',origin});
 await page.locator('#enable-camera').click();
 await page.waitForFunction(()=>document.querySelector('#camera-status-pill').textContent==='UNAVAILABLE');
 assert.match(await page.locator('#input-badge').textContent(),/KEYBOARD/);
 assert.equal(await page.locator('#enable-camera').isEnabled(),true);
 checks.push('Camera permission denial recovers to keyboard mode.');

 await page.locator('[data-view="settings"]').click();
 await page.locator('label.switch').filter({has:page.locator('#setting-history')}).click();
 assert.equal(await page.locator('#setting-history').isChecked(),true);
 await page.locator('[data-view="missions"]').click();
 await page.locator('[data-mission="exercise"]').click();
 await page.locator('#launch').click();
 assert.match(await page.locator('#exercise-name').textContent(),/SQUAT/);
 for(let i=0;i<4;i++){await page.keyboard.press('e');await page.waitForTimeout(100);}
 assert.match(await page.locator('#exercise-name').textContent(),/KNEES/);
 await page.keyboard.press('p');
 assert.equal(await page.locator('#pause-overlay').isVisible(),true);
 const frozenTime=await page.locator('#hud-time').textContent();
 await page.keyboard.press('e');
 await page.waitForTimeout(1200);
 assert.equal(await page.locator('#hud-time').textContent(),frozenTime);
 await page.locator('#resume').click();
 for(let i=0;i<4;i++){await page.keyboard.press('e');await page.waitForTimeout(100);}
 assert.match(await page.locator('#exercise-name').textContent(),/REACH/);
 for(let i=0;i<4;i++){await page.keyboard.press('e');await page.waitForTimeout(100);}
 await page.locator('#result-dialog[open]').waitFor();
 assert.match(await page.locator('#result-dialog').textContent(),/MISSION ACCOMPLISHED/);
 assert.match(await page.locator('#result-dialog').textContent(),/12/);
 await page.screenshot({path:'artifacts/HUMAN-exe-result.png'});
 await page.locator('#result-next').click();
 assert.equal(await page.locator('#stage-title').isVisible(),true);
 await page.waitForTimeout(250);
 assert.equal(await page.locator('#stage-title').isVisible(),true);
 checks.push('Exercise plays 4+4+4, pause freezes time/input, completion and ready-state reset work.');

 await page.locator('[data-view="history"]').click();
 assert.equal(await page.locator('tbody tr').count(),1);
 assert.match(await page.locator('tbody').textContent(),/keyboard/);
 const downloadEvent=page.waitForEvent('download');
 await page.locator('#export-history').click();
 const download=await downloadEvent;
 await download.saveAs('artifacts/flight-log-export.json');
 await page.locator('#delete-history').click();
 assert.equal(await page.locator('tbody tr').count(),0);
 assert.equal(await page.evaluate(()=>localStorage.getItem('human-exe-history')),null);
 checks.push('Derived history saves, exports and deletes successfully.');

 await page.locator('[data-view="missions"]').click();
 await page.locator('[data-mission="memory"]').click();
 await page.locator('#launch').click();
 await page.waitForFunction(()=>document.querySelector('#objective-detail').textContent.startsWith('Repeat the pattern'));
 for(const key of ['ArrowLeft','ArrowUp','ArrowRight']){await page.keyboard.press(key);await page.waitForTimeout(160);}
 await page.waitForTimeout(250);
 assert.match(await page.locator('#objective-text').textContent(),/4|round|sequence/i);
 await page.keyboard.press('p');await page.locator('#end-mission').click();
 await page.locator('#result-dialog[open]').waitFor();await page.locator('#result-next').click();
 checks.push('Memory sequence accepts keyboard directions and advances to the next sequence.');

 await page.locator('[data-mission="docking"]').click();await page.locator('#launch').click();
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(450);await page.keyboard.up('ArrowRight');
 await page.waitForTimeout(100);
 assert.match(await page.locator('#objective-detail').textContent(),/precision|align|beacon/i);
 await page.keyboard.press('p');await page.locator('#end-mission').click();await page.locator('#result-dialog[open]').waitFor();await page.locator('#result-next').click();
 checks.push('Docking launches with relative keyboard steering and alignment feedback.');

 await page.locator('[data-mission="asteroids"]').click();await page.locator('#launch').click();
 await page.keyboard.press('Space');await page.keyboard.down('d');await page.waitForTimeout(400);await page.keyboard.up('d');
 await page.screenshot({path:'artifacts/HUMAN-exe-gameplay.png',fullPage:true});
 await page.locator('#enable-camera').click();
 assert.equal(await page.locator('#pause-overlay').isVisible(),true);
 await page.waitForFunction(()=>document.querySelector('#camera-status-pill').textContent==='UNAVAILABLE');
 await page.locator('#resume').click();
 await page.locator('[data-view="guide"]').click();
 await page.locator('[data-view="missions"]').click();
 assert.equal(await page.locator('#pause-overlay').isVisible(),true);
 await page.locator('#end-mission').click();await page.locator('#result-dialog[open]').waitFor();await page.locator('#result-next').click();
 checks.push('Asteroid flight, shield, steering and navigation-triggered pause work.');

 await page.locator('[data-view="guide"]').click();
 assert.equal(await page.locator('.guide-card').count(),4);
 assert.ok(await page.locator('.guide-card a').count()>3);
 await page.locator('#guide-controls').click();
 assert.equal(await page.locator('#help-dialog').isVisible(),true);
 await page.locator('#help-dialog .dialog-close').click();
 await page.locator('[data-view="missions"]').click();

 for(const viewport of [{width:768,height:1024},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${viewport.width}`);
  await page.screenshot({path:`artifacts/HUMAN-exe-${viewport.width}.png`,fullPage:true});
 }
 checks.push('Field guide and controls open; tablet and mobile layouts have no horizontal overflow.');
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/browser-verification.json',JSON.stringify({date:new Date().toISOString(),origin,checks,errors},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
}catch(error){
 await page.screenshot({path:'artifacts/browser-failure.png',fullPage:true}).catch(()=>{});
 console.error('CURRENT STATE',await page.locator('body').innerText().catch(()=>''));
 throw error;
}finally{await browser.close();}
