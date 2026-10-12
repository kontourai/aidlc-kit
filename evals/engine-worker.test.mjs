import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeEngineWorker} from '../scripts/engine-worker.mjs';
import {createCommandRunner} from '../scripts/commands.mjs';

test('native engine capture preserves actual protocol errors and explicit weaker isolation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-capture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const contextFile=path.join(root,'context.json');fs.writeFileSync(contextFile,JSON.stringify({canonical_workspace:root,unit_scope:'stage',instructions:['Probe']}));
 const host={engine:'copilot',provider:'native',model:'requested-model',isolation:'trusted-host',host_access_granted:true};
 for(const mode of ['success','narrated-final','engine-error','contradictory-terminal','different-engine']){
  const final=mode==='narrated-final'?'Narration remains observable.\n```json\n{"status":"completed","artifacts":[]}\n```':JSON.stringify({status:'completed',artifacts:[]});
  const runner=async input=>{assert.equal(input.engine,'copilot');assert.equal(input.hostAccessGranted,true);assert.equal(input.readOnlyWorkspace,true);assert.equal(input.allowTools,true);assert.deepEqual(JSON.parse(input.prompt.split('\n')[0]),JSON.parse(fs.readFileSync(contextFile,'utf8')));assert.match(input.prompt,/Final response boundary: return only the one JSON object required by the stage context/);return {outcome:mode==='engine-error'?'engine_error':'completed',terminal:{status:mode==='contradictory-terminal'?1:0,timeout:false,cancelled:false,overflow:false,signal:null},observed:{engine:mode==='different-engine'?'codex':'copilot',harness_version:'observed-version',prompt_digest:'observed-prompt'},final,usage:{complete:false,source:'unavailable'},stdout:'actual events',stderr:'',stdout_digest:'observed-stdout',stderr_digest:'observed-stderr',session_id:'actual-session'};};
  const value=await nativeEngineWorker({host,runner})({workspace:root,contextFile,artifactRoot:path.join(root,'captures'),invocationId:mode,ownerId:'owned-host',readOnlyWorkspace:true,timeoutMs:1000});
  const protocolSuccess=['success','narrated-final'].includes(mode);assert.equal(value.observed.harness,'copilot');assert.equal(value.observed.isolation,'none');assert.equal(value.observed.credential_confinement,false);assert.equal(value.observed.container_id,null);assert.equal(value.container_removed,null);assert.equal(value.usage.complete,false);assert.equal(value.final!==null,protocolSuccess);assert.equal(value.terminal.status,protocolSuccess?0:1);if(protocolSuccess)assert.equal(value.final,final);
 }
 assert.throws(()=>nativeEngineWorker({host:{...host,host_access_granted:false},runner:()=>{}}),/Explicit/);
});

test('authorized native checks use a private byte-bound copy and preserve a real failing command',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'source.mjs'),'export const value=1;');
 const command=['node','-e',"require('fs').writeFileSync('source.mjs','changed');process.stdout.write('observed output');process.exitCode=7;"];
 const runner=createCommandRunner({workspace,controllerRoot,executionProfile:'host-native',hostAccessGranted:true});const result=await runner({command,cwd:workspace});assert.equal(result.exitCode,7);assert.equal(result.stdout,'observed output');assert.equal(result.receipt.isolation,'none');assert.equal(fs.readFileSync(path.join(workspace,'source.mjs'),'utf8'),'export const value=1;');
 await assert.rejects(createCommandRunner({workspace,controllerRoot,executionProfile:'host-native'})({command}),/authority/);
 const stringCheck=await runner({command:'node --test'});assert.equal(stringCheck.exitCode,0);
 await assert.rejects(runner({command:'node --test; echo forged'}),/shell control/);
});

test('native executor publishes an observed successful fork and refuses direct canonical source or artifact edits',async t=>{
 const {createDockerExecutor}=await import('../scripts/executor.mjs');const {digest}=await import('../scripts/compile.mjs');
 for(const mutation of ['none','source','artifact']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-executor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'source.mjs'),'original');fs.mkdirSync(path.join(workspace,'.aidlc'),{recursive:true});fs.writeFileSync(path.join(workspace,'.aidlc/state.md'),'canonical state');
  const request={workspace,source_root:path.resolve(import.meta.dirname,'..'),run_id:'native-boundary',execution:{engine:'copilot',model:'fixture',max_turns:2,timeout_s:60},host_setup:{isolation:'trusted-host',engine:'copilot'},engine_sandbox:{artifact_root:path.join(root,'captures')}};
  const workerRunner=async options=>{fs.writeFileSync(path.join(options.workspace,'source.mjs'),'actual fork edit');if(mutation==='source')fs.writeFileSync(path.join(workspace,'unrelated.mjs'),'unauthorized');if(mutation==='artifact')fs.writeFileSync(path.join(workspace,'.aidlc/state.md'),'unauthorized');return {observed:{execution_profile:'host-native',engine:'copilot',container_id:null,context_digest:digest(fs.readFileSync(options.contextFile)),invocation_id:options.invocationId},engine_outcome:'completed',process_settlement:'parent-close-observed; descendants-unverified',provider_thread_id:'local-port-fixture',terminal:{status:0,timeout:false,overflow:false,cancelled:false},container_removed:null,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:[]})};};
  const executor=createDockerExecutor({request,controllerRoot,workerRunner}),dispatch={request_digest:digest(mutation),stage:'code-generation',unit:'stage',phase:'inline',role:'lead',context:{stage:{workspace_requires:true},artifact_targets:[]},basis:await executor.snapshotBasis({})};dispatch.expected_identity=await executor.admit(dispatch);
  if(mutation==='none'){assert.equal((await executor.execute(dispatch)).status,'completed');assert.equal(fs.readFileSync(path.join(workspace,'source.mjs'),'utf8'),'actual fork edit');}
  else{await assert.rejects(executor.execute(dispatch),/Native worker changed canonical/);assert.equal(fs.readFileSync(path.join(workspace,'source.mjs'),'utf8'),'original');}
 }
});

