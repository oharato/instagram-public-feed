import { chromium } from 'playwright-core';
import { postId, recover } from './core.ts';
import { mkdir, writeFile, open, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseConfig, runAccounts, aggregate } from './runner.ts';
import { httpAccount } from './http.ts';
const args=process.argv.slice(2);
function option(key:string,fallback:string) { const i=args.indexOf(key); if(i>=0&&!args[i+1]) throw new Error(`Missing ${key} value`); return i<0?fallback:args[i+1]; }
const config=parseConfig(JSON.parse(await readFile(option('--config','config.example.json'),'utf8')));
const mode=option('--mode','http');
if(!['http','browser'].includes(mode)) throw new Error('--mode must be http or browser');
const supplied=option('--url','');
const limit=Number(option('--limit','3'));
if(!Number.isInteger(limit)||limit<1||limit>3) throw new Error('--limit must be 1..3');
const root=resolve(option('--out','data'));
const executablePath=option('--browser',process.env.CHROMIUM_PATH||'');
await mkdir(root,{recursive:true});
const lock=await open(join(root,'.lock'),'wx').catch(()=>{throw new Error('Output is locked; inspect any previous process before removing .lock');});
let browser:any;
const report:any={startedAt:new Date().toISOString(),limit,status:'failed',accounts:[]};
try {
  if(mode==='browser') browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:!args.includes('--headed'),chromiumSandbox:true});
  report.mode=mode;
  if(supplied&&config.accounts.length!==1) throw new Error('--url requires a single configured account; use postUrls for multiple accounts');
  report.accounts=await runAccounts(config.accounts,async(account,r)=>{
    await recover(join(root,account));
    if(mode==='browser') { const {scrape}=await import('./scrape.ts'); await scrape(browser,account,join(root,account),limit,r); }
    else {const urls=supplied?[supplied]:config.postUrls[account]??[];for(const url of urls) if(!postId(url,account)||!url.startsWith('https://www.instagram.com/')) throw new Error('Invalid known post URL'); await httpAccount(account,join(root,account),limit,r,urls);}
  });
  report.status=report.accounts.every((r:any)=>r.status==='complete')?'complete':'failed';
  if(report.status!=='complete') process.exitCode=1;
} catch(e) {
  report.error=String(e); report.accounts=config.accounts.map(account=>({account,status:'not_started',reason:'Setup failed'}));
  process.exitCode=1; console.error(report.error);
} finally {
  try { await browser?.close(); await aggregate(root,config.accounts); }
  catch(e) {report.finalizationError=String(e);report.status='failed';process.exitCode=1;}
  await lock.close(); await rm(join(root,'.lock'),{force:true});
  report.finishedAt=new Date().toISOString(); await writeFile(join(root,'last-run.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
