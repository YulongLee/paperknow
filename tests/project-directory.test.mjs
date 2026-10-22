import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';

let instance=0;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const response=(items,status=200)=>({ok:status>=200&&status<300,status,json:async()=>status>=400?{error:'目录读取失败'}:{items}});
const header=(options,name)=>typeof options?.headers?.get==='function'?options.headers.get(name):Object.entries(options?.headers||{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
async function settle(check,message='project picker did not settle'){
 for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,4));}
 throw Error(message);
}
async function fixture(t,{html='<main id="root"></main>',fetch}={}){
 const dom=new JSDOM(html,{url:'https://paperknow.cn/workspace.html#tool/proposal',pretendToBeVisual:true});
 const w=dom.window,globals={window:w,document:w.document,localStorage:w.localStorage,MutationObserver:w.MutationObserver,CustomEvent:w.CustomEvent,Event:w.Event,HTMLElement:w.HTMLElement,HTMLSelectElement:w.HTMLSelectElement,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),fetch:fetch||(async()=>response([]))};
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 endDraftScope();
 const directory=await import(`../dist/workspace/project-directory.mjs?directory-test=${++instance}`);
 const disposers=[];
 t.after(()=>{
  for(const dispose of disposers)dispose();
  directory.setProjectDirectorySession(null);
  endDraftScope();w.close();
  for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 return{w,document:w.document,root:w.document.querySelector('#root'),directory,install(options){const dispose=directory.installProjectPickers(w.document.querySelector('#root'),options);if(typeof dispose==='function')disposers.push(dispose);return dispose;}};
}

test('account references encode owner and project independently and cannot cross an account boundary',async t=>{
 const{directory:d}=await fixture(t),owner='owner:a/研究者',id='paper/alpha:二';
 const reference=d.projectReference(owner,id);
 assert.equal(reference,`account:${encodeURIComponent(owner)}:${encodeURIComponent(id)}`);
 assert.equal(d.resolveAccountProjectId(reference,owner),id);
 assert.throws(()=>d.resolveAccountProjectId(reference,'another-owner'));
 assert.equal(d.resolveAccountProjectId('local-project',owner),null);
});

test('selection uses only account projects without rewriting historical browser records',async t=>{
 const{w,directory:d}=await fixture(t),local=[{id:'local-one',name:'本地研究项目',major:'教育学'}];
 w.localStorage.setItem('paperknow-projects',JSON.stringify(local));
 d.setProjectDirectorySession({id:'alice'});
 d.updateAccountProjects('alice',[{id:'account-one',title:'账户论文项目',degree:'硕士',stage:'writing'}]);
 const rows=d.selectableProjects();
 assert.deepEqual(rows.map(row=>[row.id,row.name,row.projectScope]),[[d.projectReference('alice','account-one'),'账户论文项目','account']]);
 assert.deepEqual(JSON.parse(w.localStorage.getItem('paperknow-projects')),local);
 assert.equal(d.resolveAccountProjectId('account-one','alice'),null,'an unencoded raw ID outside an account draft scope remains a local reference');
});

test('changing accounts clears the previous directory and rejects late direct updates from its former owner',async t=>{
 const{directory:d}=await fixture(t);
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'a1',title:'Alice项目'}]);
 d.setProjectDirectorySession({id:'bob'});
 assert.equal(d.selectableProjects().some(row=>row.name==='Alice项目'),false);
 d.updateAccountProjects('alice',[{id:'stale',title:'不得出现的旧账户项目'}]);
 d.updateAccountProjects('bob',[{id:'b1',title:'Bob项目'}]);
 const rows=d.selectableProjects();
 assert.equal(rows.some(row=>row.name.includes('Alice')||row.name.includes('不得出现')),false);
 assert.ok(rows.some(row=>row.id===d.projectReference('bob','b1')));
 d.setProjectDirectorySession(null);
 assert.equal(d.selectableProjects().some(row=>row.id.startsWith('account:')),false);
});

test('an account draft scope exposes only its fixed project rows and validates the in-memory owner',async t=>{
 const{w,directory:d}=await fixture(t);
 w.localStorage.setItem('paperknow-projects',JSON.stringify([{id:'local',name:'不能混入的本地项目'}]));
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'other',title:'不能混入的其他账户项目'}]);
 beginDraftScope({ownerId:'alice',projectRows:[{id:'scoped',name:'草稿所属项目'}]});
 assert.deepEqual(d.selectableProjects().map(row=>row.id),['scoped']);
 assert.equal(d.resolveAccountProjectId('scoped','alice'),'scoped');
 assert.throws(()=>d.resolveAccountProjectId('scoped','bob'));
 endDraftScope();
 assert.deepEqual(d.selectableProjects().map(row=>row.id),[d.projectReference('alice','other')]);
});

