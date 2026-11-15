import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

const url=process.argv[2]||'http://127.0.0.1:5173/';
const executablePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().endsWith('/api/mission-review')){const raw=request.postData();assert.ok(!raw.includes('Report Review QA')&&!raw.includes('landmarks')&&!raw.includes('browser-review-qa'));requests.push(JSON.parse(raw));}});
const record={id:'browser-review-qa',timestamp:Date.now(),source:'measured',protocol:'orbital-observation-v2',inputMode:'keyboard',durationSec:120,conditions:{sessionStage:'complete',geminiReviewRequested:true},game:{score:410,hull:82,kills:6,shots:50,accuracy:60},cognitive:{memory:{protocol:'pattern-memory-3-4-5-random-v3',correct:12,attempts:13,rounds:3},attention:{protocol:'focus-go-no-go-random-v3',correct:7,attempts:8,falseAlarms:0,misses:1,medianReactionMs:420}}};
try{
 await page.goto(url,{waitUntil:'networkidle'});
 await page.locator('#player-onboarding-name').fill('Report Review QA');await page.locator('#player-onboarding-submit').click();
 await page.evaluate(record=>{localStorage.setItem('human-exe-observations-v2',JSON.stringify([record]));localStorage.setItem('human-exe-preferences-v2',JSON.stringify({sound:false,saveReports:true,autoGemini:true}));},record);
 await page.reload({waitUntil:'networkidle'});
 const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/mission-review'));
 await page.locator('[data-view="journal"]').click();
 const response=await responsePromise;const data=await response.json();assert.equal(response.status(),200,data.error);
 await expect(page.locator('.mission-review-ready')).toBeVisible({timeout:30000});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2')));
 assert.equal(saved[0].geminiReview.provider,'Gemini');assert.ok(saved[0].geminiReview.summary.length>20);assert.ok(saved[0].geminiReview.generatedAt>0);
 const exportPromise=page.waitForEvent('download');await page.locator('#export-report').click();const exported=await exportPromise;
 await exported.saveAs('artifacts/mission-review-export.json');
 assert.deepEqual(JSON.parse(await readFile('artifacts/mission-review-export.json','utf8')).record.geminiReview,saved[0].geminiReview,'Immediate export includes the asynchronously generated review');
 assert.equal(await page.locator('.report-chart-card').count(),4);
 assert.equal(await page.locator('.report-signal-gauge.is-missing').count(),3);
 assert.equal(await page.locator('.report-hand-chart.is-missing').count(),1);
 await page.locator('.report-chart-track').first().hover();await expect(page.locator('.report-chart-track').first().locator('.report-chart-tooltip')).toBeVisible();
 for(const card of await page.locator('.report-chart-card').all()){await card.scrollIntoViewIfNeeded();await page.waitForTimeout(80);}
 await page.mouse.move(0,0);await page.waitForTimeout(1300);
 await page.screenshot({path:'artifacts/mission-review-desktop.png',fullPage:true});
 const animated=await page.locator('.report-chart-fill').first().evaluate(element=>getComputedStyle(element).animationName);assert.notEqual(animated,'none');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.report-chart-fill').first().evaluate(element=>getComputedStyle(element).animationName),'none');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
 await page.screenshot({path:'artifacts/mission-review-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>({viewport:innerWidth,total:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className?.baseVal??e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+1||e.left< -1).slice(0,18)}));
 if(overflow.total>overflow.viewport)console.log(JSON.stringify({overflow}));
 assert.equal(overflow.total<=overflow.viewport,true);
 await page.reload({waitUntil:'networkidle'});await page.locator('[data-view="journal"]').click();
 await expect(page.locator('.mission-review-ready')).toBeVisible();assert.equal(requests.length,1,'Saved review is restored without a repeat request');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2'))),saved);
 console.log(JSON.stringify({passed:true,realGeminiStatus:response.status(),automaticRequests:requests.length,chartCards:4,reducedMotion:true,mobileOverflow:false,persisted:true,browserErrors:errors}));
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
