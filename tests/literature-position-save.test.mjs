import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingPositionSaver} from '../dist/workspace/literature-position-save.mjs';

test('rapid page changes are saved once, with the latest page',()=>{
 const jobs=new Map(),saved=[];let next=0;
 const saver=createReadingPositionSaver({save:position=>saved.push(position),setTimer:fn=>{jobs.set(++next,fn);return next;},clearTimer:id=>jobs.delete(id)});
 saver.schedule({pdfPage:2});saver.schedule({pdfPage:3});saver.schedule({pdfPage:8});
 assert.equal(jobs.size,1);assert.deepEqual(saved,[]);
 [...jobs.values()][0]();assert.deepEqual(saved,[{pdfPage:8}]);
});

test('leaving the reader flushes the last page once and cancels the timer',()=>{
 const jobs=new Map(),saved=[];let next=0;
 const saver=createReadingPositionSaver({save:position=>saved.push(position),setTimer:fn=>{jobs.set(++next,fn);return next;},clearTimer:id=>jobs.delete(id)});
 saver.schedule({pdfPage:4});saver.flush();saver.flush();
 assert.deepEqual(saved,[{pdfPage:4}]);assert.equal(jobs.size,0);
});
