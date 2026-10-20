import { readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicFile, recover } from './core.ts';
export function parseConfig(value:unknown):{accounts:string[];postUrls:Record<string,string[]>} {
  const accounts=(value as any)?.accounts;
  if(!Array.isArray(accounts)||!accounts.length||accounts.some(a=>typeof a!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$/.test(a)||a.includes('..'))) throw new Error('accounts must be a nonempty array of valid account names');
  const normalized=[...new Set<string>(accounts.map(a=>a.toLowerCase()))];
  const postUrls=(value as any).postUrls??{};
  if(!postUrls||typeof postUrls!=='object'||Array.isArray(postUrls)||Object.entries(postUrls).some(([a,u])=>!normalized.includes(a)||!Array.isArray(u)||u.some(x=>typeof x!=='string'))) throw new Error('postUrls must map configured accounts to URL arrays');
  return {accounts:normalized,postUrls};
}
export async function runAccounts(accounts:string[], run:(account:string,report:any)=>Promise<void>) {
  const reports:any[]=[];
  for(const account of accounts) {
    const report:any={account,status:'failed',saved:[],skipped:[]};reports.push(report);
    try {await run(account,report);report.status='complete';}
    catch(e) {
      report.error=String(e);
      report.failureKind=/HTTP_DISCOVERY_UNAVAILABLE|HTTP_ORDER_UNVERIFIED/.test(String(e))?'discovery_unavailable':/DOM_UNSUPPORTED|Ambiguous|caption|timestamp|article/i.test(String(e))?'dom_or_metadata_unsupported':/HTTP (401|403|429)|restriction|CAPTCHA|Login\/challenge|login wall/i.test(String(e))?'access_restriction':'fetch_or_storage_error';
      // Stop all access on a restriction, including all remaining accounts.
      if(/HTTP (401|403|429)|restriction|CAPTCHA|Login\/challenge|login wall/i.test(String(e))) {
        for(const rest of accounts.slice(reports.length)) reports.push({account:rest,status:'not_started',reason:'Stopped after access restriction'});
        break;
      }
    }
  }
  return reports;
}
export async function aggregate(root:string,accounts:string[]) {
  const posts=[];
  for(const account of accounts) {
    const dir=join(root,account);
    await recover(dir);
    const entries=await readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT') return [];throw e;});
    for(const entry of entries) {
      if(!entry.isDirectory()||!entry.name.match(/^[A-Za-z0-9_-]+$/)) continue;
      const p=JSON.parse(await readFile(join(dir,entry.name,'post.json'),'utf8'));
      if(p.account!==account||p.shortcode!==entry.name) throw new Error('Stored post identity mismatch');
      posts.push({...p,path:`${account}/${entry.name}/post.json`});
    }
  }
  posts.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  const tmp=join(root,'posts.json.next'); await rm(tmp,{force:true});
  await atomicFile(tmp,JSON.stringify({accounts,posts},null,2)+'\n');await rename(tmp,join(root,'posts.json'));
}
