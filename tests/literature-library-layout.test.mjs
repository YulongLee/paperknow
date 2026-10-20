import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../dist/workspace/literature-research-refresh.css',import.meta.url),'utf8');
const table='.dashboard .lit-workspace-refresh .lit-table.lit-table-selectable';
function rule(selector){const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),matches=[...css.matchAll(new RegExp(escaped+'\\{([^{}]*)\\}','g'))];assert.ok(matches.length,'Missing scoped layout rule: '+selector);return matches.at(-1)[1];}
const px=(body,name)=>Number(body.match(new RegExp('(?:^|;)'+name+':(\\d+)px(?:;|$)'))?.[1]);

test('five-column library reserves readable action and status columns instead of competing percentage widths',()=>{
 const minimum=px(rule(table),'min-width'),widths=[px(rule(table+' th:first-child'),'width'),px(rule(table+' th:nth-child(3)'),'width'),px(rule(table+' th:nth-child(4)'),'width'),px(rule(table+' th:last-child'),'width')];
 assert.equal(minimum,980);assert.deepEqual(widths,[52,132,116,244]);assert.ok(minimum-widths.reduce((a,b)=>a+b,0)>=400,'Bibliography keeps a usable text column at minimum width');assert.match(rule(table+' th:nth-child(2)'),/width:auto/);assert.match(rule(table),/table-layout:fixed/);assert.match(rule('.lit-table-scroll'),/overflow-x:auto/);
 for(const [selector,display] of [[table,'table'],[table+' thead','table-header-group'],[table+' tbody','table-row-group'],[table+' tr','table-row'],[table+' :is(th,td)','table-cell']])assert.match(rule(selector),new RegExp('(?:^|;)display:'+display+'(?:;|$)'));
 assert.match(rule(table+' th'),/white-space:nowrap/);assert.match(rule(table+' :is(.lit-scope,.lit-state,.lit-actions)'),/white-space:nowrap/);assert.match(rule(table+' .lit-actions'),/flex-wrap:nowrap/);assert.match(rule(table+' [data-lit-citation]'),/width:auto;min-width:76px/);
});

test('review entry has desktop and compact padding scoped above shared card styles',()=>{
 const selector='.dashboard .lit-workspace-refresh .lit-review-entry',escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rules=[...css.matchAll(new RegExp(escaped+'\\{([^{}]*)\\}','g'))].map(match=>match[1]);
 assert.equal(px(rules[0],'padding'),20);assert.equal(px(rules.at(-1),'padding'),16);assert.match(rules.at(-1),/flex-direction:column/);
});
