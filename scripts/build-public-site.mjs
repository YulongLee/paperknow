import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {featurePages,guidePages} from '../src/public-feature-content.mjs';
import {infoPages} from '../src/public-info-content.mjs';
import {buildPublicSamples} from './build-public-samples.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const siteURL='https://paperknow.cn';
export const updatedAt='2026-10-15';
export const homeModifiedAt='2026-10-22';
const siteName='PaperKnow科研助手';
const operator='oneshowailab-paperknow';
const email='contact@oneshowailab.com';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const categoryNames={writing:'AI 写作',literature:'AI 研读',reduce:'降重复率',aigc:'降AI率',detection:'免费查重',ppt:'PPT 创作',format:'格式排版',research:'科研工具'};
const titleFor=page=>page.title.includes('PaperKnow')?page.title:`${page.title}｜PaperKnow`;
const homeTitle=siteName;
const homeDescription='PaperKnow科研助手为专科、本科、硕士、博士与研究工作者提供 11 项 AI 写作流程，连接文献检索、原文研读与翻译、逐段改写、公开网络来源比对和通用 AI 文本鉴别，支持可编辑 PPTX、论文排版、科研绘图与公式编辑。';

function graphFor(page){
 const url=siteURL+page.slug;
 const graph=[
  {'@type':'Organization','@id':siteURL+'/#organization',name:operator,url:siteURL+'/',email,logo:siteURL+'/brand/paperknow-symbol.svg'},
  {'@type':'WebSite','@id':siteURL+'/#website',url:siteURL+'/',name:siteName,inLanguage:'zh-CN',publisher:{'@id':siteURL+'/#organization'}},
  {'@type':'WebApplication','@id':siteURL+'/#application',name:siteName,url:siteURL+'/',applicationCategory:'EducationalApplication',browserRequirements:'需要支持 JavaScript 的现代浏览器',description:'11 项 AI 写作流程、毕业论文五步确认与分章生成、文献检索研读与翻译、逐段改写、本地材料与公开网络来源比对、通用 AI 文本鉴别、可编辑 PPTX、DOCX 格式排版、科研绘图及 LaTeX 公式编辑。',publisher:{'@id':siteURL+'/#organization'}},
  {'@type':'WebPage','@id':url+'#webpage',url,name:page.slug==='/'?homeTitle:titleFor(page),description:page.description,inLanguage:'zh-CN',isPartOf:{'@id':siteURL+'/#website'},about:{'@id':siteURL+'/#application'},dateModified:page.modifiedAt||(page.slug==='/'?homeModifiedAt:updatedAt)}
 ];
 if(page.slug!=='/'){
  const parent=page.slug.startsWith('/features/')&&page.slug!=='/features/'?{name:'功能介绍',url:siteURL+'/features/'}:page.slug.startsWith('/guides/')&&page.slug!=='/guides/'?{name:'使用指南',url:siteURL+'/guides/'}:null;
  const entries=[{name:'首页',url:siteURL+'/'},...(parent?[parent]:[]),{name:page.title,url}];
  graph.push({'@type':'BreadcrumbList','@id':url+'#breadcrumbs',itemListElement:entries.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:item.url}))});
 }
 return {'@context':'https://schema.org','@graph':graph};
}

export function pageMetadata(page){
 const title=page.slug==='/'?homeTitle:titleFor(page),url=siteURL+page.slug;
 return `<title>${escape(title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${siteName}"><meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${siteURL}/brand/paperknow-share.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="PaperKnow 论文写作与科研辅助工作台">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(page.description)}"><meta name="twitter:image" content="${siteURL}/brand/paperknow-share.png">
<script type="application/ld+json">${json(graphFor(page))}</script>`;
}

