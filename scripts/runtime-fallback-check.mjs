import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera']});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4173',{waitUntil:'networkidle'});
 await page.locator('#launch').click();
 await page.locator('#enable-camera').click();
 await page.waitForFunction(()=>document.querySelector('#input-badge').textContent.includes('BODY CONTROL'),{},{timeout:60000});
 assert.equal(await page.locator('#pause-overlay').isVisible(),true);
 await page.waitForFunction(()=>['NO POSE','CONNECTED'].includes(document.querySelector('#camera-status-pill').textContent),{},{timeout:60000});
 const disconnected=await page.evaluate(()=>{
  const video=document.querySelector('#camera-video');
  const track=video.srcObject.getVideoTracks()[0];
  track.dispatchEvent(new Event('ended'));
  return {trackState:track.readyState,videoReleased:video.srcObject===null,openCvReady:!!window.cv?.Mat};
 });
 assert.equal(disconnected.trackState,'ended');
 assert.equal(disconnected.videoReleased,true);
 assert.equal(disconnected.openCvReady,true);
 assert.match(await page.locator('#input-badge').textContent(),/KEYBOARD/);
 assert.equal(await page.locator('#camera-status-pill').textContent(),'UNAVAILABLE');
 await page.locator('#resume').click();
 assert.equal(await page.locator('#pause-overlay').isVisible(),false);
 await page.keyboard.press('d');
 await page.keyboard.press('p');
 assert.equal(await page.locator('#pause-overlay').isVisible(),true);
 assert.deepEqual(errors,[]);
 const report=JSON.parse(await readFile('artifacts/production-camera-verification.json','utf8'));
 report.runtimeFailureFallback={checkedAt:new Date().toISOString(),passed:true,method:'Dispatch ended event on a live synthetic camera track through the real production event listener',...disconnected,automaticKeyboardFallback:true,resumeWithoutCamera:true,pageErrors:errors};
 await writeFile('artifacts/production-camera-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.runtimeFailureFallback,null,2));
}finally{await browser.close();}
