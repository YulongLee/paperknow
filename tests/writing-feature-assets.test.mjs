import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writingFeatureIdentities,writingFeatureKeys,getWritingFeatureIdentity} from '../dist/workspace/writing-feature-identities.mjs';

// Validate shipped files rather than merely asserting that a CSS selector exists.
function webpMetadata(bytes){
 assert.equal(bytes.toString('ascii',0,4),'RIFF','asset must contain a real RIFF image');
 assert.equal(bytes.toString('ascii',8,12),'WEBP','asset must be WebP');
 assert.equal(bytes.readUInt32LE(4)+8,bytes.length,'RIFF length must match the complete file');
 let size=null,alpha=false,image=false,offset=12;
 while(offset+8<=bytes.length){
  const name=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),data=offset+8;
  assert.ok(data+length<=bytes.length,'WebP chunk cannot exceed its file');
  if(name==='VP8X'){assert.ok(length>=10);size={width:bytes.readUIntLE(data+4,3)+1,height:bytes.readUIntLE(data+7,3)+1};alpha=Boolean(bytes[data]&16);}
  if(name==='VP8 '||name==='VP8L')image=true;
  offset=data+length+(length%2);
 }
 assert.equal(offset,bytes.length,'WebP chunks must consume the complete file');assert.ok(size,'extended WebP dimensions are required for these transparent illustrations');assert.ok(image,'asset must have encoded image content');
 return {...size,alpha};
}

test('all eleven independent writing illustrations are present, unique, transparent and within a practical download budget',async()=>{
 const digests=new Set(),paths=new Set();let total=0;
 for(const key of writingFeatureKeys){
  const feature=writingFeatureIdentities[key];assert.match(feature.art,/^\/workspace\/assets\/writing-[a-z]+-v1\.webp$/);assert.equal(feature.art,`/workspace/assets/writing-${key}-v1.webp`);assert.equal(paths.has(feature.art),false);paths.add(feature.art);
  const bytes=await readFile(new URL('../dist'+feature.art,import.meta.url));assert.ok(bytes.length>=1024,`${key} should be a genuine illustration`);assert.ok(bytes.length<=250*1024,`${key} should not ship an oversized source image`);total+=bytes.length;
  const image=webpMetadata(bytes);assert.ok(image.width>=256&&image.width<=1024,`${key} should have enough detail without excessive dimensions`);assert.ok(image.height>=256&&image.height<=1024);assert.ok(image.width/image.height>=.75&&image.width/image.height<=1.33,`${key} should fit the shared illustration slot`);assert.equal(image.alpha,true,`${key} must preserve its transparent background`);
  const digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digests.has(digest),false,`${key} must have its own illustration`);digests.add(digest);
 }
 assert.equal(paths.size,11);assert.equal(digests.size,11);assert.ok(total<=2*1024*1024,'the full illustration set should remain lightweight');assert.equal(getWritingFeatureIdentity('topic').art,writingFeatureIdentities.idea.art);
});
