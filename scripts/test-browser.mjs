import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chromium'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const base=process.env.TEST_URL||'http://localhost:5173/club.html?demo=1';
let checks=0;
const pass=name=>{console.log('PASS '+name);checks++;};
try {
  await page.goto(base);await page.getByRole('heading',{name:'Open Play.'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.court-card').count(),3);pass('demo loads three courts without setup');
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  await page.locator('[data-action="score"]').first().click();await page.locator('.score-call').waitFor();
  const before=await page.locator('.score-call>strong').textContent();await page.locator('[data-action="rally"][data-side="1"]').click();await expect(page.locator('.score-call>strong')).not.toHaveText(before);
  await page.locator('[data-action="undo"]').click();await expect(page.locator('.score-call>strong')).toHaveText(before);pass('rally controls and undo update exact score call');
  await page.screenshot({path:'test-results/scoring-desktop.png'});
  await page.locator('[data-action="close"]').click();await page.reload();await page.locator('[data-action="score"]').first().click();assert.equal(await page.locator('.score-call>strong').textContent(),before);pass('live score recovers after reload');await page.locator('[data-action="close"]').click();
  const second=await context.newPage();await second.goto(base);await second.locator('.court-card').first().waitFor();
  await page.locator('[data-action="call-next"]').first().click();await second.waitForFunction(()=>document.querySelectorAll('.court-card.called').length===2);pass('second tab receives court assignment');
  await page.locator('[data-action="settings"]').click();await page.locator('accent-picker [data-color="#9ad5f9"]').click();await page.locator('#settings-form [type="submit"]').click();
  await second.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#9ad5f9');await page.reload();assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#9ad5f9');pass('club accent persists and synchronizes');
  await page.locator('[data-action="settings"]').click();await page.locator('accent-picker [data-color="#d5f36b"]').click();await page.locator('#settings-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();
  await page.locator('[data-action="add-player"]').first().click();await page.getByLabel('Display name',{exact:true}).fill('Browser Test Player');await page.locator('#add-player-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();pass('player registration and check-in form saves');
  for(const [route,heading] of [['tournament/matches','Match center'],['tournament/bracket','Dill Next Weekend Cup'],['tournament/standings','Pool A'],['tournament/entries','Entrants'],['mixer/roster','A new partner every round.'],['mixer/standings','Individual standings'],['challenge/queue','Challenger queue'],['open/history','Open Play history']]) {
    await page.goto(`${base}#${route}`);await page.getByRole('heading',{name:heading,exact:false}).first().waitFor();
  }pass('all four modes and tournament sections render');
  await page.goto(`${base}#tournament/entries`);await page.locator('[data-action="new-event"]').click();
  const day=page.locator('date-range [data-day]').nth(10);await day.click();await day.focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.evaluate(()=>document.activeElement.dataset.day),await day.getAttribute('data-day'));
  await page.keyboard.press('PageDown');await page.keyboard.press('Enter');assert(await page.locator('date-range [name="end"]').inputValue());pass('calendar keyboard day and month navigation');
  const options=page.locator('.picker').first();await options.locator('.picker-trigger').click();await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await options.locator('input').inputValue(),'playoffs');pass('custom dropdown supports keyboard selection');
  await page.locator('[data-action="close"]').click();
  for(const [width,height] of [[320,740],[375,812],[390,844],[844,390],[768,1024],[1280,800],[1920,1080]]) {
    await page.setViewportSize({width,height});await page.goto(`${base}#open/courts`);await page.locator('.court-card').first().waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow,`horizontal overflow at ${width}x${height}`);
    await page.screenshot({path:`test-results/layout-${width}x${height}.png`,fullPage:true});
    if(width===375){await page.locator('[data-action="score"]').first().click();await page.screenshot({path:'test-results/scoring-mobile.png'});assert(await page.locator('.rally-btn').first().isVisible());await page.locator('[data-action="close"]').click();}
    if(width===844){await page.locator('[data-action="score"]').first().click();const bounds=await page.locator('.rally-buttons').boundingBox();assert(bounds.y+bounds.height<=height,'landscape rally buttons below fold');await page.screenshot({path:'test-results/scoring-landscape.png'});await page.locator('[data-action="close"]').click();}
  }pass('320px through desktop and phone landscape layouts have no page overflow');
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`${base}#tournament/bracket`);assert.equal(await page.locator('.bracket-round:visible').count(),1);await page.screenshot({path:'test-results/bracket-mobile.png'});pass('mobile bracket shows one round and supports reduced motion');
  await page.goto(`${base}#open/courts`);await page.evaluate(()=>document.documentElement.style.fontSize='24px');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('150% text sizing stays within phone viewport');
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.locator('[data-action="settings"]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').evaluate(d=>d.open),false);pass('sheets dismiss with Escape');
  await page.goto(`${base}#display/courts`);assert.equal(await page.locator('.court-card button').count(),0);pass('court display has no court mutation controls');
  assert.deepEqual(errors,[]);pass('no browser console or runtime errors');
  await writeFile('test-results/browser-summary.json',JSON.stringify({checks,errors,date:new Date().toISOString()},null,2));
  console.log(`${checks} browser checks passed.`);
} catch(error) {await page.screenshot({path:'test-results/failure.png',fullPage:true});console.error(error.message);process.exitCode=1;} finally {await browser.close();}