test('directory reads use the expected owner header and map the API title into a selectable name',async t=>{
 const calls=[];
 const{directory:d}=await fixture(t,{fetch:async(path,options)=>{calls.push({path,options});return response([{id:'p1',title:'真实目录题名'}]);}});
 d.setProjectDirectorySession({id:'owner-a'});
 await d.refreshAccountProjects({force:true});
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/projects');
 assert.equal(calls[0].options?.method||'GET','GET');
 assert.equal(header(calls[0].options,'X-PaperKnow-User'),'owner-a');
 assert.ok(d.selectableProjects().some(row=>row.name==='真实目录题名'&&row.id===d.projectReference('owner-a','p1')));
});

test('an old owner response resolving after the new account cannot repopulate its project picker',async t=>{
 const gates={alice:deferred(),bob:deferred()},calls=[];
 const{directory:d}=await fixture(t,{fetch:(path,options)=>{const owner=header(options,'X-PaperKnow-User');calls.push({path,owner});return gates[owner].promise;}});
 d.setProjectDirectorySession({id:'alice'});const old=d.refreshAccountProjects({force:true}).catch(()=>{});
 await settle(()=>calls.some(call=>call.owner==='alice'));
 d.setProjectDirectorySession({id:'bob'});const current=d.refreshAccountProjects({force:true});
 await settle(()=>calls.some(call=>call.owner==='bob'));
 gates.bob.resolve(response([{id:'b1',title:'新账户项目'}]));await current;
 gates.alice.resolve(response([{id:'a1',title:'过期账户项目'}]));await old;
 const rows=d.selectableProjects();
 assert.ok(rows.some(row=>row.id===d.projectReference('bob','b1')));
 assert.equal(rows.some(row=>row.name==='过期账户项目'||row.id===d.projectReference('alice','a1')),false);
});

test('installing account project options preserves the existing form, text, focus and restored project reference',async t=>{
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><form><input id="topic" value="正在输入的研究主题"><textarea id="notes">尚未提交的说明</textarea><select data-project-picker data-project-ref="account:alice:p1"><option value="">不关联项目</option></select></form></main>'});
 w.localStorage.setItem('paperknow-projects',JSON.stringify([{id:'local',name:'本地项目'}]));
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'账户项目'}]);
 const form=root.querySelector('form'),topic=root.querySelector('#topic'),notes=root.querySelector('#notes'),select=root.querySelector('select');topic.focus();install();
 await settle(()=>select.value===d.projectReference('alice','p1'));
 assert.equal(root.querySelector('form'),form);assert.equal(root.querySelector('#topic'),topic);assert.equal(topic.value,'正在输入的研究主题');assert.equal(notes.value,'尚未提交的说明');assert.equal(w.document.activeElement,topic);
 assert.equal(select.querySelector('optgroup'),null);
 assert.equal([...select.options].some(option=>option.value==='local'),false);
 d.updateAccountProjects('alice',[{id:'p1',title:'账户项目'},{id:'p2',title:'新建账户项目'}]);
 await settle(()=>[...select.options].some(option=>option.value===d.projectReference('alice','p2')));
 assert.equal(select.value,d.projectReference('alice','p1'));assert.equal(root.querySelector('form'),form);assert.equal(notes.value,'尚未提交的说明');
});

test('a picker inserted after installation receives current account options without replacing sibling inputs',async t=>{
 const{w,root,directory:d,install}=await fixture(t);
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'目录项目'}]);install();
 const input=w.document.createElement('input');input.value='保留的输入';root.append(input);input.focus();
 const select=w.document.createElement('select');select.dataset.projectPicker='';select.dataset.projectRef=d.projectReference('alice','p1');select.innerHTML='<option value="">不关联</option>';root.append(select);
 await settle(()=>select.value===d.projectReference('alice','p1'));
 assert.equal(input.value,'保留的输入');assert.equal(w.document.activeElement,input);assert.equal(root.querySelector('input'),input);
});

