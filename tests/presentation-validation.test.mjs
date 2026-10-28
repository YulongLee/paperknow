import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationValidationRecord} from '../backend/presentation-validation.mjs';

test('presentation diagnostic records keep only controlled locations and bounded counts',()=>{
 const feedback={code:'invalid_tool_output',rule:'private manuscript secret-token',presentation:{code:'ppt_field',page:9,field:'notes',maxCharacters:120,minCharacters:0,actualCharacters:121,body:'private rejected content',apiKey:'private key'}};
 assert.deepEqual(presentationValidationRecord({feedback},{phase:'planning',unitId:'unit-1'}),{phase:'planning',code:'ppt_field',unitId:'unit-1',page:9,maxCharacters:120,minCharacters:0,actualCharacters:121,field:'notes'});
 const unsafe=presentationValidationRecord({feedback:{rule:'private manuscript',presentation:{code:'secret',page:Infinity,firstPage:-1,lastPage:100001,field:'private',missingReads:[{id:'private',text:'private'}]}}},{phase:'private',unitId:'private'});
 assert.deepEqual(unsafe,{phase:'planning',code:'ppt_contract',missingReadCount:1});assert.doesNotMatch(JSON.stringify(unsafe),/private|Infinity/);
 assert.deepEqual(presentationValidationRecord({feedback:{rule:'分组重叠'}},{phase:'authoring',unitId:'design-slide-12'}),{phase:'authoring',code:'ppt_layout_overlap',unitId:'design-slide-12'});
});

test('layout role and immutable-content failures retain distinct safe diagnostic categories',()=>{
 for(const [rule,code]of [['PPT Master 页面角色与设计计划不一致','ppt_layout_role'],['PPT Master 不得修改已接受的标题、正文或备注','ppt_semantic_integrity'],['PPT Master 页面结果结构不正确','ppt_output_schema']])assert.equal(presentationValidationRecord({feedback:{rule}},{phase:'authoring',unitId:'design-slide-1'}).code,code);
});
