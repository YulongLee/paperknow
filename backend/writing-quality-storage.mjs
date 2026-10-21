// Optional reports must never consume space needed for an otherwise saveable
// manuscript. Every candidate is checked by the caller's original quota guard.
export function fitOptionalWritingQuality(quality,{build,check}){
 const compact={status:'unavailable',reasonCode:'storage_limit',limitations:['检查报告未完整保存：账户空间不足。正文已保留，请人工核对事实、引用和研究结果。']};
 const candidates=quality?[quality,compact,null]:[null];let lastError;
 for(const candidate of candidates){
  const value=build(candidate);
  try{check(value,candidate);return {quality:candidate,value};}catch(error){if(error?.status!==413)throw error;lastError=error;}
 }
 throw lastError;
}
