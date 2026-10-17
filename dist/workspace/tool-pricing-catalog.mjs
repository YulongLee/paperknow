// Public service identifiers. Prices and availability come from the server.
export const toolBillingServiceTypes=Object.freeze([
 ['literature-read','文献解读','AI 研读'],['literature-answer','原文问答','AI 研读'],['literature-translate','文献翻译','AI 研读'],
 ['revision-reduce','降重复率','论文修改'],['revision-aigc','降 AI 率','论文修改'],['revision-dual','AIGC 与重复率双降','论文修改'],
 ['presentation-ai','AI PPT','PPT 创作'],['presentation-proposal','开题 PPT','PPT 创作'],['presentation-thesis','毕业 PPT','PPT 创作'],
 ['research-chart','科研图表配置','科研工具'],['research-diagram','科研结构示意图','科研工具'],['research-formula','公式辅助','科研工具'],
 ['format-advice','格式建议','格式排版']
].map(([key,title,group])=>Object.freeze({key,title,group})));
