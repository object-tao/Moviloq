import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import process from "node:process";
import {chromium} from "playwright-core";

const origin=new URL(process.argv[2]??"http://127.0.0.1:5173").origin;
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Settings UI fixtures are local only.');
const destination=resolve(process.argv[3]??'../qa/settings-public');await mkdir(destination,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE??(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/google-chrome')});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const settings=await(await context.request.get(origin+'/api/settings')).json();
  Object.assign(settings.site,{name:'Moviloq QA',email:'qa@example.test',phone:'+49 123456',defaultLanguage:'zh',introductionZh:'后台发布的站点介绍'});
  Object.assign(settings.parameters,{maxDropoffs:2,minScheduleMinutes:120,maxScheduleDays:2,maxDistanceKm:50});
  const de=settings.countries.find(country=>country.code==='DE');de.disabledCities=['Berlin'];de.cities.push(['Synthetic City','测试城市','Custom City']);
  settings.countries.find(country=>country.code==='PL').enabled=false;
  await context.route('**/api/settings',route=>route.fulfill({json:settings}));
  const catalog=await(await context.request.get(origin+'/api/vehicles')).json();Object.assign(catalog.vehicles.find(vehicle=>vehicle.id==='transporter'),{nameZh:'测试厢式车',nameEn:'Test van',descriptionZh:'已发布车型说明',sortOrder:0});catalog.vehicles=catalog.vehicles.filter(vehicle=>vehicle.id!=='car');
  await context.route('**/api/vehicles',route=>route.fulfill({json:catalog}));
  await page.goto(origin+'/book');await page.getByRole('button',{name:'计算估价',exact:true}).waitFor();await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
  assert.equal(await page.locator('.logo__word').first().innerText(),'Moviloq QA');assert(await page.getByText('后台发布的站点介绍',{exact:true}).isVisible());assert.equal(await page.locator('a[href="mailto:qa@example.test"]').count(),1);
  assert.equal(await page.locator('#dropoff-0-country option[value="PL"]').count(),0);assert.equal(await page.locator('#pickup-city option[value="Berlin"]').count(),0);assert.equal(await page.locator('.vehicle-options input[value="car"]').count(),0);
  await page.locator('#pickup-city').selectOption('Synthetic City');await page.locator('#dropoff-0-city').selectOption('Frankfurt am Main');assert(await page.getByText('测试厢式车',{exact:true}).isVisible());assert.equal(await page.locator('.vehicle-option').first().locator('input').inputValue(),'transporter');
  await page.locator('.add-stop').click();assert(await page.locator('.add-stop').isDisabled());assert.equal(await page.locator('input[type="number"][step="0.1"]').first().getAttribute('max'),'50');
  for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844],['narrow',320,720]]){await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve))));await page.screenshot({path:join(destination,`settings-booking-${name}.png`),fullPage:true});const overflow=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll("*")].filter(el=>el.getBoundingClientRect().right>window.innerWidth).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,20)}));assert(overflow.scroll<=overflow.width,JSON.stringify(overflow));}
  await page.getByRole('button',{name:'EN',exact:true}).click();await page.reload();await page.locator('.vehicle-option').first().waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#pickup-city option[value="Synthetic City"]').innerText(),'Custom City');assert(await page.getByText('Test van',{exact:true}).isVisible());
  settings.site.name='Long configurable brand '.repeat(2);settings.site.email='long-configurable-support-email-address@example.test';settings.site.logoUrl='/missing-test-logo.png';await page.reload();await page.locator('.logo__mark').first().waitFor();
  for(const width of [1440,1024,860,390,320]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve))));const issue=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll("*")].filter(el=>el.getBoundingClientRect().right>window.innerWidth).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})).slice(0,16)}));await page.screenshot({path:join(destination,`long-brand-${width}.png`),fullPage:true});assert(issue.scroll<=issue.width,JSON.stringify(issue));}
  await context.unroute('**/api/settings');await context.route('**/api/settings',route=>route.fulfill({status:503,json:{error:'UNAVAILABLE'}}));await page.reload();await page.getByText('Settings could not load. Please refresh.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Calculate estimate',exact:true}).isDisabled());
  assert.deepEqual(errors,[]);await context.close();console.log('Verified local frontend fixture: published branding/default language, explicit-language preference, location and vehicle catalogues, sorting, disabled options, booking limits, responsive layout and fail-closed settings load. No database writes.');
} finally {await browser.close();}
