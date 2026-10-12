import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {KIT_ROOT,readSnapshot} from '../scripts/compile.mjs';
import {verifyReferenceClosure,applicableReferenceInputs,documentReferences} from '../scripts/reference-closure.mjs';
import {buildExecutionPrompt} from '../scripts/authority.mjs';
import {createDockerExecutor} from '../scripts/executor.mjs';

const protocol='core/aidlc-common/protocols/stage-protocol.md';
function copiedReferences(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-reference-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.cpSync(path.join(KIT_ROOT,'upstream'),path.join(root,'upstream'),{recursive:true});return root;}

test('pinned support closes every stage/profile without changing methodology counts',()=>{
 const snapshot=readSnapshot();assert.equal(snapshot.stages.length,33);assert.equal(Object.keys(snapshot.profiles).length,11);
 for(const profile of Object.keys(snapshot.profiles))for(const stage of snapshot.stages){const refs=applicableReferenceInputs({stage:stage.slug,profile,snapshot});assert.ok(refs.source_paths.includes(stage.source_path));}
 const refs=applicableReferenceInputs({stage:'rough-mockups',profile:'feature',snapshot});assert.ok(refs.source_paths.includes(protocol));
 const text=fs.readFileSync(path.join(KIT_ROOT,refs.document_root,protocol),'utf8');assert.match(text,/ASCII Diagram Standards/);assert.match(text,/Character-width rule/);
 assert.equal(refs.source_paths.every(item=>typeof item==='string'),true);assert.equal(JSON.stringify(refs).includes('ASCII Diagram Standards'),false,'context carries paths, not duplicated bodies');
});

test('author and distinct reviewer receive identical verified method inputs',()=>{
 const snapshot=readSnapshot(),stage=snapshot.stages.find(x=>x.slug==='rough-mockups');
 const author=buildExecutionPrompt({dispatch:{stage:stage.slug,role:stage.lead_agent,phase:'inline',context:{stage,profile:'feature'}},workspace:'/workspace',sourceDigest:'source'});
 const reviewer=buildExecutionPrompt({dispatch:{stage:stage.slug,role:stage.reviewer,phase:'review',context:{stage,profile:'feature'}},workspace:'/workspace',sourceDigest:'source'});
 assert.notEqual(author.dispatch.role,reviewer.dispatch.role);assert.deepEqual(author.methodology_references,reviewer.methodology_references);
 assert.ok(author.methodology_references.source_paths.includes(protocol));assert.equal(reviewer.writable_artifact_targets.length,0);
});

for(const mutation of ['missing','tampered','foreign','manifest','symlink'])test(`reference ${mutation} refuses before a worker starts`,async t=>{
 const sourceRoot=copiedReferences(t),file=path.join(sourceRoot,'upstream/references',protocol);
 if(mutation==='missing')fs.unlinkSync(file);if(mutation==='tampered')fs.appendFileSync(file,'changed');if(mutation==='foreign')fs.writeFileSync(path.join(sourceRoot,'upstream/references/foreign.md'),'foreign');
 if(mutation==='manifest')fs.appendFileSync(path.join(sourceRoot,'upstream/reference-manifest.json'),' ');
 if(mutation==='symlink'){fs.unlinkSync(file);fs.symlinkSync(path.join(KIT_ROOT,'upstream/references',protocol),file);}
 const workspace=path.join(sourceRoot,'workspace'),controllerRoot=path.join(sourceRoot,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);let calls=0;
 const request={workspace,source_root:sourceRoot,run_id:'reference-admission',execution:{max_turns:1,timeout_s:30,model:'fixture'},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(sourceRoot,'receipts')}};
 const executor=createDockerExecutor({request,controllerRoot,workerRunner:async()=>{calls++;throw new Error('Provider must not start');}});
 const dispatch={request_digest:'request',stage:'rough-mockups',role:'aidlc-design-agent',phase:'inline',unit:'stage',context:{profile:'feature',stage:readSnapshot().stages.find(x=>x.slug==='rough-mockups'),artifact_targets:[]},basis:await executor.snapshotBasis({})};dispatch.expected_identity=await executor.admit(dispatch);
 await assert.rejects(executor.execute(dispatch),/reference|ENOENT|Unsupported/);assert.equal(calls,0);
});

