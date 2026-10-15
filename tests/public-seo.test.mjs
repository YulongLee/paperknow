import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {JSDOM} from 'jsdom';
import {buildPublicSite} from '../scripts/build-public-site.mjs';
import {createServer} from '../server.mjs';

const origin='https://paperknow.cn';
const features={
  'ai-writing':'writing','ai-reading':'literature','reduce-similarity':'reduce',
  'reduce-ai':'aigc','similarity-check':'detection','ppt':'ppt',
  'format':'format','research-tools':'research',
};
const guides=['paper-outline','material-comparison','docx-format','research-ppt','research-charts'];
const information=['about','help','privacy','terms','status','contact'];
const expectedSlugs=[
  '/features/',...Object.keys(features).map(name=>`/features/${name}/`),
  '/guides/',...guides.map(name=>`/guides/${name}/`),
  ...information.map(name=>`/${name}/`),
];
let directory,output,manifest,pages,app,base;

before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'pk-public-seo-'));
  output=join(directory,'public');
  await buildPublicSite({outDir:output});
  manifest=JSON.parse(await readFile(join(output,'public-pages.json'),'utf8'));
  pages=new Map(await Promise.all([
    ['/', 'index.html'],...manifest.pages.map(page=>[page.slug,page.file]),
  ].map(async([slug,file])=>{
    const html=await readFile(join(output,file),'utf8');
    return [slug,{html,document:new JSDOM(html,{url:origin+slug}).window.document}];
  })));
  app=createServer({dbPath:join(directory,'seo.sqlite'),config:{}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${app.server.address().port}`;
});

after(async()=>{
  if(app)await app.close();
  if(directory)await rm(directory,{recursive:true,force:true});
});

const get=(path,method='GET')=>fetch(base+path,{method,redirect:'manual'});
const meta=(document,name,attribute='name')=>document.querySelector(`meta[${attribute}="${name}"]`)?.content;
function structuredNodes(value){
  if(!value||typeof value!=='object')return [];
  return [value,...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(structuredNodes):structuredNodes(item))];
}

test('public build publishes the complete finite route manifest with real output files',async()=>{
  assert.deepEqual(manifest.pages.map(page=>page.slug).sort(),expectedSlugs.toSorted());
  assert.equal(new Set(manifest.pages.map(page=>page.file)).size,manifest.pages.length);
  for(const page of manifest.pages){
    assert.equal(page.modifiedAt,'2026-10-15',page.slug);
    const file=resolve(output,page.file);
    assert.ok(file.startsWith(resolve(output)+sep),`manifest file must stay in output: ${page.file}`);
    assert.equal((await stat(file)).isFile(),true,page.file);
    assert.match(page.slug,/^\/[a-z0-9-/]+\/$/);
  }
});

test('every public page exposes its own readable title, description, H1 and canonical in initial HTML',()=>{
  const titles=new Set(),descriptions=new Set();
  for(const [slug,{html,document}] of pages){
    assert.equal(document.documentElement.lang,'zh-CN',slug);
    const title=document.title.trim(),description=meta(document,'description')?.trim();
    assert.ok(title.includes('PaperKnow'),slug);
    assert.ok(title.length>=12,`specific title: ${slug}`);
    assert.ok(description?.length>=30,`useful description: ${slug}`);
    assert.equal(document.querySelectorAll('h1').length,1,slug);
    assert.ok(document.querySelector('h1').textContent.trim().length>=4,slug);
    assert.equal(document.querySelectorAll('link[rel="canonical"]').length,1,slug);
    assert.equal(document.querySelector('link[rel="canonical"]').href,origin+slug,slug);
    assert.doesNotMatch(meta(document,'robots')||'',/\bnoindex\b/i,slug);
    assert.ok(document.querySelector('main')?.textContent.replace(/\s/g,'').length>=150,`substantive initial HTML: ${slug}`);
    assert.ok(!/千万学生及科研工作者的共同选择|由\s*OneShowAILab\s*出品/.test(html),`unsupported scale claim or removed maker credit: ${slug}`);
    titles.add(title);descriptions.add(description);
  }
  assert.equal(titles.size,pages.size,'page titles should identify distinct pages');
  assert.equal(descriptions.size,pages.size,'descriptions should identify distinct pages');
});

test('share metadata and structured data agree with canonical URLs without fabricated commercial claims',()=>{
  for(const [slug,{document}] of pages){
    assert.equal(meta(document,'og:url','property'),origin+slug,slug);
    assert.equal(meta(document,'og:title','property'),document.title,slug);
    assert.equal(meta(document,'og:description','property'),meta(document,'description'),slug);
    assert.equal(meta(document,'og:image','property'),origin+'/brand/paperknow-share.png',slug);
    assert.equal(meta(document,'twitter:card'),'summary_large_image',slug);
    assert.equal(meta(document,'twitter:image'),origin+'/brand/paperknow-share.png',slug);
    const scripts=[...document.querySelectorAll('script[type="application/ld+json"]')];
    assert.ok(scripts.length>=1,slug);
    const data=scripts.map(script=>JSON.parse(script.textContent));
    const nodes=data.flatMap(structuredNodes);
    assert.ok(nodes.some(node=>node['@context']==='https://schema.org'),slug);
    assert.ok(nodes.some(node=>node.url===origin+slug||node['@id']===origin+slug+'#webpage'),`structured page identity: ${slug}`);
    for(const node of nodes){
      const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
      assert.ok(!types.some(type=>['Offer','AggregateRating','Review','SearchAction'].includes(type)),`unsubstantiated schema: ${slug}`);
    }
  }
});

test('all eight feature pages connect to the correct existing tool and useful public documentation',()=>{
  for(const [name,category] of Object.entries(features)){
    const slug=`/features/${name}/`,{document}=pages.get(slug);
    const links=[...document.querySelectorAll('a[href]')].map(link=>link.getAttribute('href'));
    assert.ok(links.includes(`/workspace.html#category/${category}`),`correct tool destination: ${slug}`);
    assert.ok(links.includes('/status/'),`current scope is discoverable: ${slug}`);
    assert.ok(links.includes('/privacy/'),`data policy is discoverable: ${slug}`);
    assert.ok(links.some(link=>link.startsWith('/guides/')),`next-step guide: ${slug}`);
  }
  const reachable=new Set(['/']),queue=['/'];
  for(const current of queue){
    const {document}=pages.get(current);
    for(const link of document.querySelectorAll('a[href]')){
      const url=new URL(link.getAttribute('href'),origin);
      if(url.origin===origin&&pages.has(url.pathname)&&!reachable.has(url.pathname)){
        reachable.add(url.pathname);queue.push(url.pathname);
      }
    }
  }
  assert.deepEqual([...reachable].sort(),[...pages.keys()].sort(),'no published page should be sitemap-only');
});