function renderSection(section,index){
 const paragraphs=(section.paragraphs||[]).map(p=>`<p>${escape(p)}</p>`).join('');
 const items=section.items?.length?`<${section.ordered?'ol':'ul'}>${section.items.map(p=>`<li>${escape(p)}</li>`).join('')}</${section.ordered?'ol':'ul'}>`:'';
 const table=section.table?`<div class="public-table-wrap"><table><thead><tr>${section.table.headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${section.table.rows.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
 return `<section class="public-section" id="section-${index+1}"><h2>${escape(section.heading)}</h2>${paragraphs}${items}${table}</section>`;
}
function breadcrumbs(page){
 const parent=page.slug.startsWith('/features/')&&page.slug!=='/features/'?['/features/','功能介绍']:page.slug.startsWith('/guides/')&&page.slug!=='/guides/'?['/guides/','使用指南']:null;
 return `<nav class="public-breadcrumb" aria-label="当前位置"><a href="/">首页</a><span aria-hidden="true">/</span>${parent?`<a href="${parent[0]}">${parent[1]}</a><span aria-hidden="true">/</span>`:''}<span aria-current="page">${escape(page.title)}</span></nav>`;
}
function footer(){
 return `<footer class="public-footer"><div class="public-shell public-footer-grid"><div><a class="public-brand" href="/"><img src="/brand/paperknow-symbol.svg" width="32" height="32" alt=""><span>PaperKnow</span></a><p>让每一步写作，都有清晰的方向。</p></div><nav aria-label="功能与使用"><h2>论文与科研</h2><a href="/features/">全部功能介绍</a><a href="/guides/">使用指南</a><a href="/workspace.html#home">进入工作台</a><a href="/#download">客户端下载</a></nav><nav aria-label="产品信息"><h2>了解 PaperKnow</h2><a href="/about/">产品介绍</a><a href="/help/">使用帮助</a><a href="/status/">功能开放状态</a><a href="/contact/">联系支持</a></nav><nav aria-label="数据与服务"><h2>数据与服务</h2><a href="/privacy/">数据与隐私</a><a href="/terms/">服务规则</a><a href="/workspace.html#membership/plans">方案与权益</a><a href="mailto:${email}">${email}</a></nav></div><div class="public-shell public-footer-bottom"><span>© 2026 PaperKnow</span><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">浙ICP备2026052190号-5</a></div></footer>`;
}
function pageCards(pages){
 return `<div class="public-card-grid">${pages.map(p=>`<a class="public-link-card" href="${p.slug}"><span class="public-card-label">${escape(p.eyebrow||'使用指南')}</span><h2>${escape(p.title)}</h2><p>${escape(p.description)}</p><span class="public-card-more">查看详情 <span aria-hidden="true">→</span></span></a>`).join('')}</div>`;
}
function samplesHTML(slug){
 const samples={
  '/guides/paper-outline/':{text:'下面是一份自制结构示例，用于观察标题层级与材料安排，不是 AI 生成的正文，也不包含真实研究结果。',files:[['paper-outline.txt','下载大纲结构示例（TXT）']]},
  '/guides/material-comparison/':{text:'这两份自制文本共享一个完整段落。JSON 结果由网站同版本的本地比对引擎实际计算，可用给定原文复现；不是全网查重，也不代表真实用户论文。',files:[['comparison-paper.txt','下载待比对文本'],['comparison-reference.txt','下载对照文本'],['comparison-result.json','查看实际比对结果（JSON）']]},
  '/guides/research-charts/':{text:'下图使用自制演示数值，由网站同版本基础图表渲染函数生成。下载 CSV 后可在基础绘图中复现，不代表真实研究发现。',image:true,files:[['research-data.csv','下载示例数据（CSV）'],['research-chart.svg','下载实际生成的图形（SVG）']]}
 };
 const sample=samples[slug];
 if(!sample)return '';
 return `<section class="public-section"><h2>自制样本与复现材料</h2><p>${sample.text}</p>${sample.image?'<img class="public-sample-image" src="/samples/research-chart.svg" width="1200" height="750" alt="自制数据的分组柱状图：四组方案 A 与方案 B 数值，不代表真实研究结果" loading="lazy">':''}<div class="public-sample-links">${sample.files.map(([file,label])=>`<a href="/samples/${file}" download>${label} <span aria-hidden="true">↓</span></a>`).join('')}</div></section>`;
}
function renderPage(page,pages,header){
 const sectionHTML=(page.sections||[]).map(renderSection).join('');
 const related=(page.related||[]).map(slug=>pages.find(p=>p.slug===slug)).filter(Boolean);
 const action=page.category?`/workspace.html#category/${page.category}`:'/workspace.html#home';
 const actionText=page.ctaLabel||(page.category?`进入${categoryNames[page.category]}`:'进入工作台');
 const contactAction=page.slug==='/contact/'?`<a class="public-button" href="mailto:${email}">邮件联系支持 <span aria-hidden="true">↗</span></a>`:'';
 const cardPages=page.directory==='features'?featurePages:page.directory==='guides'?guidePages:null;
 const faq=page.faqs?.length?`<section class="public-section public-faq"><h2>常见问题</h2>${page.faqs.map((q,i)=>`<details${i===0?' open':''}><summary>${escape(q.question)}</summary><p>${escape(q.answer)}</p></details>`).join('')}</section>`:'';
 return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${pageMetadata(page)}<link rel="icon" type="image/svg+xml" href="/brand/paperknow-symbol.svg"><link rel="preload" href="/brand/fonts/paperknow-nav.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/home-refresh.css"><link rel="stylesheet" href="/brand/brand.css"><link rel="stylesheet" href="/public-site.css"><link rel="stylesheet" href="/brand/ambient.css"><script type="module" src="/public-site.mjs"></script></head><body class="public-site" data-category="${escape(page.category||'')}"><a href="#public-main" class="public-skip">跳到主要内容</a>${header}<main id="public-main"><div class="public-shell">${breadcrumbs(page)}</div><section class="public-hero"><div class="public-shell"><p class="public-eyebrow">${escape(page.eyebrow||'PAPERKNOW · 产品与使用')}</p><h1>${escape(page.h1)}</h1><p class="public-intro">${escape(page.intro)}</p><div class="public-actions">${contactAction||`<a class="public-button" href="${action}">${escape(actionText)} <span aria-hidden="true">→</span></a>`}<a class="public-text-link" href="${page.slug==='/features/'?'/guides/':'/features/'}">${page.slug==='/features/'?'查看使用指南':'查看全部功能'} <span aria-hidden="true">↗</span></a></div><p class="public-updated">说明更新于 ${page.modifiedAt||updatedAt} · 具体能力以工具内当前状态为准</p></div></section><div class="public-shell public-reading-layout"><article class="public-article">${cardPages?pageCards(cardPages):''}${sectionHTML}${samplesHTML(page.slug)}${faq}${related.length?`<section class="public-section"><h2>继续了解</h2><ul class="public-related">${related.map(p=>`<li><a href="${p.slug}">${escape(p.title)} <span aria-hidden="true">→</span></a></li>`).join('')}</ul></section>`:''}</article>${page.sections?.length?`<aside class="public-toc"><h2>本页内容</h2><nav aria-label="本页内容">${page.sections.map((s,i)=>`<a href="#section-${i+1}">${escape(s.heading)}</a>`).join('')}${faq?'<a href="#public-faq">常见问题</a>':''}</nav><a class="public-button public-button-outline" href="${action}">${escape(actionText)}</a></aside>`:''}</div></main>${footer()}</body></html>`.replace('<section class="public-section public-faq">','<section class="public-section public-faq" id="public-faq">');
}

export async function buildPublicSite({outDir=resolve(projectRoot,'dist')}={}){
 const original=await readFile(resolve(projectRoot,'dist/index.html'),'utf8');
 const header=original.match(/<header class="header product-header">[\s\S]*?<\/header>/)?.[0];
 if(!header)throw new Error('Homepage header missing');
 const publicHeader=header.replace('class="nav-active" href="/" aria-current="page"','href="/"').replace('href="#download"','href="/#download"').replace(/\sdata-service-start(?:="[^"]*"|='[^']*')?/g,'');
 const pages=[
  {slug:'/features/',title:'论文与科研功能介绍',h1:'围绕你的论文，找到适合的工具',eyebrow:'PAPERKNOW · 功能介绍',description:'查看 PaperKnow AI 写作、AI 研读、降重、材料比对、PPT、格式排版与科研工具的实际使用范围和流程。',intro:'从研究问题、大纲和资料整理开始，到格式检查、图表与汇报准备。先了解每项能力的输入、输出与当前范围，再进入适合的工作流程。',directory:'features'},
  ...featurePages,
  {slug:'/guides/',title:'论文与科研工具使用指南',h1:'按实际步骤，完成你的研究任务',eyebrow:'PAPERKNOW · 使用指南',description:'阅读 PaperKnow 论文大纲、材料比对、DOCX 格式、开题与毕业 PPT、科研图表的操作指南。',intro:'这些指南说明各项工具当前可用的操作、输入材料和结果复核方式。示例用于学习步骤，研究内容和最终成果由你核实完善。',directory:'guides'},
  ...guidePages,...infoPages.filter(p=>p.publish!==false)
 ];
 const slugs=new Set();
 for(const page of pages){
  if(!/^\/(?:[a-z0-9-]+\/)+$/.test(page.slug)||slugs.has(page.slug))throw new Error('Invalid or duplicate public page: '+page.slug);
  if(!page.title||!page.description||!page.h1||!page.intro)throw new Error('Incomplete public page: '+page.slug);
  slugs.add(page.slug);
 }
 await mkdir(outDir,{recursive:true});
 await buildPublicSamples(outDir);
 const manifest={pages:[]};
 for(const page of pages){
  const file=page.slug.slice(1)+'index.html',destination=resolve(outDir,file);
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination,renderPage(page,pages,publicHeader));
  manifest.pages.push({slug:page.slug,file,modifiedAt:page.modifiedAt||updatedAt,title:page.title});
 }
 let home=original;
 const meta=pageMetadata({slug:'/',description:homeDescription,modifiedAt:homeModifiedAt});
 if(home.includes('<!-- seo:start -->'))home=home.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,`<!-- seo:start -->\n${meta}\n<!-- seo:end -->`);
 else home=home.replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/,`<!-- seo:start -->\n${meta}\n<!-- seo:end -->`);
 await writeFile(resolve(outDir,'index.html'),home);
 await writeFile(resolve(outDir,'public-pages.json'),JSON.stringify(manifest,null,2)+'\n');
 const entries=[{slug:'/',modifiedAt:homeModifiedAt},...manifest.pages];
 await writeFile(resolve(outDir,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(p=>`  <url><loc>${siteURL}${p.slug}</loc><lastmod>${p.modifiedAt}</lastmod></url>`).join('\n')}\n</urlset>\n`);
 await writeFile(resolve(outDir,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteURL}/sitemap.xml\n`);
 await writeFile(resolve(outDir,'llms.txt'),`# PaperKnow\n\n> AI 论文写作与科研辅助工作台。公开资料说明写作、文献研读、修改、比对、演示与科研工具的实际使用范围。\n\n## 产品与使用\n${pages.map(p=>`- [${p.title}](${siteURL}${p.slug}): ${p.description}`).join('\n')}\n\n## 数据与范围\n- 本地体验与在线账户分别保存，不会自动迁移浏览器草稿。\n- 文献检索提供题录与可用摘要；研读与翻译使用实际提供的正文或摘要。\n- 联网来源比对仅覆盖本次取得的公开网页正文，通用 AI 文本鉴别提供表达倾向，均不能替代学校指定检测。\n- 商品、价格、有效期与支付渠道以账户收银台实时核验结果为准。\n- 研究事实、数据、引用与最终成果需要使用者复核。\n`);
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await buildPublicSite();console.log(`PaperKnow public pages built: ${result.pages.length}`);
}
