import {access,copyFile,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const packageNamePattern=/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function locatePackage(name,from){
  if(!packageNamePattern.test(name))throw Error('Unsupported dependency name in license manifest.');
  for(let dir=from;;dir=path.dirname(dir)){
    const candidate=path.join(dir,'node_modules',name,'package.json');
    try{await access(candidate);return candidate;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(path.dirname(dir)===dir)throw Error(`Missing installed dependency for license manifest: ${name}`);
  }
}
function sourceUrl(pkg){
  let value=typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url;
  if(!value)value=pkg.homepage;
  if(!value)throw Error(`Missing upstream source attribution: ${pkg.name}`);
  value=value.replace(/^git\+/,'').replace(/^git:\/\//,'https://').replace(/\.git$/,'');
  if(value.startsWith('github:'))value='https://github.com/'+value.slice(7);
  if(!value.includes('://'))value='https://github.com/'+value;
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw Error(`Unsupported upstream source URL: ${pkg.name}`);
  return url.href.replace(/\/$/,'');
}

// Follow the installed MathJax dependency tree, including nested package versions.
// The lockfile fixes these versions; generated files contain no dates or host paths.
export async function buildMathJaxLicenses({rootDir=defaultRoot,outDir=path.join(rootDir,'dist/vendor/licenses')}={}){
  const rootPackage=await locatePackage('mathjax-full',rootDir),records=new Map();
  async function visit(manifestFile){
    if(records.has(manifestFile))return;
    const pkg=JSON.parse(await readFile(manifestFile,'utf8'));
    if(!['MIT','Apache-2.0'].includes(pkg.license))throw Error(`Review dependency license before distribution: ${pkg.name}`);
    const directory=path.dirname(manifestFile),record={directory,pkg};records.set(manifestFile,record);
    for(const name of Object.keys(pkg.dependencies||{}).sort())await visit(await locatePackage(name,directory));
  }
  await visit(rootPackage);
  const standardApache=path.join(path.dirname(rootPackage),'LICENSE'),entries=[],copies=[];
  for(const {directory,pkg} of [...records.values()].sort((a,b)=>a.pkg.name.localeCompare(b.pkg.name,'en')||a.pkg.version.localeCompare(b.pkg.version,'en'))){
    const names=(await readdir(directory)).filter(name=>/^(?:licen[sc]e|copying|notice|copyright)(?:\.[a-z0-9_-]+)?$/i.test(name)).sort();
    const original=names.filter(name=>/^(?:licen[sc]e|copying)/i.test(name));
    let note='';
    if(!original.length){
      if(pkg.name!=='mj-context-menu'||pkg.license!=='Apache-2.0')throw Error(`Missing original license file: ${pkg.name}`);
      note='The upstream npm package declares Apache-2.0 in package.json but omits a standalone license file. The unchanged standard Apache-2.0 text is supplied from mathjax-full/LICENSE.';
      original.push(null);
    }
    const files=[];
    for(const name of [...original,...names.filter(name=>/^(?:notice|copyright)/i.test(name))]){
      const source=name?path.join(directory,name):standardApache;
      const bytes=await readFile(source);
      const type=name&&/^(?:notice|copyright)/i.test(name)?name.toUpperCase().replace(/\.[^.]+$/,''):'LICENSE';
      const stem=pkg.name.replace(/^@/,'').replaceAll('/','-');
      const file=`${stem}-${pkg.version}-${type}.txt`;
      if(copies.some(copy=>copy.file===file))throw Error(`Conflicting dependency license filename: ${file}`);
      copies.push({source,file});
      files.push({file,source:path.relative(rootDir,source).split(path.sep).join('/'),sha256:hash(bytes)});
    }
    entries.push({name:pkg.name,version:pkg.version,license:pkg.license,source:sourceUrl(pkg),...(note?{note}:{}),files});
  }
  const manifest={format:'paperknow-third-party-licenses',version:1,scope:'MathJax and its installed runtime dependency tree',packages:entries};
  const attribution=['PaperKnow — MathJax dependency notices','',
    'These packages are installed for MathJax. The browser formula build bundles and minifies the required modules; other listed packages may be used only as runtime dependencies.',
    'Original license and copyright texts are preserved in the accompanying files. Application wrappers are maintained separately by PaperKnow.','',
    ...entries.flatMap(pkg=>[`${pkg.name} ${pkg.version}`,`License: ${pkg.license}`,`Source: ${pkg.source}`,...pkg.files.map(file=>`License/notice file: ${file.file}`),...(pkg.note?[pkg.note]:[]),''])].join('\n');
  await mkdir(outDir,{recursive:true});
  for(const {source,file} of copies)await copyFile(source,path.join(outDir,file));
  await writeFile(path.join(outDir,'mathjax-dependencies.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(outDir,'mathjax-dependencies.txt'),attribution+'\n');
  return manifest;
}