test('sitemap lists only real canonical public pages and records actual publication dates',async()=>{
  const xml=await readFile(join(output,'sitemap.xml'),'utf8');
  const document=new JSDOM(xml,{contentType:'application/xml'}).window.document;
  assert.equal(document.documentElement.localName,'urlset');
  assert.equal(document.documentElement.namespaceURI,'http://www.sitemaps.org/schemas/sitemap/0.9');
  const entries=[...document.querySelectorAll('url')];
  const locations=entries.map(entry=>entry.querySelector('loc')?.textContent);
  assert.equal(new Set(locations).size,locations.length);
  assert.deepEqual(locations.toSorted(),[...pages.keys()].map(slug=>origin+slug).toSorted());
  for(const entry of entries){
    const url=new URL(entry.querySelector('loc').textContent);
    assert.equal(url.search,'');assert.equal(url.hash,'');
    assert.doesNotMatch(url.pathname,/workspace|auth|admin|service\.html|precheck|private|preview/);
    assert.equal(entry.querySelector('lastmod')?.textContent,'2026-10-15');
  }
});

test('robots declares the sitemap without blocking public content or resources needed to read noindex',async()=>{
  const robots=await readFile(join(output,'robots.txt'),'utf8');
  assert.match(robots,/^User-agent:\s*\*\s*$/im);
  assert.match(robots,/^Sitemap:\s*https:\/\/paperknow\.cn\/sitemap\.xml\s*$/im);
  const blocked=robots.split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^Disallow:\s*(\S+)/i);return match?[match[1]]:[];
  });
  for(const path of blocked){
    assert.notEqual(path,'/','public site cannot be blocked');
    assert.doesNotMatch(path,/features|guides|\.css|\.js|brand|workspace|auth\.html/);
  }
});