test('project filters retain all and unassigned choices while the account directory changes',async t=>{
 const{root,directory:d,install}=await fixture(t,{html:'<main id="root"><select data-project-picker data-project-picker-filter data-project-ref="none"></select></main>'});
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'第一个云项目'}]);install();
 const select=root.querySelector('select');await settle(()=>select.value==='none'&&select.options.length===3);
 assert.deepEqual([...select.options].map(option=>option.value),['all','none',d.projectReference('alice','p1')]);assert.equal(select.hasAttribute('aria-invalid'),false);assert.equal(select.querySelector('optgroup'),null);
 d.updateAccountProjects('alice',[{id:'p1',title:'已改名'},{id:'p2',title:'新项目'}]);
 assert.equal(select.value,'none');assert.equal(select.options.length,4);assert.equal(select.selectedOptions[0].disabled,false);
 d.setProjectDirectorySession(null);assert.deepEqual([...select.options].map(option=>option.value),['all','none']);assert.equal(select.value,'none');assert.equal(select.hasAttribute('aria-invalid'),false);
});

test('failed account lookup never substitutes browser projects and exposes an explicit working retry',async t=>{
 let attempts=0;
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><label>所属项目<select data-project-picker><option value="">不关联项目</option></select></label></main>',fetch:async()=>++attempts===1?response([],503):response([{id:'retried',title:'重试获取的账户项目'}])});
 w.localStorage.setItem('paperknow-projects',JSON.stringify([{id:'local',name:'离线也可选的本地项目'}]));
 d.setProjectDirectorySession({id:'alice'});install();
 await settle(()=>[...root.querySelectorAll('button')].some(button=>/重试|重新获取|重新读取/.test(button.textContent)));
 const select=root.querySelector('select');assert.deepEqual([...select.options].map(option=>option.value),['']);assert.deepEqual(d.selectableProjects(),[]);
 assert.equal(select.getAttribute('aria-busy'),'false');assert.match(root.querySelector('[data-project-picker-status]').textContent,/读取失败/);
 const retry=[...root.querySelectorAll('button')].find(button=>/重试|重新获取|重新读取/.test(button.textContent));retry.click();
 await settle(()=>[...select.options].some(option=>option.value===d.projectReference('alice','retried')));
 assert.equal(attempts,2);assert.equal(select.isConnected,true);
});

test('an unsigned user with historical browser projects sees no selectable project or private lookup',async t=>{
 const calls=[];
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><select data-project-picker></select></main>',fetch:async(path,options)=>{calls.push({path,options});return response([]);}});
 const local=[{id:'legacy',name:'历史项目'}];w.localStorage.setItem('paperknow-projects',JSON.stringify(local));
 d.setProjectDirectorySession(null);install();
 await settle(()=>root.querySelector('[data-project-picker-status]')?.textContent.includes('登录后'));
 assert.deepEqual([...root.querySelector('select').options].map(option=>option.value),['']);assert.deepEqual(d.selectableProjects(),[]);assert.equal(calls.length,0);
 assert.deepEqual(JSON.parse(w.localStorage.getItem('paperknow-projects')),local);
});

test('a historical raw reference remains disabled even when the cloud project has the same raw ID',async t=>{
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><form><textarea>保留的历史草稿</textarea><select data-project-picker data-project-ref="same-id"><option value="same-id" selected>历史项目</option></select></form></main>'});
 const local=[{id:'same-id',name:'历史本地项目'}];w.localStorage.setItem('paperknow-projects',JSON.stringify(local));
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'same-id',title:'云端不同项目'}]);install();
 const select=root.querySelector('select');
 await settle(()=>select.selectedOptions[0]?.disabled);
 assert.equal(select.value,'same-id');assert.equal(select.getAttribute('aria-invalid'),'true');assert.equal(d.resolveAccountProjectId(select.value,'alice'),null);
 assert.match(root.querySelector('[data-project-picker-status]').textContent,/我的项目.*导入历史项目|历史项目.*我的项目.*导入/);
 assert.ok([...select.options].some(option=>option.value===d.projectReference('alice','same-id')&&!option.disabled));
 d.updateAccountProjects('alice',[{id:'same-id',title:'云端更新后的项目'},{id:'p2',title:'其他项目'}]);
 await settle(()=>[...select.options].some(option=>option.value===d.projectReference('alice','p2')));
 assert.equal(select.value,'same-id');assert.equal(select.selectedOptions[0].disabled,true);assert.equal(root.querySelector('textarea').value,'保留的历史草稿');
 select.value=d.projectReference('alice','same-id');select.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(select.hasAttribute('aria-invalid'),false);assert.equal(d.resolveAccountProjectId(select.value,'alice'),'same-id');
 assert.doesNotMatch(root.querySelector('[data-project-picker-status]').textContent,/历史项目/);
 assert.deepEqual(JSON.parse(w.localStorage.getItem('paperknow-projects')),local);
});

