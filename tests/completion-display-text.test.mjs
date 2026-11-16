import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleCompletionSources} from '../dist/workspace/completion-display-text.mjs';

test('internal citation review statuses are presented in plain language without changing source quotations',()=>{
 const uncertain='本次逐引用检查将 reference:123e4567-e89b-12d3-a456-426614174000 标为 uncertain 且尚未在已核对范围内定位可核对摘录。';
 assert.equal(visibleCompletionSources(uncertain),'相关资料的引用尚需核对 且尚未在已核对范围内定位可核对摘录。');
 assert.equal(visibleCompletionSources(uncertain,[{id:'reference:123e4567-e89b-12d3-a456-426614174000',title:'真实文献'}]),'《真实文献》的引用尚需核对 且尚未在已核对范围内定位可核对摘录。');
 assert.match(visibleCompletionSources('本次逐引用检查将 相关资料 标为 supported 并给出摘录。'),/相关资料的引用已有依据/);
 assert.match(visibleCompletionSources('逐引用检查将 相关资料 标为 unsupported，需进一步核对。'),/相关资料的引用未找到依据/);
 const quoted='The claim is supported by the reported experiment.';assert.equal(visibleCompletionSources(quoted),quoted);
});
