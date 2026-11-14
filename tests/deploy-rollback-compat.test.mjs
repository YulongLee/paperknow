import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const previous='1'.repeat(40),target='2'.repeat(40);
function fixture(t,{reference=false,compatible=false,corrupt=false}={}){
 const base=mkdtempSync(join(tmpdir(),'pk-rollback-check-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 for(const part of ['ops','releases','bin'])mkdirSync(join(base,part));for(const sha of [previous,target])mkdirSync(join(base,'releases',sha));
 const database=join(base,'synthetic.sqlite'),db=new DatabaseSync(database);db.exec('CREATE TABLE workspace_drafts(tool TEXT,payload TEXT)');if(reference)db.prepare('INSERT INTO workspace_drafts VALUES(?,?)').run('analysis',JSON.stringify({analysisState:{datasetReference:{fileName:'synthetic.csv'}}}));if(corrupt)db.prepare('INSERT INTO workspace_drafts VALUES(?,?)').run('analysis','invalid');db.close();
 if(compatible){const dir=join(base,'releases',target,'deploy','features');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'analysis-dataset-reference-v1'),'paperknow-analysis-dataset-reference-v1\n');}
 const common=readFileSync(new URL('../deploy/deploy-common.sh',import.meta.url),'utf8'),match=common.match(/rollback_compatible\(\) \{[\s\S]*?\n\}/);assert.ok(match);
 const guard=match[0].replace('/var/lib/paperknow/paperknow.sqlite',database);
 const stub=`set -Eeuo pipefail\nBASE=${JSON.stringify(base)}\nRELEASES="$BASE/releases"\nPREVIOUS="$RELEASES/${previous}"\nROLLBACK_STOPPED=0\ndie(){ printf '%s\\n' "$*" >&2; exit 1; }\nlog(){ :; }\nprepare(){ trap 'if (( $? != 0 && ROLLBACK_STOPPED == 1 )); then systemctl start paperknow.service; fi' EXIT; }\nvalidate_release(){ [[ -d "$1" ]]; }\nhealthy(){ return 0; }\nbackup(){ printf 'backup\\n' >> "$BASE/events"; }\nactivate(){ printf 'activate\\n' >> "$BASE/events"; }\nsystemctl(){ printf '%s\\n' "$1" >> "$BASE/events"; }\n${guard}\n`;
 writeFileSync(join(base,'ops','deploy-common.sh'),stub);copyFileSync(new URL('../deploy/rollback.sh',import.meta.url),join(base,'ops','rollback.sh'));
 const run=()=>spawnSync('/bin/bash',[join(base,'ops','rollback.sh'),'--release',target],{encoding:'utf8',timeout:10000}),events=()=>{try{return readFileSync(join(base,'events'),'utf8').trim().split('\n');}catch{return [];}};return {base,run,events};
}
test('rollback to an old version is allowed without reference-based analysis drafts',t=>{const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(f.events(),['stop','backup','activate']);});
test('rollback to an old version is refused for reference-based analysis drafts and restarts the current service',t=>{const f=fixture(t,{reference:true}),r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Rollback blocked/);assert.deepEqual(f.events(),['stop','start']);});
test('rollback to a marked compatible version permits reference-based analysis drafts',t=>{const f=fixture(t,{reference:true,compatible:true}),r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(f.events(),['stop','backup','activate']);});
test('corrupt analysis data fails closed when target compatibility is unknown',t=>{const f=fixture(t,{corrupt:true}),r=f.run();assert.notEqual(r.status,0);assert.deepEqual(f.events(),['stop','start']);});

for(const reference of [false,true])test(`automatic failure recovery ${reference?'blocks an incompatible target':'restores a compatible database'} after stopping service`,t=>{
 const f=fixture(t,{reference}),common=readFileSync(new URL('../deploy/deploy-common.sh',import.meta.url),'utf8'),match=common.match(/finish\(\) \{[\s\S]*?\n\}/);assert.ok(match);
 const db=join(f.base,'synthetic.sqlite'),guard=common.match(/rollback_compatible\(\) \{[\s\S]*?\n\}/)[0].replace('/var/lib/paperknow/paperknow.sqlite',db);
 const script=`set -Eeuo pipefail\nBASE=${JSON.stringify(f.base)}\nPREVIOUS="$BASE/releases/${target}"\nSWITCHED=1\nROLLBACK_STOPPED=0\nBUILD_UNIT=\nBUILD_DIR=\nINCOMING=\nsystemctl(){ printf '%s\\n' "$1" >> "$BASE/events"; }\natomic_link(){ printf 'link\\n' >> "$BASE/events"; }\nhealthy(){ return 0; }\n${guard}\n${match[0]}\ntrap finish EXIT\nexit 1\n`;
 const r=spawnSync('/bin/bash',['-c',script],{encoding:'utf8',timeout:10000});assert.notEqual(r.status,0);if(reference){assert.match(r.stderr,/automatic rollback blocked/);assert.deepEqual(f.events(),['stop']);}else assert.deepEqual(f.events(),['stop','link','start']);
});
