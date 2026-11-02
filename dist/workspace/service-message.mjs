// Use only for service-owned status/error messages, never manuscript content,
// filenames, research quotes, source titles or user-authored feedback.
const diagnostic=/(?:\b(?:mineru|claude|anthropic|openai|deepseek|qwen|dashscope|bailian|gemini|codex|sdk|sqlite|sqlstate|traceback|stacktrace)\b|\bgpt[-\s]?\d|智谱|豆包|\b(?:qwen|claude|gemini)[-_ ]?\d|百炼|千问|通义|阿里云|aliyun[_ -]?oss|\bOSS\b|Model\.[A-Za-z]+|\b(?:api[-_ ]?key|accessKeySecret|baseURL|maxCostUsd|maxBudgetUsd|maxTurns|maxOutputTokens|maxTotalTokens|provider_batch_id|sealed_settings)\b|(?:ANTHROPIC|OPENAI|PK_AI|PK_AGENT)_|\bsk-[a-z0-9_-]{16,}|https?:\/\/\S+|(?:^|\s)\/(?:opt|var|Users|home|tmp)\/|\bat\s+[\w.$]+\s*\([^\n]+:\d+:\d+\))/i;
const execution=/(?:\b(?:token[s]?|max_tokens|max_turns|context_length|tool_use|tool_result)\b.*(?:预算|上限|limit|budget|exceed|invalid)|(?:预算|上限|limit|budget|exceed).*\btoken[s]?\b|(?:未授权|未允许|不支持|异常|失败).*工具|工具(?:调用|协议|权限)|(?:模型|Agent).*(?:配置|权限|接口|版本)|后台.*(?:模型|Agent|连接配置)|环境变量|提示词工程|系统提示词|(?:密钥|凭据|服务配置|接口配置|数据库|对象存储|签名校验|鉴权)|内部错误码|本次执行预算|系统处理上限|单次执行保护)/i;
export function serviceMessage(value,{fallback='本次处理暂未完成，请稍后重试；已保存的内容会保留。',identityValues=[]}={}){
 if(typeof value!=='string')return value;
 if(!value.trim())return value;
 if(identityValues.some(identity=>typeof identity==='string'&&identity.length>=3&&value.toLowerCase().includes(identity.toLowerCase()))||diagnostic.test(value)||execution.test(value)){
  // Preserve only outcomes explicitly present in the service response. A
  // failure alone never implies that a charge has already been released.
  const notes=[];
  if(/原提纲保留/.test(value))notes.push('原提纲已保留。');
  if(/预占(?:权益)?已释放/.test(value))notes.push('预占已释放。');
  else if(/预占(?:权益)?将(?:自动)?释放/.test(value))notes.push('预占将释放。');
  if(/本次不扣积分或套餐次数/.test(value))notes.push('本次不扣积分或套餐次数。');
  return [fallback,...notes].join('');
 }
 if(/Failed to fetch|NetworkError|fetch failed|Load failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(value))return '网络连接暂时中断，请检查网络后重试。';
 if(/Unexpected token|not valid JSON|JSON\.parse|SyntaxError|TypeError|ReferenceError|^\[object (?:Object|Error)\]$/i.test(value))return fallback;
 if(/上游/.test(value))return /取消|停止/.test(value)?'已停止处理。已保存的文件仍保留在账户中。':fallback;
 return value.replace(/模型服务/g,'AI 服务').replace(/\bAgent\b/g,'AI');
}