test('an account switch disables the former project selection rather than choosing the new owner matching ID',async t=>{
 const{root,directory:d,install}=await fixture(t,{html:'<main id="root"><select data-project-picker data-project-ref="account:alice:p1"></select></main>'});
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'甲账户项目'}]);install();
 const select=root.querySelector('select');await settle(()=>select.selectedOptions[0]?.textContent==='甲账户项目');
 d.setProjectDirectorySession({id:'bob'});d.updateAccountProjects('bob',[{id:'p1',title:'乙账户同编号项目'}]);
 await settle(()=>[...select.options].some(option=>option.value===d.projectReference('bob','p1')));
 assert.equal(select.value,d.projectReference('alice','p1'));assert.equal(select.selectedOptions[0].disabled,true);assert.equal(select.getAttribute('aria-invalid'),'true');
 assert.throws(()=>d.resolveAccountProjectId(select.value,'bob'));assert.equal(select.querySelector('optgroup'),null);
});

test('a stale same-account lookup cannot overwrite a freshly published project directory',async t=>{
 const gate=deferred(),calls=[];
 const{directory:d}=await fixture(t,{fetch:(path,options)=>{calls.push({path,options});return gate.promise;}});
 d.setProjectDirectorySession({id:'alice'});
 const old=d.refreshAccountProjects({force:true});await settle(()=>calls.length===1);
 d.updateAccountProjects('alice',[{id:'old',title:'原有项目'},{id:'created-now',title:'刚刚新建的项目'}]);
 assert.ok(d.selectableProjects().some(row=>row.id===d.projectReference('alice','created-now')));
 gate.resolve(response([{id:'old',title:'旧请求中的目录'}]));await old;
 const rows=d.selectableProjects();
 assert.ok(rows.some(row=>row.id===d.projectReference('alice','created-now')&&row.name==='刚刚新建的项目'));
 assert.ok(rows.some(row=>row.id===d.projectReference('alice','old')&&row.name==='原有项目'));
});

test('a picker installed before authentication automatically loads the owner directory and restores its saved reference',async t=>{
 const gate=deferred(),calls=[];
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><form><textarea id="notes">登录确认前填写的研究说明</textarea><select data-project-picker data-project-ref="account:alice:p1"><option value="">不关联项目</option></select></form></main>',fetch:(path,options)=>{calls.push({path,options});return gate.promise;}});
 d.setProjectDirectorySession(null);install();
 await settle(()=>root.querySelector('[data-project-picker-status]')?.textContent.includes('登录后'));
 assert.equal(calls.length,0,'a guest picker must not read a private account directory');
 const form=root.querySelector('form'),notes=root.querySelector('#notes'),select=root.querySelector('select');notes.focus();
 d.setProjectDirectorySession({id:'alice'});
 await settle(()=>calls.length===1);
 assert.equal(header(calls[0].options,'X-PaperKnow-User'),'alice');
 assert.equal(select.getAttribute('aria-busy'),'true');
 assert.match(root.querySelector('[data-project-picker-status]').textContent,/正在读取/);
 gate.resolve(response([{id:'p1',title:'登录后读取的研究项目'}]));
 await settle(()=>select.selectedOptions[0]?.textContent==='登录后读取的研究项目');
 assert.equal(select.value,d.projectReference('alice','p1'));assert.equal(select.selectedOptions[0].disabled,false);
 assert.equal(select.hasAttribute('aria-invalid'),false);assert.equal(select.getAttribute('aria-busy'),'false');
 assert.equal(root.querySelector('form'),form);assert.equal(notes.value,'登录确认前填写的研究说明');assert.equal(w.document.activeElement,notes);
});

