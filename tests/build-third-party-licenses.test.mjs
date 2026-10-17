import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildMathJaxLicenses} from '../scripts/build-third-party-licenses.mjs';

const rootDir=fileURLToPath(new URL('../',import.meta.url));
const expected=['@xmldom/xmldom','commander','esm','mathjax-full','mhchemparser','mj-context-menu','speech-rule-engine','wicked-good-xpath'].sort();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function snapshot(directory){const files={};for(const name of (await readdir(directory)).sort())files[name]=(await readFile(path.join(directory,name))).toString('base64');return files;}

test('license build includes the entire installed MathJax tree and preserves original copyright and license bytes',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'paperknow-license-build-'));
  try{
    const manifest=await buildMathJaxLicenses({rootDir,outDir:temp});
    assert.deepEqual(manifest.packages.map(pkg=>pkg.name).sort(),expected);
    for(const pkg of manifest.packages){
      assert.match(pkg.version,/^\d+\.\d+\.\d+/);
      assert.match(pkg.source,/^https:\/\//);
      assert.ok(['MIT','Apache-2.0'].includes(pkg.license));
      assert.ok(pkg.files.length);
      for(const file of pkg.files){
        assert.equal(path.isAbsolute(file.source),false);
        assert.equal(file.source.includes('..'),false);
        const actual=await readFile(path.join(temp,file.file)),original=await readFile(path.join(rootDir,file.source));
        assert.deepEqual(actual,original);
        assert.equal(digest(actual),file.sha256);
        assert.match(actual.toString(),pkg.license==='MIT'?/Permission is hereby granted/:/Apache License/);
        if(pkg.license==='MIT')assert.match(actual.toString(),/Copyright/i);
      }
    }
    const context=manifest.packages.find(pkg=>pkg.name==='mj-context-menu');
    assert.match(context.note,/omits a standalone license file/);
    const attribution=await readFile(path.join(temp,'mathjax-dependencies.txt'),'utf8');
    for(const pkg of manifest.packages){assert.ok(attribution.includes(`${pkg.name} ${pkg.version}`));assert.ok(attribution.includes(pkg.source));}
    const json=await readFile(path.join(temp,'mathjax-dependencies.json'),'utf8');
    assert.deepEqual(JSON.parse(json),manifest);
    assert.equal(json.includes(rootDir),false);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('repeating the license build produces byte-identical attribution and copied files',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'paperknow-license-repeat-'));
  try{
    await buildMathJaxLicenses({rootDir,outDir:temp});
    const before=await snapshot(temp);
    await buildMathJaxLicenses({rootDir,outDir:temp});
    assert.deepEqual(await snapshot(temp),before);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('a changed or missing dependency license fails the build instead of silently omitting its notice',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'paperknow-license-reject-'));
  try{
    const packageDir=path.join(temp,'node_modules/mathjax-full');await mkdir(packageDir,{recursive:true});
    const pkg={name:'mathjax-full',version:'0.0.0',license:'UNLICENSED',repository:'https://example.org/source'};
    await writeFile(path.join(packageDir,'package.json'),JSON.stringify(pkg));
    await assert.rejects(buildMathJaxLicenses({rootDir:temp}),/Review dependency license/);
    await writeFile(path.join(packageDir,'package.json'),JSON.stringify({...pkg,license:'MIT'}));
    await assert.rejects(buildMathJaxLicenses({rootDir:temp}),/Missing original license/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
