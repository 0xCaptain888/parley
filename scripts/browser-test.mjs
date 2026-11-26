import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localFixture, exercise } from './integration.mjs';
import { atomicJson } from '../helper/src/state.mjs';
import { checkDemo } from './check-demo.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const req=createRequire(import.meta.url);
let chromium;
try{({chromium}=req('playwright'));}catch{
  ({chromium}=req('/Users/lyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const base=process.env.PARLEY_TEST_URL||'http://127.0.0.1:4207';
const out=path.join(root,'docs/reports/browser');fs.mkdirSync(out,{recursive:true});
const build=config=>execFileSync(process.execPath,[path.join(root,'helper/build.mjs'),...(config?['--config',config]:[])],{cwd:root,stdio:'pipe'});
let fixture,browser;
const findings=[];
try{
  fixture=await localFixture();const integration=await exercise(fixture);
  const local=path.join(out,'deployment.local.json');atomicJson(local,{...fixture.config,site:base});
  build(local);atomicJson(path.join(root,'web/site/stats.json'),integration.stats);
  browser=await chromium.launch({headless:true,channel:'chrome'});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const context=await browser.newContext({viewport,permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    for(const [pathname,heading]of [['/','Parley'],['/packets','公开红包'],['/p/18','Parley 红包 #18'],['/board','挂单墙'],['/stats','真实的往来'],['/docs','使用文档']]){
      await page.goto(`${base}${pathname}?demo=1`);
      await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();
      await page.locator('footer').waitFor();
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('input, form').count(),0,'Website must not have forms');
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      assert.equal(overflow,false,`Horizontal overflow at ${viewport.width} ${pathname}`);
      const clippedButtons=await page.locator('button').evaluateAll(nodes=>nodes.filter(b=>b.scrollWidth>b.clientWidth+2).map(b=>b.textContent));
      assert.deepEqual(clippedButtons,[],`Clipped buttons at ${pathname}`);
      const brokenImages=await page.locator('img').evaluateAll(nodes=>nodes.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));
      assert.deepEqual(brokenImages,[]);
      const copy=page.getByRole('button',{name:'复制领取口令',exact:true}).first();
      if(await copy.count()){
        await copy.click();
        assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/^领 Parley 红包 #\d+$/);
      }
      await page.screenshot({path:path.join(out,`${viewport.width}-${pathname.replaceAll('/','_')||'home'}.png`),fullPage:true});
      findings.push({width:viewport.width,path:pathname,mode:'explicit demo',overflow:false});
    }
    for(const [pathname,heading]of [['/','Parley'],['/packets','Public Gifts'],['/p/18','Parley Gift #18'],['/board','Offer Board'],['/stats','Meaningful Activity'],['/docs','Documentation']]){
      await page.goto(`${base}${pathname}?demo=1&lang=en`);
      await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();
      await page.locator('footer').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'),'en');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const untranslated=await page.evaluate(()=>{
        const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),out=[];
        for(let n=walk.nextNode();n;n=walk.nextNode()){
          if(n.parentElement.closest('[data-untrusted],#language,script,style'))continue;
          if(/[\u3400-\u9fff]/.test(n.textContent))out.push(n.textContent.trim());
        }return out;
      });
      assert.deepEqual(untranslated,[],`Untranslated trusted English UI at ${pathname}`);
      const copy=page.getByRole('button',{name:'Copy claim prompt',exact:true}).first();
      if(await copy.count()){
        await copy.click();
        assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/^Claim Parley #\d+$/);
      }
      await page.screenshot({path:path.join(out,`${viewport.width}-en-${pathname.replaceAll('/','_')}.png`),fullPage:true});
      findings.push({width:viewport.width,path:pathname,mode:'English explicit demo',overflow:false});
    }
    // Also read a real local deployment, not just the design fixtures.
    await page.goto(`${base}/stats`);
    await page.getByRole('heading',{name:'第二动作率',exact:true}).waitFor();
    assert.match(await page.locator('.stats-hero p').textContent(),/3/);
    await page.goto(`${base}/packets`);await page.getByRole('heading',{name:'公开红包',exact:true}).waitFor();
    await page.locator('.packet,.empty').first().waitFor();
    findings.push({width:viewport.width,path:'/stats + /packets',mode:'actual local chain 31337'});
    assert.deepEqual(errors,[]);
    await context.close();
  }
  build();
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  const page=await context.newPage();
  if(process.argv.includes('--record')){
    const frames=fs.mkdtempSync('/private/tmp/parley-video-');let frame=0;
    for(const [url,count]of [['/packets?demo=1',8],['/p/18?demo=1',7],['/board?demo=1',7],['/stats?demo=1',8]]){
      await page.goto(base+url);
      await page.locator('#app h1').first().waitFor();
      for(let i=0;i<count;i++){
        await page.screenshot({path:path.join(frames,`${String(frame++).padStart(3,'0')}.jpg`),type:'jpeg',quality:88});
        await page.waitForTimeout(100);
      }
    }
    await context.close();
    execFileSync('/Users/lyh/Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac',
      ['-y','-f','image2pipe','-c:v','mjpeg','-r','1','-i','pipe:0','-c:v','libvpx-vp9','-r','30',
        '-b:v','700k',path.join(root,'web/site/demo.webm')],{
          input:Buffer.concat(fs.readdirSync(frames).sort().map(f=>fs.readFileSync(path.join(frames,f)))),
          stdio:['pipe','pipe','pipe'],
        });
  }else await context.close();
  const plain=await browser.newPage();
  for(const url of ['/','/stats','/docs']){
    await plain.goto(base+url);await plain.locator('#app h1').first().waitFor();
    assert.match(await plain.locator('#notice').textContent(),/尚未配置主网合约/);
  }
  if(fs.existsSync(path.join(root,'web/site/demo.webm'))) await checkDemo(browser,base);
  atomicJson(path.join(out,'report.json'),{at:new Date().toISOString(),findings,noRuntimeErrors:true,realWalletUsed:false});
  console.log(`Browser acceptance passed: ${findings.length} desktop/mobile/demo/local-chain checks. Screenshots in docs/reports/browser.`);
}finally{
  if(browser)await browser.close();
  if(fixture)await fixture.stop();
  build();
}
