import type { Browser, Locator } from 'playwright-core';
import { httpAccount, imageGet } from './http.ts';
import { postId,latest,saved,commit,selectTimestamp } from './core.ts';
export async function scrape(browser:Browser, account:string, accountRoot:string, limit:number, report:any) {
  const context=await browser.newContext(); // Ephemeral: no storageState, cookies, or persistent profile.
  try {
  const page=await context.newPage();
  async function postRoot(shortcode:string):Promise<Locator> {
    const links=page.locator('a[href]').filter({has:page.locator('time[datetime]')});
    const matching=[];for(const a of await links.all()) if(postId(await a.getAttribute('href')||'',account)===shortcode) matching.push(a);
    if(matching.length!==1) throw new Error('Ambiguous target timestamp');
    // Walk up from the exact permalink, selecting the smallest visible media + caption container.
    let root=matching[0];
    for(let i=0;i<16;i++) {root=root.locator('xpath=..');
      if(await root.locator('h1').count()===1 && await root.locator('img').evaluateAll(els=>els.some(el=>el.getBoundingClientRect().width>200&&el.getBoundingClientRect().height>150))) return root;
    }
    throw new Error('DOM_UNSUPPORTED: Cannot isolate caption and media around target permalink');
  }
  let denied:string|null=null;
  page.on('response',r=>{ if([401,403,429].includes(r.status())) denied=`HTTP ${r.status()} ${new URL(r.url()).hostname}`; });
  async function guard() {
    if(denied) throw new Error(denied);
    if(/accounts\/login|challenge|checkpoint/.test(page.url())) throw new Error('Login/challenge redirect');
    const text=await page.locator('body').innerText();
    if(/captcha|try again later|access denied|too many requests|不審なアクティビティ|しばらくしてからもう一度|アクセスが拒否/i.test(text)) throw new Error('Access restriction/CAPTCHA detected');
  }
  async function navigate(url:string) {
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    if(r && r.status()>=400) throw new Error(`HTTP ${r.status()}`);
    await page.waitForTimeout(2000); await guard();
    // Only a visible, explicit close control may dismiss an optional signup dialog.
    for(const name of [/^Close$/i,/^閉じる$/]) { const b=page.getByRole('button',{name}).filter({visible:true}); if(await b.count()===1) await b.click(); }
    await guard();
  }
  await navigate(`https://www.instagram.com/${account}/`);
  const ids=[...new Set((await page.locator('a[href]').evaluateAll(as=>as.map(a=>a.getAttribute('href')||''))).map(href=>postId(href,account)).filter(Boolean))] as string[];
  report.visibleShortcodes=ids;
  if(!ids.length) throw new Error('No public post links; login wall or changed DOM');
  const posts:any[]=[];
  for(const shortcode of ids) {
    await page.waitForTimeout(3000);
    await navigate(`https://www.instagram.com/p/${shortcode}/`);
    // Require the target permalink's own timestamp, never an image alt date or comment time.
    const times=page.locator('a[href]').filter({has:page.locator('time[datetime]')});
    const target=[];
    for(const a of await times.all()) if(postId(await a.getAttribute('href')||'',account)===shortcode) target.push(a);
    if(target.length!==1) throw new Error(`Ambiguous target timestamp: ${shortcode} (${target.length})`);
    const publishedAt=selectTimestamp([{href:await target[0].getAttribute('href')||'',datetime:await target[0].locator('time').getAttribute('datetime')}],account,shortcode);
    posts.push({source:'browser',publishedAtSource:'target_permalink_time_datetime',account,shortcode,url:`https://www.instagram.com/p/${shortcode}/`,publishedAt});
  }
  report.compared=posts.map(({shortcode,publishedAt})=>({shortcode,publishedAt}));
  for(const post of latest(posts,limit)) {
    if(await saved(accountRoot,post.shortcode)) {report.skipped.push(post.shortcode);continue;}
    await page.waitForTimeout(3000); await navigate(post.url);
    let article:Locator;
    try {article=await postRoot(post.shortcode);}
    catch(e) {
      report.mediaFallback=String(e);report.incomplete=true;
      await httpAccount(account,accountRoot,limit,report,[post.url],{publishedAt:post.publishedAt,publishedAtSource:post.publishedAtSource,discoverySource:'browser',carouselReason:'DOM_UNSUPPORTED: HTTP preview only'});
      continue;
    }
    const captions=article.locator('h1');
    if(await captions.count()!==1) throw new Error('DOM_UNSUPPORTED: ambiguous caption');
    const text=await captions.innerText();
    if(await article.count()!==1) throw new Error('Ambiguous media article');
    const urls=new Map<string,string>(); let carouselComplete=false,reason='UI step limit';
    for(let step=0;step<20;step++) {
      await guard();
      const imgs=await article.locator('img').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width>200&&el.getBoundingClientRect().height>150).map(el=>({src:(el as HTMLImageElement).currentSrc,alt:(el as HTMLImageElement).alt})));
      for(const im of imgs) if(im.src) {const u=new URL(im.src);urls.set(u.origin+u.pathname,im.src);}
      if(await article.locator('video').count()) {reason='Video media is outside image-only scope';break;}
      const next=article.getByRole('button',{name:/^(Next|次へ)$/i}).filter({visible:true});
      if(await next.count()===0) {carouselComplete=true;reason='No next button in post UI';break;}
      if(await next.count()!==1) {reason='Ambiguous next button';break;}
      const before=JSON.stringify(imgs);
      await next.click(); await page.waitForTimeout(1200);
      const after=await article.locator('img').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width>200&&el.getBoundingClientRect().height>150).map(el=>({src:(el as HTMLImageElement).currentSrc,alt:(el as HTMLImageElement).alt})));
      if(JSON.stringify(after)===before) {reason='Carousel did not advance';break;}
    }
    const result=await commit(accountRoot,{...post,text,captionStatus:'post_h1',imageUrls:[...urls.values()],imagesComplete:carouselComplete,carouselComplete,carouselReason:reason,fetchedAt:new Date().toISOString()},imageGet);
    report.saved.push({shortcode:post.shortcode,status:result.status,imageCount:result.imageCount});
    if(!carouselComplete) throw new Error(`Partial carousel: ${post.shortcode}: ${reason}`);
  }
  report.selection='latest_visible_by_permalink_datetime';
  if(report.incomplete) throw new Error('DOM_UNSUPPORTED: HTTP previews saved; full carousel collection incomplete');
  } finally { await context.close(); }
}
