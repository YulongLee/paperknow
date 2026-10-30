import {v1ExtraServices} from './v1-pricing.mjs';
import {writingBillingServiceTypes} from './writing-billing-catalog.mjs';
// Public service identifiers. Prices and availability come from the server.
export const toolBillingServiceTypes=Object.freeze([
 ['literature-read','文献解读','文献研读'],['literature-answer','原文问答','文献研读'],['literature-translate','文献翻译','文献研读'],
 ['revision-reduce','降重复率','论文修改'],['revision-aigc','降 AI 率','论文修改'],['revision-dual','AIGC 与重复率双降','论文修改'],
 ['presentation-ai','AI PPT','PPT 创作'],['presentation-proposal','开题 PPT','PPT 创作'],['presentation-thesis','毕业 PPT','PPT 创作'],
 ['research-image','AI 科研绘图','科研工具'],['research-chart','科研图表配置','科研工具'],['research-diagram','科研结构示意图','科研工具'],['research-formula','公式辅助','科研工具'],
 ['format-advice','格式建议','格式排版']
].map(([key,title,group])=>Object.freeze({key,title,group})).concat(v1ExtraServices.map(({key,title,group})=>Object.freeze({key,title,group})),writingBillingServiceTypes,[Object.freeze({key:'detection-similarity',title:'论文重复率检测',group:'论文检测'}),Object.freeze({key:'detection-aigc',title:'论文 AI 率检测',group:'论文检测'})]));
