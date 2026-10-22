import test from 'node:test';
import assert from 'node:assert/strict';
import {createAigcDetectionClient,normalizeAigcResponse} from '../backend/aigc-detection-client.mjs';

const configured={aigcDetectionEnabled:true,moderationAccessKeyId:'synthetic-client-id',moderationAccessKeySecret:'synthetic-client-secret'};
const response=result=>({statusCode:200,body:{Code:200,Data:{Result:result},RequestId:'synthetic-internal-trace'}});
const invalid=error=>{assert.equal(error.status,502);assert.equal(error.code,'aigc_detection_unavailable');assert.equal(error.aigcDetectionSafe,true);assert.equal(error.aigcRequestId,'synthetic-internal-trace');assert.doesNotMatch(error.message,/synthetic|Confidence|Result|stack/);return true;};

test('only the documented explicit nonLabel is an inconclusive provider result',()=>{
 assert.deepEqual(normalizeAigcResponse(response([{Label:'nonLabel'}])),{label:'undetermined',confidence:null,requestId:'synthetic-internal-trace'});
 for(const label of ['aigc','ugc'])for(const confidence of [0,100])assert.deepEqual(normalizeAigcResponse(response([{Label:label,Confidence:confidence}])),{label,confidence,requestId:'synthetic-internal-trace'});
 for(const rows of [undefined,null,{},[],[null],[{}],[{Label:'undetermined'}],[{Label:'futureLabel',Confidence:80}],[{Label:'nonLabel',Confidence:0}],[{Label:'nonLabel',Confidence:null}],[{Label:'aigc'}],[{Label:'ugc',Confidence:Infinity}],[{Label:'aigc',Confidence:90},{Label:'ugc',Confidence:10}]])assert.throws(()=>normalizeAigcResponse(response(rows)),invalid);
});

test('a malformed successful HTTP response fails once and cannot masquerade as a delivered result',async()=>{
 let calls=0;
 const client=createAigcDetectionClient(configured,{client:{async callApi(){calls++;return response([]);}}});
 await assert.rejects(client.detect('仅供合成测试的正文'),invalid);
 assert.equal(calls,1);
});
