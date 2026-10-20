import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {postId,latest,commit,saved,recover,selectTimestamp} from '../src/core.ts';
import {parseConfig,runAccounts,aggregate} from '../src/runner.ts';
import {parsePublicHtml,parseDescription} from '../src/http.ts';
const jpeg=Buffer.from([255,216,255,224,1,2,3]);
const post=(account='fixture.one',shortcode='Synthetic1',carouselComplete=true)=>({account,shortcode,url:`https://www.instagram.com/p/${shortcode}/`,text:'Synthetic caption',publishedAt:'2026-01-01T00:00:00Z',imageUrls:['https://example.invalid/image'],carouselComplete});
test('extract only exact public permalinks on Instagram',()=>{
 for(const path of ['/p/ABC_1-/','/reel/ABC_1-/','/ningyocho.news/p/ABC_1-/']) assert.equal(postId(path),'ABC_1-');
 for(const path of ['https://evil.invalid/p/ABC/','/other/p/ABC/','/p/ABC/comments/','/accounts/login/']) assert.equal(postId(path),null);
 assert.equal(postId('/fixture.two/reel/ABC/','fixture.two'),'ABC');
});
test('compare all displayed dates instead of pinned DOM order',()=>{
 const rows=[{shortcode:'pinned',publishedAt:'2020-01-01'},{shortcode:'second',publishedAt:'2026-01-02'},{shortcode:'newest',publishedAt:'2026-01-03'},{shortcode:'third',publishedAt:'2026-01-01'}];
 assert.deepEqual(latest(rows,3).map(p=>p.shortcode),['newest','second','third']);
});
test('config validates identities and deduplicates',()=>{
 assert.deepEqual(parseConfig({accounts:['Fixture.One','fixture.two','fixture.one']}),{accounts:['fixture.one','fixture.two'],postUrls:{}});
 for(const accounts of [[],['../outside'],['x/y'],['..'],[false]]) assert.throws(()=>parseConfig({accounts}));
 assert.throws(()=>parseConfig({accounts:['one'],postUrls:{two:[]}}));
});
test('atomic success, damaged files and partial carousel remain retryable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));
 try {
  const p=post();await commit(root,p,async()=>jpeg);assert.equal(await saved(root,p.shortcode),true);
  await writeFile(join(root,p.shortcode,'images/01.jpg'),'changed');assert.equal(await saved(root,p.shortcode),false);
  const result=await commit(root,post('fixture.one','Partial',false),async()=>jpeg);
  assert.equal(result.imageCount,1);assert.equal(result.status,'partial');assert.equal(await saved(root,'Partial'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failed download keeps old data, marks failure and recovers on rerun',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));
 try {
  const p=post();await commit(root,p,async()=>jpeg);
  await assert.rejects(commit(root,p,async()=>{throw new Error('network interrupted');}));
  assert.equal(await saved(root,p.shortcode),true);
  assert.equal(JSON.parse(await readFile(join(root,`.${p.shortcode}.stage/failure.json`),'utf8')).downloadedImages,0);
  await commit(root,p,async()=>jpeg);assert.equal(await saved(root,p.shortcode),true);
  await assert.rejects(commit(root,post('fixture.one','Invalid'),async()=>Buffer.from('<html>blocked</html>')));
  assert.equal(await saved(root,'Invalid'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('multiple accounts run sequentially; same shortcode separated; aggregate retains success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));const sequence:string[]=[];let active=0;
 try {
  const accounts=['fixture.one','fixture.broken','fixture.two'];
  const reports=await runAccounts(accounts,async(account)=>{
    assert.equal(active++,0);sequence.push(account);
    try {if(account==='fixture.broken') throw new Error('DOM changed');await commit(join(root,account),post(account),async()=>jpeg);}finally{active--;}
  });
  assert.deepEqual(sequence,accounts);assert.deepEqual(reports.map(r=>r.status),['complete','failed','complete']);
  await aggregate(root,accounts);const out=JSON.parse(await readFile(join(root,'posts.json'),'utf8'));
  assert.equal(out.posts.length,2);assert.deepEqual(out.posts.map((p:any)=>p.account),['fixture.one','fixture.two']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('restriction stops remaining accounts',async()=>{
 const reports=await runAccounts(['one','two','three'],async()=>{throw new Error('HTTP 429');});
 assert.deepEqual(reports.map(r=>r.status),['failed','not_started','not_started']);
});
test('real HTML parser decodes entities and preserves internal quotation marks',()=>{
 const html=`<meta content='3 likes, 0 comments - fixture.one on January 1, 2026: &quot;本文 &amp; &#x1F363; &quot;quote&quot;\n#test&quot;.  ' property="og:description"><a href="/p/A/">post</a>`;
 const parsed=parsePublicHtml(html);const caption=parseDescription(parsed.meta['og:description'],'fixture.one');
 assert.equal(caption.text,'本文 & 🍣 "quote"\n#test');assert.equal(caption.metadataDate,'January 1, 2026');
 assert.equal(parseDescription('unrecognized metadata','fixture.one').text,null);
 assert.equal(parseDescription(parsed.meta['og:description'],'wrong').text,null);
});
test('HTTP preview records incomplete images and is idempotent only in HTTP mode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));
 try {
  const r=await commit(root,{...post(),source:'http',imagesComplete:false,carouselComplete:false},async()=>jpeg);
  assert.equal(r.status,'preview_only');assert.equal(r.imagesComplete,false);
  assert.equal(await saved(root,'Synthetic1','http'),true);assert.equal(await saved(root,'Synthetic1','browser'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('interrupted directory replacement restores previous committed post',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));
 try {await commit(root,post(),async()=>jpeg);await rename(join(root,'Synthetic1'),join(root,'Synthetic1.previous'));
  await recover(root);assert.equal(await saved(root,'Synthetic1'),true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unrecognized HTTP caption keeps raw metadata but never passes deduplication',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ig-test-'));
 try {const r=await commit(root,{...post(),source:'http',text:null,rawDescription:'unrecognized'},async()=>jpeg);
  assert.equal(r.rawDescription,'unrecognized');assert.equal(r.status,'partial');assert.equal(await saved(root,'Synthetic1','http'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('timestamp is exact target permalink, never comment timestamp or alt date',()=>{
 const t=selectTimestamp([{href:'/p/Target/',datetime:'2026-10-20T00:22:52.000Z'},{href:'/p/Other/',datetime:'2026-10-20T00:22:54.000Z'}],'fixture.one','Target');
 assert.equal(t,'2026-10-20T00:22:52.000Z');
 assert.throws(()=>selectTimestamp([{href:'/p/Target/',datetime:'bad'}],'fixture.one','Target'));
 assert.throws(()=>selectTimestamp([{href:'/p/Target/',datetime:'2026-01-01'},{href:'/p/Target/',datetime:'2026-01-02'}],'fixture.one','Target'));
});
