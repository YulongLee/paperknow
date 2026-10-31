import test from 'node:test';
import assert from 'node:assert/strict';
import {researchImagePrompt} from '../backend/research-image-client.mjs';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {scientificFigureStyle} from '../backend/research-image-scientific-style.mjs';

test('all catalogue scenes retain their own subject and scientific integrity constraints',()=>{
 let count=0;
 for(const mode of ['basic','professional'])for(const choice of researchFigureChoices(mode)){
  const brief='作者输入：A→B；观测值为0.125。不得更改。';
  const prompt=researchImagePrompt({title:'test',mode,text:brief,language:'中文',context:{categoryId:choice.categoryId,figureType:choice.id,palette:'academic',aspectRatio:'4:3'}});
  assert.ok(prompt.includes(choice.sceneLabel||choice.label),choice.id);
  assert.ok(prompt.includes(brief),choice.id);
  assert.match(prompt,/未给出观测值时不得添加统计结论/);
  assert.match(prompt,/不要把排版指令印在图片里/);
  count++;
 }
 assert.equal(count,301);
});
test('save names and software brands are not supplied as text to render',()=>{
 const snapshot={title:'PRIVATE_SAVE_NAME_924',mode:'professional',text:'Vin connects through R to Vout. C connects Vout to GND.',language:'English',context:{categoryId:'electronics',figureType:'altium-designer-04',palette:'academic',aspectRatio:'4:3'}};
 const prompt=researchImagePrompt(snapshot);
 assert.equal(prompt.includes(snapshot.title),false);
 assert.equal(prompt.includes('Altium Designer'),false);
 assert.match(prompt,/Use English for all labels/);
 assert.match(prompt,/Use only the labels requested by the author/);
});
test('the sampled complex diagrams include their defining visual grammar',()=>{
 const basic=researchFigureChoices('basic'),find=id=>scientificFigureStyle(basic.find(c=>c.id===id));
 assert.match(find('chord'),/带状和弦/);
 assert.match(find('chord'),/无权重时用等宽带/);
 assert.match(find('sunburst'),/父扇区的角度范围/);
 assert.match(find('sequence'),/失败分支/);
 assert.match(find('state'),/重试边回到等待状态/);
});
test('spatial scenes permit necessary shading while geography and circuits keep evidence constraints',()=>{
 const examples=researchFigureChoices('professional');
 for(const id of ['envi-03','altium-designer-04','3ds-max-04'])assert.ok(examples.some(c=>c.id===id));
 assert.match(scientificFigureStyle(examples.find(c=>c.id==='envi-03')),/仅画处理流程/);
 assert.match(scientificFigureStyle(examples.find(c=>c.id==='altium-designer-04')),/极性、供电和地连接一致/);
 assert.match(scientificFigureStyle(examples.find(c=>c.id==='3ds-max-04')),/仅在表达结构时使用轻微明暗/);
});
