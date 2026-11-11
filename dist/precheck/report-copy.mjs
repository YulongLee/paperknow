// Product copy only. Original documents, evidence and diagnostic data are never rewritten.
export const similarityScopeNotice='结果基于本次实际纳入的比对资料，仅供自查参考。未发现匹配不代表不存在重复，不保证覆盖全部文献，不替代学校或机构指定的检测报告。';
export const similarityLimitedNotice='本次检测范围受限，部分资料可能未能纳入比对，结果可能不完整；请结合原文与来源对照核对。';
export function similaritySourceCoverageNotice(web={}){
 const sampled=web?.sampledParagraphs,total=web?.totalParagraphs,queries=web?.queries;
 return (Number.isFinite(sampled)&&Number.isFinite(total)&&total>0)||(Number.isFinite(queries)&&queries>0)?'本次根据正文部分内容查找资料，全文仅与取得的资料比对；未发现匹配不能说明不存在相似内容。':'';
}