test('published public routes support direct GET, HEAD and query-bearing visits',async()=>{
  for(const slug of pages.keys()){
    const response=await get(slug+'?utm_source=seo-check');
    assert.equal(response.status,200,slug);
    assert.match(response.headers.get('content-type')||'',/^text\/html\b/);
    assert.doesNotMatch(response.headers.get('x-robots-tag')||'',/\bnoindex\b/i,slug);
    const document=new JSDOM(await response.text()).window.document;
    assert.equal(document.querySelector('link[rel="canonical"]')?.href,origin+slug,slug);
    const head=await get(slug,'HEAD');
    assert.equal(head.status,200,slug);
    assert.equal(await head.text(),'');
  }
});

test('canonical aliases redirect permanently while preserving query parameters',async()=>{
  const query='?utm_source=seo-check&next=%2Fworkspace.html%23category%2Fwriting';
  for(const slug of expectedSlugs){
    for(const alias of [slug.slice(0,-1),slug+'index.html']){
      const response=await get(alias+query);
      assert.equal(response.status,308,alias);
      assert.equal(response.headers.get('location'),slug+query,alias);
    }
  }
  const home=await get('/index.html?tool=outline');
  assert.equal(home.status,308);
  assert.equal(home.headers.get('location'),'/?tool=outline');
});

test('crawler documents and share images use their actual MIME types and response bodies',async()=>{
  const robots=await get('/robots.txt');
  assert.equal(robots.status,200);assert.match(robots.headers.get('content-type')||'',/^text\/plain\b/);
  assert.match(await robots.text(),/Sitemap:\s*https:\/\/paperknow\.cn\/sitemap\.xml/);
  const sitemap=await get('/sitemap.xml');
  assert.equal(sitemap.status,200);assert.match(sitemap.headers.get('content-type')||'',/^(application|text)\/xml\b/);
  assert.match(await sitemap.text(),/<urlset\b/);
  const image=await get('/brand/paperknow-share.png');
  assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  const bytes=Buffer.from(await image.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);
});

test('public cache revalidation saves transfer while account pages remain no-store',async()=>{
  for(const path of ['/','/features/ai-writing/','/sitemap.xml','/public-site.css']){
    const first=await get(path),tag=first.headers.get('etag');
    assert.equal(first.status,200,path);assert.ok(tag,path);
    assert.match(first.headers.get('cache-control')||'',/\bmust-revalidate\b/);
    assert.match(first.headers.get('vary')||'',/\bAccept-Encoding\b/i);
    const cached=await fetch(base+path,{headers:{'If-None-Match':tag},redirect:'manual'});
    assert.equal(cached.status,304,path);assert.equal(await cached.text(),'');
    assert.equal(cached.headers.get('etag'),tag,path);
    const changed=await fetch(base+path,{headers:{'If-None-Match':'"different-version"'},redirect:'manual'});
    assert.equal(changed.status,200,path);
  }
  for(const path of ['/auth.html','/workspace.html']){
    const response=await get(path);
    assert.equal(response.headers.get('cache-control'),'no-store',path);
    assert.equal(response.headers.get('etag'),null,path);
  }
});

test('operation and account pages remain noindex, authenticated administration keeps its gate',async()=>{
  for(const path of ['/workspace.html','/auth.html','/admin.html','/service.html','/precheck/']){
    const response=await get(path);
    assert.match(response.headers.get('x-robots-tag')||'',/\bnoindex\b/i,path);
    assert.ok([200,302].includes(response.status),path);
  }
  const admin=await get('/admin.html');
  assert.equal(admin.status,302);
  assert.equal(admin.headers.get('location'),'/auth.html?mode=login&next=%2Fadmin.html');
});

test('existing tool and account query semantics survive the new public routes',async()=>{
  for(const path of ['/?tool=outline','/workspace.html?tool=outline','/auth.html?mode=login&next=%2Fworkspace.html%23category%2Fwriting']){
    const response=await get(path);
    assert.equal(response.status,200,path);assert.equal(response.headers.get('location'),null,path);
  }
  const account=await get('/service.html?view=projects&auth=register');
  assert.equal(account.status,302);
  assert.equal(account.headers.get('location'),'/auth.html?mode=register&next=%2Fworkspace.html%23projects%3Fscope%3Daccount');
});

test('unknown public paths return real 404s and unsupported methods stay rejected',async()=>{
  for(const path of ['/features/not-published/','/guides/not-published/','/features/ai-writing/other/','/not-a-real-page/','/server.mjs']){
    const response=await get(path);
    assert.equal(response.status,404,path);
  }
  assert.equal((await get('/features/','POST')).status,405);
});
