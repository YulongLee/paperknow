import {PassThrough,Readable} from 'node:stream';
export function providerFixture({usage={input_tokens:10,output_tokens:20},stopReason='tool_use',id='provider-fixture',contentType='application/json',chunks,status=200}={}){
 const calls=[];
 const requestImpl=(options,callback)=>{const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{calls.push({options,body:JSON.parse(Buffer.concat(parts))});const data=JSON.stringify({id,type:'message',role:'assistant',content:[],stop_reason:stopReason,usage});const response=Readable.from(chunks||[data]);response.statusCode=status;response.headers={'content-type':contentType};callback(response);});return request;};
 return{calls,requestImpl};
}
export async function primeProvider(options,{stream=false}={}){
 const response=await fetch(options.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':options.env.ANTHROPIC_API_KEY},body:JSON.stringify({model:options.model,max_tokens:32,stream,tools:[{name:'mcp__paperknow__read_material',input_schema:{type:'object'}},{name:'mcp__paperknow__submit_writing_output',input_schema:{type:'object'}}],messages:[{role:'user',content:'Controlled provider fixture.'}]})});
 await response.text();if(!response.ok)throw Error('Controlled relay status '+response.status);
}