test('native checks honor cancellation and the remaining shared deadline',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-deadline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'source.mjs'),'original');
 const controller=new AbortController(),runner=createCommandRunner({workspace,controllerRoot,executionProfile:'host-native',hostAccessGranted:true,signal:controller.signal,remainingMs:()=>1000});const timer=setTimeout(()=>controller.abort(),100);try{const result=await runner({command:['node','-e','setTimeout(()=>{},60000)']});assert.equal(result.receipt.cancelled,true);}finally{clearTimeout(timer);}
 const bounded=createCommandRunner({workspace,controllerRoot,executionProfile:'host-native',hostAccessGranted:true,remainingMs:()=>30});const result=await bounded({command:['node','-e','setTimeout(()=>{},60000)'],timeoutMs:60000});assert.equal(result.receipt.timeout,true);
 await assert.rejects(createCommandRunner({workspace,controllerRoot,executionProfile:'host-native',hostAccessGranted:true,remainingMs:()=>0})({command:['node','--version']}),/budget exhausted/);
});

test('native workers reject stale queued basis and consume only freshly admitted source',async t=>{
 const {createDockerExecutor}=await import('../scripts/executor.mjs');const {digest}=await import('../scripts/compile.mjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-parallel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'seed.mjs'),'original');
 const request={workspace,source_root:path.resolve(import.meta.dirname,'..'),run_id:'native-disjoint',host_setup:{isolation:'trusted-host',engine:'copilot'},execution:{engine:'copilot',model:'fixture',max_turns:2,timeout_s:60},engine_sandbox:{artifact_root:path.join(root,'captures')}};let active=0,peak=0;
 const workerRunner=async options=>{active++;peak=Math.max(peak,active);const context=JSON.parse(fs.readFileSync(options.contextFile,'utf8'));assert.equal(context.source_digest,context.dispatch.basis.source_digest);await new Promise(resolve=>setTimeout(resolve,30));fs.writeFileSync(path.join(options.workspace,context.unit_scope+'.mjs'),context.unit_scope);active--;return {observed:{execution_profile:'host-native',engine:'copilot',container_id:null,context_digest:digest(fs.readFileSync(options.contextFile))},engine_outcome:'completed',provider_thread_id:options.invocationId,terminal:{status:0,timeout:false,overflow:false},container_removed:null,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:[]})};};
 const executor=createDockerExecutor({request,controllerRoot,workerRunner}),jobs=[];for(const unit of ['a','b']){const job={request_digest:digest(unit),stage:'code-generation',unit,phase:'inline',role:'lead',mutable_resources:[unit+'.mjs'],context:{stage:{workspace_requires:true},artifact_targets:[]},basis:await executor.snapshotBasis({})};job.expected_identity=await executor.admit(job);jobs.push(job);}
 const results=await Promise.allSettled(jobs.map(job=>executor.execute(job)));assert.equal(results[0].value.status,'completed');assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/source basis changed/);assert.equal(executor.turnsStarted,1);assert.equal(peak,1);assert.equal(fs.existsSync(path.join(workspace,'b.mjs')),false);const fresh=await executor.snapshotBasis({});const next={...jobs[1],basis:fresh,request_digest:digest({unit:'b',basis:fresh})};next.expected_identity=await executor.admit(next);assert.equal((await executor.execute(next)).status,'completed');for(const unit of ['a','b'])assert.equal(fs.readFileSync(path.join(workspace,unit+'.mjs'),'utf8'),unit);
});

test('authorized operation commands use the shared remaining deadline before spawning',async t=>{
 const {createOperationCommandRunner}=await import('../scripts/operations.mjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-operation-deadline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 const command=['node','-e','setTimeout(()=>{},60000)'],runner=createOperationCommandRunner({workspace,controllerRoot,remainingMs:()=>30});const result=await runner({command,cwd:workspace,timeoutMs:60000,maxOutputBytes:1024});assert.equal(result.receipt.timeout,true);assert.equal(result.exitCode,null);
 const denied=createOperationCommandRunner({workspace,controllerRoot,remainingMs:()=>0});await assert.rejects(denied({command:['node','-e',"require('fs').writeFileSync('unexpected','bad')"],cwd:workspace,timeoutMs:1000,maxOutputBytes:1024}),/budget exhausted/);assert.equal(fs.existsSync(path.join(workspace,'unexpected')),false);
});
