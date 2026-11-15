import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:4173/';
const chrome=process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true});
const page=await context.newPage();const errors=[];const checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pass=text=>{checks.push(text);console.log('PASS:',text);};
try{
 await page.goto(url,{waitUntil:'networkidle'});await page.locator('#launch').waitFor();
 await page.locator('#player-onboarding-name').fill('Flight Test Player');
 await page.locator('#player-onboarding-submit').click();
 await page.waitForFunction(()=>!document.querySelector('#player-dialog').open);
 assert.equal(await page.locator('#player-name').textContent(),'Flight Test Player');
 assert.equal(await page.locator('#save-reports').isChecked(),true);
 assert.equal(await page.locator('#save-reports').isDisabled(),true);
 assert.equal(await page.locator('[data-mission]').count(),0);assert.equal(await page.locator('#launch-react canvas').count(),1);
 assert.equal(await page.locator('#face-check').isDisabled(),true);assert.equal(await page.locator('#observation-consent').isChecked(),false);
 await page.screenshot({path:'artifacts/HUMAN-v2-flight.png',fullPage:true});pass('One game, React Bits and separate observation consent render.');
 await page.locator('#demo-preview').click();assert.equal(await page.locator('.demo-banner').isVisible(),true);assert.equal(await page.locator('.trend-svg').count(),2);
 assert.match(await page.locator('.comparison-status').textContent(),/Yesterday/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('human-exe-observations-v2')),null);
 await page.screenshot({path:'artifacts/HUMAN-v2-report.png',fullPage:true});
 const demoDownload=page.waitForEvent('download');await page.locator('#export-report').click();const demo=await demoDownload;await demo.saveAs('artifacts/demo-report-v2.json');
 const demoJSON=JSON.parse(await readFile('artifacts/demo-report-v2.json','utf8'));assert.equal(demoJSON.record.source,'demo');assert.match(demoJSON.kind,/FICTIONAL/);pass('Detailed demo compares yesterday/today, labels synthetic values and does not save them.');
 await page.locator('[data-view="flight"]').click();await page.locator('#launch').click();await page.keyboard.down('j');await page.waitForTimeout(2500);await page.keyboard.up('j');await page.keyboard.press('Shift');await page.keyboard.press('c');
 const beforeBlur=await page.locator('#hud-time').textContent();
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 assert.equal(await page.locator('#pause-overlay').isVisible(),false);
 await page.waitForFunction(previous=>document.querySelector('#hud-time').textContent!==previous,beforeBlur,{timeout:4000});
 assert.equal(await page.locator('#pause-overlay').isVisible(),false);
 pass('A window blur alone leaves the flight running.');
 await page.waitForFunction(()=>{
  const report=JSON.parse(localStorage.getItem('human-exe-observations-v2')||'[]')[0];
  return report?.conditions?.sessionStage==='flight'&&report.durationSec>0&&report.game.shots>0;
 },null,{timeout:10000});
 const inFlight=await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2')));
 assert.equal(inFlight.length,1);const reportId=inFlight[0].id;
 assert.equal(inFlight[0].cognitive.memory.rounds,0);
 assert.equal(inFlight[0].cognitive.attention.attempts,0);
 pass('Flight progress autosaves before the mind check, under one persistent report ID.');
 await page.screenshot({path:'artifacts/HUMAN-v2-combat.png',fullPage:true});await page.keyboard.press('p');const frozen=await page.locator('#hud-time').textContent();await page.waitForTimeout(900);assert.equal(await page.locator('#hud-time').textContent(),frozen);await page.locator('#resume').click();await page.keyboard.press('p');
 // Capture before ending flight so the first randomly selected cue cannot be missed.
 await page.evaluate(()=>{window.__patternEvents=[];window.__lastLit='';window.__capture=setInterval(()=>{const d=document.querySelector('[data-mind-direction].lit')?.dataset.mindDirection||'';if(d&&d!==window.__lastLit)window.__patternEvents.push(d);window.__lastLit=d;},25);});
 await page.locator('#end-flight').click();await page.locator('#mind-dialog[open]').waitFor();
 const beforeMindAnswers=await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2')));
 assert.equal(beforeMindAnswers.length,1);assert.equal(beforeMindAnswers[0].id,reportId);
 assert.equal(beforeMindAnswers[0].conditions.sessionStage,'mind');
 assert.equal(beforeMindAnswers[0].cognitive.memory.rounds,0);
 pass('The transition to mind check is saved before answering or finishing tasks.');
 let previousPattern=[];
 for(let round=0;round<3;round++){
  await page.waitForFunction(()=>document.querySelector('#mind-status').textContent.startsWith('YOUR TURN'),{},{timeout:15000});
  const events=await page.evaluate(()=>window.__patternEvents.splice(0));
  assert.equal(events.length,round+3,`Observed full visible pattern round${round+1}`);
  assert.deepEqual(events.slice(0,previousPattern.length),previousPattern);previousPattern=events;
  if(round===0)await page.screenshot({path:'artifacts/HUMAN-v2-mind.png'});
  for(const direction of events){await page.keyboard.press({left:'ArrowLeft',up:'ArrowUp',right:'ArrowRight',down:'ArrowDown'}[direction]);await page.waitForTimeout(90);}
 }
 await page.evaluate(()=>clearInterval(window.__capture));
 await page.waitForFunction(()=>document.querySelector('#mind-task-label').textContent.includes('FOCUS'));
 const memorySaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2')));
 assert.equal(memorySaved.length,1);assert.equal(memorySaved[0].id,reportId);assert.equal(memorySaved[0].cognitive.memory.rounds,3);
 const focusCues=[];
 for(let trial=0;trial<8;trial++){
  await page.waitForFunction(()=>['GO','WAIT'].includes(document.querySelector('#cue-word').textContent),{},{timeout:8000});
  const cue=await page.locator('#cue-word').textContent();focusCues.push(cue);if(cue==='GO'){await page.waitForTimeout(180);await page.keyboard.press('Space');}
  await page.waitForFunction(()=>!['GO','WAIT'].includes(document.querySelector('#cue-word')?.textContent||''),{},{timeout:4000});
 }
 assert.equal(focusCues.filter(cue=>cue==='GO').length,6);assert.equal(focusCues.filter(cue=>cue==='WAIT').length,2);
 await page.waitForSelector('#journal-view:not([hidden])',{timeout:7000});assert.equal(await page.locator('.demo-banner').count(),0);assert.match(await page.locator('.report-summary').textContent(),/Face check unavailable/);
 const real=await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2')));assert.equal(real.length,1);assert.equal(real[0].id,reportId);assert.equal(real[0].source,'measured');assert.equal(real[0].conditions.sessionStage,'complete');assert.equal(real[0].cognitive.memory.rounds,3);assert.equal(real[0].cognitive.memory.protocol,'pattern-memory-3-4-5-random-v3');assert.equal(real[0].cognitive.attention.attempts,8);assert.equal(real[0].cognitive.attention.protocol,'focus-go-no-go-random-v3');assert.ok(real[0].game.shots>0);assert.equal(real[0].observations.face.blinkRate,null);
 pass('Combat fires real shots; manual pause works; visible random memory patterns and eight balanced focus trials complete the same saved report.');
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.locator('#player-name').textContent(),'Flight Test Player');
 assert.equal(await page.locator('#player-dialog').isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('human-exe-observations-v2'))),real);
 await page.locator('[data-view="journal"]').click();
 assert.equal(await page.locator('#current-report').inputValue(),reportId);
 assert.match(await page.locator('.report-summary').textContent(),/Face check unavailable/);
 pass('Reload restores the named player and completed report without duplicating or losing saved data.');
 const realDownload=page.waitForEvent('download');await page.locator('#export-report').click();const realFile=await realDownload;await realFile.saveAs('artifacts/measured-report-v2.json');
 const json=JSON.parse(await readFile('artifacts/measured-report-v2.json','utf8'));assert.equal('landmarks' in json.record,false);assert.equal('video' in json.record,false);
 await page.locator('#delete-reports').click();assert.equal(await page.evaluate(()=>localStorage.getItem('human-exe-observations-v2')),null);pass('Measured export contains derived values; deletion removes measured reports.');
 await page.locator('[data-view="guide"]').click();assert.equal(await page.locator('.guide-card').count(),4);await page.locator('[data-view="flight"]').click();
 for(const viewport of [{width:768,height:1024},{width:390,height:844}]){await page.setViewportSize(viewport);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No overflow at${viewport.width}`);await page.screenshot({path:`artifacts/HUMAN-v2-${viewport.width}.png`,fullPage:true});}
 await page.locator('#demo-preview').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Phone report has no overflow');await page.screenshot({path:'artifacts/HUMAN-v2-report-mobile.png',fullPage:true});
 pass('Guide, tablet, phone and detailed mobile report layouts work without horizontal overflow.');
 assert.deepEqual(errors,[]);await writeFile('artifacts/browser-verification-v2.json',JSON.stringify({checkedAt:new Date().toISOString(),production:url,checks,errors,passed:true},null,2));console.log(JSON.stringify({checks:checks.length,errors},null,2));
}catch(e){await page.screenshot({path:'artifacts/v2-browser-failure.png',fullPage:true}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));throw e;}finally{await browser.close();}
