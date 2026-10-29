import test from 'node:test';
import assert from 'node:assert/strict';
import {formatFixture,until,exampleDocx} from './fixtures/format-ui.mjs';
import {installStoredFilePickers} from '../dist/workspace/file-picker.mjs';
import {installUploadPresentation} from '../dist/workspace/upload-presentation.mjs';

test('paper may be uploaded first, and both accessible upload cards keep independent cloud actions without duplicate native widgets',async t=>{
 const f=await formatFixture(t),uploads=installUploadPresentation(f.root),picker=installStoredFilePickers(f.root);t.after(()=>{uploads.dispose();picker.dispose();});
 const original=await exampleDocx();await f.upload('paper',original);assert.equal(f.$('[data-format-workflow]').dataset.currentStep,'1');assert.equal(f.$('[data-action="apply"]').disabled,true);assert.ok(f.getRows()[0].formatting.original);
 await f.upload('template',original);await until(()=>f.root.querySelectorAll('.stored-file-trigger').length===2);
 for(const kind of ['template','paper']){const card=f.$('[data-format-file-card="'+kind+'"]');assert.equal(card.querySelectorAll('.stored-file-trigger').length,1);assert.equal(card.querySelector('.stored-file-trigger').closest('label'),null);assert.equal(card.querySelectorAll('.pk-file-control').length,0);assert.equal(card.querySelector('input').disabled,false);}
 assert.equal(f.$('[data-action="apply"]').disabled,false);assert.equal(f.calls.length,0);
});