test('a session error retries authentication before reading projects and preserves current form values through recovery',async t=>{
 const gate=deferred(),calls=[];let reconnects=0;
 const{w,root,directory:d,install}=await fixture(t,{html:'<main id="root"><form><input id="topic" value="重新连接前的研究题目"><textarea id="notes">尚未保存的方法说明</textarea><select data-project-picker data-project-ref="account:alice:p1"><option value="">不关联项目</option></select></form></main>',fetch:(path,options)=>{calls.push({path,options});return gate.promise;}});
 d.setProjectDirectorySession(null,{status:'error'});
 install({onSessionRetry:()=>{reconnects++;d.setProjectDirectorySession({id:'alice'});}});
 await settle(()=>root.querySelector('[data-project-picker-status] button')?.textContent==='重新连接');
 const form=root.querySelector('form'),topic=root.querySelector('#topic'),notes=root.querySelector('#notes'),select=root.querySelector('select'),note=root.querySelector('[data-project-picker-status]');
 assert.match(note.textContent,/账户连接暂不可用/);assert.equal(calls.length,0,'a failed session must not read projects without a confirmed owner');
 assert.equal(select.value,d.projectReference('alice','p1'));
 topic.value='重连期间继续编辑的研究题目';notes.value='重连期间继续填写的方法说明';notes.focus();
 note.querySelector('button').click();
 await settle(()=>calls.length===1);
 assert.equal(reconnects,1);assert.equal(calls[0].path,'/api/projects');assert.equal(header(calls[0].options,'X-PaperKnow-User'),'alice');
 assert.equal(select.getAttribute('aria-busy'),'true');assert.equal(select.value,d.projectReference('alice','p1'));
 assert.equal(topic.value,'重连期间继续编辑的研究题目');assert.equal(notes.value,'重连期间继续填写的方法说明');
 gate.resolve(response([{id:'p1',title:'重连后恢复的账户项目'}]));
 await settle(()=>select.selectedOptions[0]?.textContent==='重连后恢复的账户项目');
 assert.equal(root.querySelector('form'),form);assert.equal(root.querySelector('#topic'),topic);assert.equal(root.querySelector('#notes'),notes);
 assert.equal(topic.value,'重连期间继续编辑的研究题目');assert.equal(notes.value,'重连期间继续填写的方法说明');assert.equal(w.document.activeElement,notes);
 assert.equal(select.value,d.projectReference('alice','p1'));assert.equal(select.hasAttribute('aria-invalid'),false);assert.equal(select.getAttribute('aria-busy'),'false');
 assert.equal(root.querySelector('[data-project-picker-status] button'),null);
});

test('a session error without an authentication retry callback does not expose a nonworking directory retry',async t=>{
 const calls=[];
 const{root,directory:d,install}=await fixture(t,{html:'<main id="root"><select data-project-picker><option value="">不关联项目</option></select></main>',fetch:async(path,options)=>{calls.push({path,options});return response([]);}});
 d.setProjectDirectorySession(null,{status:'error'});install();
 await settle(()=>root.querySelector('[data-project-picker-status]')?.textContent.includes('账户连接暂不可用'));
 assert.equal(root.querySelector('[data-project-picker-status] button'),null);assert.equal(calls.length,0);
});


test('directory updates on pages without a project picker do not read layout or scan scroll positions',async t=>{
 const{w,root,directory:d,install}=await fixture(t,{html:'<div id="root"><aside id="navigation"><button>工作台导航</button></aside><main class="dashboard"><h1>格式排版</h1></main></div>'});
 const measured=[],original=w.getComputedStyle.bind(w);w.getComputedStyle=node=>{measured.push(node);return original(node);};
 root.getBoundingClientRect=()=>{throw Error('an unrelated page must not force project-picker layout');};
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'账户项目'}]);install();
 await new Promise(resolve=>setImmediate(resolve));
 d.updateAccountProjects('alice',[{id:'p1',title:'已更新账户项目'}]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(measured.length,0);assert.equal(root.querySelector('h1').textContent,'格式排版');
});

test('project picker stabilization measures only its feature rather than the full navigation shell',async t=>{
 const{w,root,directory:d,install}=await fixture(t,{html:'<div id="root"><aside id="navigation"><button id="menu">导航</button></aside><main class="dashboard"><form><textarea id="notes">保留输入</textarea><select data-project-picker></select></form></main></div>'});
 const measured=[],original=w.getComputedStyle.bind(w);w.getComputedStyle=node=>{measured.push(node);return original(node);};
 root.getBoundingClientRect=()=>{throw Error('the app shell is outside the picker update');};
 d.setProjectDirectorySession({id:'alice'});d.updateAccountProjects('alice',[{id:'p1',title:'功能项目'}]);install();
 await settle(()=>root.querySelector('select option[value="account:alice:p1"]'));
 assert.ok(measured.length);assert.ok(measured.every(node=>node.matches('.dashboard')));assert.equal(root.querySelector('textarea').value,'保留输入');
});
