import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {runAgent} from '../backend/agent.mjs';

const academicText='本研究比较 Claude、GPT 与 Qwen 的模型性能，引用 OpenAI 和 Anthropic 的公开论文。';
const identityPrompt=prompt=>{
  assert.match(prompt,/PaperKnow AI 助手/);
  assert.match(prompt,/不披露.*底层模型名称、供应商、引擎、版本、接口地址或部署配置/);
  assert.match(prompt,/不得声称底层模型为自行研发/);
  assert.match(prompt,/不得删除、替换或隐瞒用户论文/);
  assert.match(prompt,/AI 辅助生成、需要用户核对/);
};

test('configured SDK keeps private execution settings while presenting the product identity and preserving research text',async()=>{
  let captured;
  const result=await runAgentTask({
    settings:{enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com',apiKey:'fixture-only',model:'private-deployment-model',maxTurns:2,timeoutMs:5000,maxOutputTokens:128,maxCostUsd:0.1},
    task:{skill:'thesis-section',instructions:'只分析用户研究内容。',context:{title:academicText},materials:[]},
    dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],query:args=>{
      captured=args;
      return(async function*(){yield {type:'result',subtype:'success',is_error:false,result:academicText,stop_reason:'end_turn',total_cost_usd:0.001,modelUsage:{fixture:{inputTokens:5,outputTokens:4}},permission_denials:[]};})();
    }}
  });
  identityPrompt(captured.options.systemPrompt);
  assert.equal(captured.options.model,'private-deployment-model');
  assert.ok(captured.prompt.includes(academicText));
  assert.equal(result.text,academicText);
  assert.equal(result.engine,'claude-agent-sdk');
});

test('legacy agent uses the same public identity without changing internal model choice or research output',async()=>{
  let capturedOptions,capturedInput;
  class FixtureAgent{
    constructor(options){capturedOptions=options;}
    startThread(options){
      assert.equal(options.model,'private-legacy-model');
      return {async runStreamed(input){capturedInput=input;return {events:(async function*(){
        yield {type:'item.completed',item:{type:'agent_message',text:academicText}};
        yield {type:'turn.completed',usage:{input_tokens:5,output_tokens:4}};
      })()};}};
    }
  }
  const result=await runAgent({ai:{aiURL:'https://provider.example.com/v1/chat/completions',aiKey:'fixture-only',aiModel:'private-legacy-model'},input:{text:academicText},materials:[],signal:new AbortController().signal,CodexClass:FixtureAgent});
  identityPrompt(capturedOptions.config.developer_instructions);
  assert.ok(capturedInput.includes(academicText));
  assert.equal(result.body.suggestion,academicText);
  assert.equal(result.body.model,'private-legacy-model');
});