test('generated record artifacts are not mistaken for missing support documents',()=>{
 assert.deepEqual(documentReferences('Read <record>/memory.md and aidlc-state.md. Write <record>/questions.md.','core/agents/example.md',[protocol]),[]);
 assert.throws(()=>documentReferences('Read stage-protocol-absent.md.','core/agents/example.md',[protocol]),/Unresolved static methodology reference/);
 assert.equal(verifyReferenceClosure().upstream.commit,'2a555f7a4387cd1b8254029cccb9fd1e99974574');
});

test('unknown normative core and linked documentation references fail closed',()=>{
 assert.throws(()=>documentReferences('Follow missing-standard.md.','core/agents/example.md',[protocol]),/Unresolved static/);
 assert.throws(()=>documentReferences('See [standard](missing-standard.md).','docs/reference/example.md',[protocol]),/Unresolved static/);
 assert.throws(()=>documentReferences('Read missing-standard.md.','docs/reference/example.md',[protocol]),/Unresolved static/);
});

test('observed worker mutation of pinned support retains evidence and refuses publication',async t=>{
 const sourceRoot=copiedReferences(t),file=path.join(sourceRoot,'upstream/references',protocol),original=fs.readFileSync(file);
 const workspace=path.join(sourceRoot,'workspace'),controllerRoot=path.join(sourceRoot,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 const target={id:'mockup',stage:'rough-mockups',unit:null,path:'.aidlc/artifacts/rough-mockups/mockup.md'};
 const request={workspace,source_root:sourceRoot,run_id:'reference-post-worker',execution:{max_turns:2,timeout_s:30,model:'fixture'},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(sourceRoot,'receipts')}};
 let calls=0;
 const workerRunner=async options=>{
  calls++;const context=JSON.parse(fs.readFileSync(options.contextFile,'utf8'));
  assert.ok(context.methodology_references.source_paths.includes(protocol));
  const output=path.join(options.workspace,target.path);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,'otherwise valid observed output\n');
  fs.appendFileSync(file,'unauthorized reference mutation\n');
  return {observed:{context_digest:'observed-fixture-context'},provider_thread_id:'observed-fixture-thread',terminal:{status:0,timeout:false,overflow:false},container_removed:true,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:[{path:target.path}]})};
 };
 const executor=createDockerExecutor({request,controllerRoot,workerRunner});
 const dispatch={request_digest:'reference-post-worker-request',stage:'rough-mockups',unit:'stage',role:'aidlc-design-agent',phase:'inline',context:{profile:'feature',stage:readSnapshot().stages.find(x=>x.slug==='rough-mockups'),artifact_targets:[target]},basis:await executor.snapshotBasis({})};dispatch.expected_identity=await executor.admit(dispatch);
 try{await assert.rejects(executor.execute(dispatch),/Pinned methodology reference missing or changed/);}finally{fs.writeFileSync(file,original);}
 assert.equal(calls,1);assert.equal(executor.turnsStarted,1);assert.equal(executor.observed.length,1);assert.equal(executor.observed[0].provider_thread_id,'observed-fixture-thread');
 const saved=JSON.parse(fs.readFileSync(path.join(controllerRoot,'executor-history.json'))).history.starts[0];
 assert.equal(saved.status,'observed');assert.equal(saved.worker.terminal.status,0);assert.equal(saved.worker.provider_thread_id,'observed-fixture-thread');assert.equal(saved.publication,undefined);
 assert.equal(fs.existsSync(path.join(workspace,target.path)),false);assert.equal(await executor.loadReceipt(dispatch),null);verifyReferenceClosure(sourceRoot);
});
