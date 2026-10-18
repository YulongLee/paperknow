import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const oldSHA='1'.repeat(40),sha='2'.repeat(40),marker='.paperknow-build-success';

// Run the real release control flow only against private temporary directories.
// Git, systemd, ownership changes and npm are replaced before the script starts;
// no server, application build, package installation or real deployment runs.
function fixture(t,{mode='success',failStep}={}){
 const base=mkdtempSync(join(tmpdir(),'paperknow-release-gate-'));
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 for(const name of ['bin','runtime','source','ops','builds','build-home','releases'])mkdirSync(join(base,name));
 copyFileSync(new URL('../deploy/release.sh',import.meta.url),join(base,'ops','release.sh'));
 const executable=(name,body)=>writeFileSync(join(base,name),'#!/bin/bash\nset -euo pipefail\n'+body,{mode:0o700});
 writeFileSync(join(base,'mode'),mode);
 if(failStep)writeFileSync(join(base,'npm-fail-step'),failStep);
 writeFileSync(join(base,'source','application.txt'),'Only a synthetic release fixture.');
 writeFileSync(join(base,'ops','deploy-common.sh'),String.raw`
die() { printf '%s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*" >> "$BASE/events"; }
prepare() {
 BASE=$PAPERKNOW_TEST_BASE
 RELEASES=$BASE/releases
 BUILD_HOME=$BASE/build-home
 RUNTIME=$BASE/runtime
 BUILD_USER=synthetic-build-user
 PREVIOUS=$RELEASES/$PAPERKNOW_TEST_OLD_SHA
}
git_repo() {
 case "$1" in
  rev-parse) printf '%s\n' "$3" | cut -d'^' -f1 ;;
  show-ref|merge-base) return 0 ;;
  archive) tar -cf - -C "$BASE/source" . ;;
  *) die 'Unexpected synthetic Git operation' ;;
 esac
}
as_builder() { "$@"; }
validate_release() { [[ -d "$1" && ! -L "$1" ]] || die 'Invalid synthetic release'; }
healthy() { return 0; }
backup() { printf 'backup\n' >> "$BASE/events"; }
activate() { printf 'activate %s\n' "$1" >> "$BASE/events"; }
`);
 executable('bin/chown','exit 0\n');executable('bin/chmod','exit 0\n');
 executable('bin/mv','if [[ "$1" == -T ]]; then shift; fi\nexec /bin/mv "$@"\n');
 executable('runtime/npm',String.raw`
printf '%s\n' "$*" >> "$HOME/../npm.log"
if [[ -f "$HOME/../npm-fail-step" && $(cat "$HOME/../npm-fail-step") == "$*" ]]; then exit 143; fi
`);
 executable('bin/systemd-run',String.raw`
base=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
printf 'called\n' >> "$base/systemd.log"
workdir=
for arg in "$@"; do
 case "$arg" in --property=WorkingDirectory=*) workdir=$(printf '%s' "$arg" | cut -d= -f3-) ;; esac
done
[[ -n "$workdir" ]]
while (( $# )) && [[ "$1" != /usr/bin/env ]]; do shift; done
[[ "$1" == /usr/bin/env ]]
cd -- "$workdir"
case $(cat "$base/mode") in
 success) exec "$@" ;;
 masked-failure) "$@" || true; exit 0 ;;
 interrupted) printf 'partial build output\n' > partial.txt; exit 0 ;;
 stale) printf '%040d\n' 0 > .paperknow-build-success; exit 0 ;;
 extra-data) printf '%s\n\n' "$PAPERKNOW_TEST_SHA" > .paperknow-build-success; exit 0 ;;
 symlink) printf '%s\n' "$PAPERKNOW_TEST_SHA" > "$base/forged-success"; ln -s "$base/forged-success" .paperknow-build-success; exit 0 ;;
 *) exit 97 ;;
esac
`);
 const target=join(base,'releases',sha);
 const run=()=>spawnSync('/bin/bash',[join(base,'ops','release.sh'),'--ref',sha],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:join(base,'bin')+':'+process.env.PATH,PAPERKNOW_TEST_BASE:base,PAPERKNOW_TEST_OLD_SHA:oldSHA,PAPERKNOW_TEST_SHA:sha}});
 const events=()=>existsSync(join(base,'events'))?readFileSync(join(base,'events'),'utf8'):'';
 const prepared=content=>{mkdirSync(target);writeFileSync(join(target,'.paperknow-commit'),sha+'\n');if(content!==undefined)writeFileSync(join(target,marker),content);};
 return {base,target,run,events,prepared};
}

function assertNotActivated(f,result){
 assert.equal(result.signal,null);assert.notEqual(result.status,0,result.stdout+'\n'+result.stderr);
 assert.doesNotMatch(f.events(),/^backup$|^activate /m);
}

test('release installs and activates only after every required command writes matching success metadata',t=>{
 const f=fixture(t),result=f.run();
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.deepEqual(readFileSync(join(f.base,'npm.log'),'utf8').trim().split('\n'),['ci --no-audit --no-fund','run build','run check','test','prune --omit=dev --no-audit --no-fund']);
 assert.equal(readFileSync(join(f.target,marker),'utf8'),sha+'\n');
 assert.equal(readFileSync(join(f.target,'.paperknow-commit'),'utf8'),sha+'\n');
 assert.match(f.events(),new RegExp('^activate '+f.target+'$','m'));
});

test('an interrupted build cannot activate even if systemd-run incorrectly reports successful stopping',t=>{
 const f=fixture(t,{mode:'interrupted'}),result=f.run();assertNotActivated(f,result);
 assert.match(result.stderr,/Build did not finish successfully/);assert.equal(existsSync(f.target),false);
});

for(const failStep of ['ci --no-audit --no-fund','run build','run check','test','prune --omit=dev --no-audit --no-fund']){
 test(`a masked failure of npm ${failStep} cannot create a successful release`,t=>{
  const f=fixture(t,{mode:'masked-failure',failStep}),result=f.run();assertNotActivated(f,result);
  assert.match(result.stderr,/Build did not finish successfully/);assert.equal(existsSync(f.target),false);
  assert.equal(readFileSync(join(f.base,'npm.log'),'utf8').trim().split('\n').at(-1),failStep);
 });
}

for(const mode of ['stale','extra-data','symlink']){
 test(`release rejects ${mode} build metadata despite a successful service exit`,t=>{
  const f=fixture(t,{mode}),result=f.run();assertNotActivated(f,result);assert.equal(existsSync(f.target),false);
 });
}

test('source cannot supply a pre-forged success marker for a build that never completes',t=>{
 const f=fixture(t,{mode:'interrupted'});writeFileSync(join(f.base,'source',marker),sha+'\n');
 const result=f.run();assertNotActivated(f,result);assert.match(result.stderr,/reserved build success metadata/);
 assert.equal(existsSync(join(f.base,'systemd.log')),false);assert.equal(existsSync(f.target),false);
});

test('prepared releases lacking a matching successful-build marker cannot be reused',t=>{
 for(const content of [undefined,oldSHA+'\n',sha+'\n\n']){
  const f=fixture(t);f.prepared(content);const result=f.run();assertNotActivated(f,result);
  assert.equal(existsSync(join(f.base,'systemd.log')),false);
 }
});

test('a prepared immutable release can be reused when both commit and success marker match exactly',t=>{
 const f=fixture(t);f.prepared(sha+'\n');const result=f.run();
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.equal(existsSync(join(f.base,'systemd.log')),false);
 assert.match(f.events(),/^Reusing prepared immutable release /m);assert.match(f.events(),/^activate /m);
});
