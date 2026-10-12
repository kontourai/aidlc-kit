import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDockerExecutor } from '../scripts/executor.mjs';
import { dispatchStage } from '../scripts/dispatch.mjs';
import { digest } from '../scripts/compile.mjs';

// This is a local host-port boundary test, not a Docker/provider receipt.
// The port creates real competing fork bytes; the executor decides publication.
function fixture(t, { responseStatus = 'failed', terminalStatus = 0, maxTurns = 5, portThrows = false, storageBudget,reasoningEffort,storageViolation } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'source'), controllerRoot = path.join(root, 'controller');
  fs.mkdirSync(workspace); fs.mkdirSync(controllerRoot);
  fs.writeFileSync(path.join(workspace, 'app.js'), 'canonical implementation');
  fs.writeFileSync(path.join(workspace, 'keep.js'), 'canonical retained file');
  const artifact = '.aidlc/artifacts/code-generation/code-summary.md';
  fs.mkdirSync(path.dirname(path.join(workspace, artifact)), { recursive: true });
  fs.writeFileSync(path.join(workspace, artifact), 'canonical artifact');
  const request = { workspace, source_root: path.resolve(import.meta.dirname,'..'), run_id: 'publication-fixture', execution: { max_turns: maxTurns, timeout_s: 60, model: 'local-fixture',reasoning_effort:reasoningEffort }, engine_sandbox: { image: `sha256:${'a'.repeat(64)}`, artifact_root: path.join(root, 'artifacts'), storage_budget: storageBudget === 'workspace-logical' ? registeredBudget({ roots: [workspace] }) : storageBudget } };
  let fork, calls = 0, dispatch, observedStorageBudget,observedReasoning;
  const workerRunner = async (input) => {
    calls++;observedStorageBudget=input.storageBudget;observedReasoning=input.reasoningEffort;
    if (portThrows) throw new Error('Synthetic unreceipted worker failure');
    fork = input.workspace;
    fs.writeFileSync(path.join(fork, 'app.js'), 'worker edit');
    if (fs.existsSync(path.join(fork, 'keep.js'))) fs.unlinkSync(path.join(fork, 'keep.js'));
    fs.writeFileSync(path.join(fork, 'added.js'), 'worker addition');
    fs.mkdirSync(path.dirname(path.join(fork, artifact)), { recursive: true });
    fs.writeFileSync(path.join(fork, artifact), 'worker artifact');
    return {storage_violation:storageViolation, observed: { container_id: 'local-port-fixture', context_digest: 'fixture', stdin_digest: 'fixture', source_fork_digest: 'fixture' }, provider_thread_id: 'local-port-fixture', terminal: { status: terminalStatus, timeout: false, overflow: false }, container_removed: true, usage: { complete: false }, final: JSON.stringify({ status: responseStatus, artifacts: [{ path: artifact }] }) };
  };
  const freshExecutor = () => createDockerExecutor({ request, controllerRoot, workerRunner });
  const executor = freshExecutor();
  const execute = async (phase = 'inline') => {
    dispatch = { request_digest: digest({ responseStatus, terminalStatus, phase }), stage: 'code-generation', role: 'aidlc-developer-agent', phase, unit: 'stage', context: { stage: { workspace_requires: true }, artifact_targets: [{ path: artifact }] }, basis: await executor.snapshotBasis({}) };
    dispatch.expected_identity = await executor.admit(dispatch);
    return executor.execute(dispatch);
  };
  return { workspace, controllerRoot, artifact, execute, executor, freshExecutor, fork: () => fork, calls: () => calls, dispatch: () => dispatch, observedStorageBudget:()=>observedStorageBudget,observedReasoning:()=>observedReasoning };
}

test('a final failed result publishes no modifications, deletions, additions or artifacts', async (t) => {
  const f = fixture(t);
  const result = await f.execute();
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.artifacts, []);
  assert.equal(fs.readFileSync(path.join(f.workspace, 'app.js'), 'utf8'), 'canonical implementation');
  assert.equal(fs.readFileSync(path.join(f.workspace, 'keep.js'), 'utf8'), 'canonical retained file');
  assert.equal(fs.existsSync(path.join(f.workspace, 'added.js')), false);
  assert.equal(fs.readFileSync(path.join(f.workspace, f.artifact), 'utf8'), 'canonical artifact');
  assert.equal(fs.readFileSync(path.join(f.fork(), 'app.js'), 'utf8'), 'worker edit');
});
test('a failed provider process cannot publish a model-declared completed result', async (t) => {
  const f = fixture(t, { responseStatus: 'completed', terminalStatus: 1 });
  assert.equal((await f.execute()).status, 'failed');
  assert.equal(fs.readFileSync(path.join(f.workspace, 'app.js'), 'utf8'), 'canonical implementation');
  assert.equal(fs.readFileSync(path.join(f.workspace, f.artifact), 'utf8'), 'canonical artifact');
});
test('a completed result still publishes authorized source and assigned artifacts', async (t) => {
  const f = fixture(t, { responseStatus: 'completed' });
  const result = await f.execute();
  assert.equal(result.status, 'completed');
  assert.equal(fs.readFileSync(path.join(f.workspace, 'app.js'), 'utf8'), 'worker edit');
  assert.equal(fs.existsSync(path.join(f.workspace, 'keep.js')), false);
  assert.equal(fs.readFileSync(path.join(f.workspace, 'added.js'), 'utf8'), 'worker addition');
  assert.equal(fs.readFileSync(path.join(f.workspace, f.artifact), 'utf8'), 'worker artifact');
});
test('durable receipt replay restores history without starting or charging another worker', async (t) => {
  const f = fixture(t, { maxTurns: 1 });
  const result = await f.execute();
  await f.executor.saveReceipt(f.dispatch(), result);
  const resumed = f.freshExecutor();
  assert.equal(resumed.turnsStarted, 1);
  assert.equal(resumed.observed.length, 1);
  assert.equal(resumed.observed[0].provider_thread_id, 'local-port-fixture');
  assert.equal(resumed.hasUnobservedStarts, false);
  assert.deepEqual(await resumed.loadReceipt(f.dispatch()), result);
  assert.equal(resumed.turnsStarted, 1);
  assert.equal(f.calls(), 1);
  await resumed.admit(f.dispatch());
  await assert.rejects(resumed.execute(f.dispatch()), (error) => error.code === 'execution_budget' && /budget exhausted/.test(error.message));
  assert.equal(f.calls(), 1);
});
test('a crashed unreceipted invocation remains charged and cannot be relaunched on restart', async (t) => {
  const f = fixture(t, { portThrows: true });
  await assert.rejects(f.execute(), /Synthetic unreceipted/);
  const resumed = f.freshExecutor();
  assert.equal(resumed.turnsStarted, 1);
  assert.equal(resumed.observed.length, 0);
  assert.equal(resumed.hasUnobservedStarts, true);
  await resumed.admit(f.dispatch());
  await assert.rejects(resumed.execute(f.dispatch()), /automatic retry is forbidden/);
  assert.equal(f.calls(), 1);
  assert.equal(resumed.turnsStarted, 1);
});
test('stored receipt integrity binds final status and artifacts as well as raw worker metadata', async (t) => {
  const f = fixture(t);
  const result = await f.execute();
  await f.executor.saveReceipt(f.dispatch(), result);
  const file = path.join(f.controllerRoot, 'executions', `${f.dispatch().request_digest}.json`);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.result.status = 'completed';
  stored.result.artifacts = [{ path: 'fabricated.md', digest: 'b'.repeat(64) }];
  fs.writeFileSync(file, JSON.stringify(stored));
  await assert.rejects(f.freshExecutor().loadReceipt(f.dispatch()), /receipt drifted/);
});
test('contributors and dialogue participants cannot publish source edits in a source-authorized stage', async (t) => {
  for (const phase of ['contribute', 'dialogue']) {
    const f = fixture(t, { responseStatus: 'completed' });
    await assert.rejects(f.execute(phase), /source outside stage authority/);
    assert.equal(fs.readFileSync(path.join(f.workspace, 'app.js'), 'utf8'), 'canonical implementation');
    assert.equal(fs.readFileSync(path.join(f.workspace, 'keep.js'), 'utf8'), 'canonical retained file');
    assert.equal(fs.existsSync(path.join(f.workspace, 'added.js')), false);
    assert.equal(fs.readFileSync(path.join(f.workspace, f.artifact), 'utf8'), 'canonical artifact');
  }
});

// The registered named-treatment request shape, not an invented one.
const registeredBudget = (over = {}) => ({ max_bytes: 128 * 1024 * 1024, max_entries: 10000, max_file_bytes: 16 * 1024 * 1024, min_free_bytes: 4 * 1024 * 1024 * 1024, roots: ['/synthetic-owned-case'], ...over });

test('workers receive the registered aggregate storage budget and the host ledger enforces it',async t=>{
  const storageBudget=registeredBudget();delete storageBudget.roots;const f=fixture(t,{responseStatus:'completed',storageBudget});
  await f.execute();assert.deepEqual(f.observedStorageBudget(),storageBudget);
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'worker edit');
});
test('a shared byte budget exhausts across workers and stays exhausted after restart',async t=>{
  const budget=registeredBudget({max_bytes:45});delete budget.roots;const f=fixture(t,{responseStatus:'completed',storageBudget:budget});
  await f.execute();
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'worker edit');
  const second=f.freshExecutor();
  const dispatch={request_digest:digest({second:true}),stage:'code-generation',role:'aidlc-developer-agent',phase:'inline',unit:'stage',context:{stage:{workspace_requires:true},artifact_targets:[{path:f.artifact}]},basis:await second.snapshotBasis({})};
  dispatch.expected_identity=await second.admit(dispatch);
  await assert.rejects(second.execute(dispatch),error=>error.code==='storage_budget'&&/byte budget exhausted/.test(error.message));
  assert.equal(f.calls(),2);
});
test('an oversized single publication is refused before any canonical byte changes',async t=>{
  const f=fixture(t,{responseStatus:'completed',storageBudget:registeredBudget({max_file_bytes:5})});
  await assert.rejects(f.execute(),error=>error.code==='storage_budget'&&/per-file storage budget/.test(error.message));
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');
  assert.equal(fs.readFileSync(path.join(f.workspace,f.artifact),'utf8'),'canonical artifact');
});
test('publication outside the declared storage roots is refused',async t=>{
  const f=fixture(t,{responseStatus:'completed',storageBudget:registeredBudget({roots:['/definitely-not-the-case-root']})});
  await assert.rejects(f.execute(),error=>error.code==='storage_budget'&&/outside declared storage roots/.test(error.message));
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');
  assert.equal(fs.existsSync(path.join(f.workspace,'added.js')),false);
});
test('declared unit resources confine source publication to their scopes',async t=>{
  const f=fixture(t,{responseStatus:'completed'});
  const dispatch={request_digest:digest({scoped:true}),stage:'code-generation',role:'aidlc-developer-agent',phase:'inline',unit:'api',mutable_resources:['services/api'],context:{stage:{workspace_requires:true},artifact_targets:[{path:f.artifact}]},basis:await f.executor.snapshotBasis({})};
  dispatch.expected_identity=await f.executor.admit(dispatch);
  await assert.rejects(f.executor.execute(dispatch),error=>error.code==='unit_scope'&&/outside declared unit resources/.test(error.message));
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');
});
test('the stage pseudo-unit keeps stage-level source authority and publishes',async t=>{
  const f=fixture(t,{responseStatus:'completed'});
  const stage={slug:'code-generation',lead_agent:'aidlc-developer-agent',mode:'subagent',source_digest:'a'.repeat(64),produces:['code-summary'],workspace_requires:true,reviewer:undefined};
  const context={shared:{stage,artifact_targets:[{id:'code-summary',stage:'code-generation',unit:null,path:f.artifact}]},units:{}};
  const outcome=await dispatchStage({stage,executor:f.executor,context,policy:{}});
  assert.equal(outcome.status,'completed',JSON.stringify(outcome.units.map(u=>u.error)));
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'worker edit');
});
test('logical storage roots are canonicalized before comparison',async t=>{
  const f=fixture(t,{responseStatus:'completed',storageBudget:'workspace-logical'});
  await f.execute();
  assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'worker edit');
});

test('low and high effort reach the worker unchanged for broker admission',async t=>{for(const reasoningEffort of ['low','high']){const f=fixture(t,{reasoningEffort});await f.execute();assert.equal(f.observedReasoning(),reasoningEffort);}});

test('worker quota termination retains observation and refuses publication as budget exhaustion',async t=>{
 const f=fixture(t,{responseStatus:'completed',storageViolation:{allowed:false,reason:'filesystem_free_floor'}});
 await assert.rejects(f.execute(),error=>error.code==='storage_budget'&&error.observation.reason==='filesystem_free_floor');
 assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');
 assert.equal(f.executor.observed.length,1);assert.equal(f.executor.turnsStarted,1);
});

// Final path reports describe source and input references without enlarging
// the host's stage-output publication set or source-write authority.
async function reportedPathsFixture(t,{report,mutateInput=false,deleteInput=false,sourceAuthority=true,phase='draft',sourceScope=['source/workspace'],contribute=false,approvedInput=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-reported-paths-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'app.mjs'),'export const value=1;');
 const input='.aidlc/artifacts/requirements/requirements.md',output='.aidlc/artifacts/code-generation/code-summary.md';fs.mkdirSync(path.dirname(path.join(workspace,input)),{recursive:true});fs.writeFileSync(path.join(workspace,input),'# Approved requirement\n');const originalInput=digest(fs.readFileSync(path.join(workspace,input)));
 const request={workspace,source_root:path.resolve(import.meta.dirname,'..'),run_id:'path-report-fixture',execution:{max_turns:2,timeout_s:30,model:'host-port'},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(root,'capture')}};
 const workerRunner=async invocation=>{
  if(sourceAuthority){fs.writeFileSync(path.join(invocation.workspace,'app.mjs'),'export const value=2;');fs.writeFileSync(path.join(invocation.workspace,'app.test.mjs'),'test source');}
  if(mutateInput)fs.writeFileSync(path.join(invocation.workspace,input),'altered requirement');if(deleteInput)fs.unlinkSync(path.join(invocation.workspace,input));
  const actualOutput=contribute?'.aidlc/contributions/code-generation/u/peer.md':output;fs.mkdirSync(path.dirname(path.join(invocation.workspace,actualOutput)),{recursive:true});fs.writeFileSync(path.join(invocation.workspace,actualOutput),'# Actual output\n');
  return {observed:{container_id:'host-port',context_digest:digest(fs.readFileSync(invocation.contextFile)),stdin_digest:digest('fixture'),source_fork_digest:digest('fixture')},provider_thread_id:'host-port-path-report',terminal:{status:0,timeout:false,overflow:false},container_removed:true,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:(report??['app.mjs','app.test.mjs',input,actualOutput]).map(file=>({path:file})),verdict:'ready',findings:[]})};
 };
 const executor=createDockerExecutor({request,controllerRoot,workerRunner}),dispatch={request_digest:digest({report,mutateInput,deleteInput,sourceAuthority,phase,sourceScope}),stage:'code-generation',phase,role:contribute?'peer':'lead',unit:'u',mutable_resources:sourceScope,context:{stage:{workspace_requires:sourceAuthority},artifact_targets:[{path:output,unit:'u'}],upstream_artifacts:[{path:input,digest:originalInput}],...(approvedInput?{approved_plan_basis:[{path:input,digest:originalInput}]}:{}),...(sourceAuthority?{}:{planning_only:phase!=='review'})},basis:await executor.snapshotBasis({})};dispatch.expected_identity=await executor.admit(dispatch);
 return {workspace,input,output,execute:()=>executor.execute(dispatch)};
}
test('final reports may identify authorized actual source and unchanged input without treating them as new stage outputs',async t=>{
 const f=await reportedPathsFixture(t),result=await f.execute();assert.equal(result.status,'completed');assert.deepEqual(result.artifacts.map(ref=>ref.path),[f.output]);assert.deepEqual(result.changed_source,['app.mjs','app.test.mjs']);assert.deepEqual(result.observation.reported_paths.map(ref=>ref.kind),['application-source','application-source','unchanged-input','stage-output']);assert.equal(fs.readFileSync(path.join(f.workspace,f.input),'utf8'),'# Approved requirement\n');
});
test('unreported input modification or deletion refuses every source and artifact publication',async t=>{for(const change of [{mutateInput:true},{deleteInput:true}]){const f=await reportedPathsFixture(t,{...change,report:['app.mjs','.aidlc/artifacts/code-generation/code-summary.md']});await assert.rejects(f.execute(),/read-only input|assigned input unreadable/);assert.equal(fs.readFileSync(path.join(f.workspace,'app.mjs'),'utf8'),'export const value=1;');assert.equal(fs.readFileSync(path.join(f.workspace,f.input),'utf8'),'# Approved requirement\n');assert.equal(fs.existsSync(path.join(f.workspace,f.output)),false);}});
test('foreign artifact/control paths and traversal remain outside the publication scope',async t=>{for(const file of ['.aidlc/artifacts/another-stage/foreign.md','.aidlc/state.md','../app.mjs','unknown.mjs']){const f=await reportedPathsFixture(t,{report:[file]});await assert.rejects(f.execute(),/outside assigned scope/);assert.equal(fs.readFileSync(path.join(f.workspace,'app.mjs'),'utf8'),'export const value=1;');assert.equal(fs.existsSync(path.join(f.workspace,f.output)),false);}});
test('source path reports cannot bypass unit source jail or read-only input custody',async t=>{
 const jailed=await reportedPathsFixture(t,{sourceScope:['other-directory']});await assert.rejects(jailed.execute(),error=>error.code==='unit_scope');assert.equal(fs.readFileSync(path.join(jailed.workspace,'app.mjs'),'utf8'),'export const value=1;');
 const review=await reportedPathsFixture(t,{sourceAuthority:false,phase:'review',mutateInput:true,report:[]});await assert.rejects(review.execute(),/read-only input/);assert.equal(fs.readFileSync(path.join(review.workspace,review.input),'utf8'),'# Approved requirement\n');
});

test('an unchanged approved input may be reported but unreported changes cannot escape approval custody',async t=>{const unchanged=await reportedPathsFixture(t,{approvedInput:true});assert.equal((await unchanged.execute()).status,'completed');const modified=await reportedPathsFixture(t,{approvedInput:true,mutateInput:true,report:['app.mjs','.aidlc/artifacts/code-generation/code-summary.md']});await assert.rejects(modified.execute(),/changed approved plan/);assert.equal(fs.readFileSync(path.join(modified.workspace,'app.mjs'),'utf8'),'export const value=1;');});

test('canonical artifact ancestor symlinks refuse all publication before valid source edits or deletes',async t=>{
 const f=fixture(t,{responseStatus:'completed'}),artifactRoot=path.join(f.workspace,'.aidlc/artifacts'),foreign=path.join(path.dirname(f.workspace),'foreign');fs.mkdirSync(foreign);fs.rmSync(artifactRoot,{recursive:true});fs.symlinkSync(foreign,artifactRoot,'dir');
 await assert.rejects(f.execute(),/Publication destination ancestor is not a real directory/);
 assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');assert.equal(fs.readFileSync(path.join(f.workspace,'keep.js'),'utf8'),'canonical retained file');assert.equal(fs.existsSync(path.join(f.workspace,'added.js')),false);assert.deepEqual(fs.readdirSync(foreign),[]);
});
test('canonical artifact leaf symlinks cannot overwrite an external file or publish otherwise valid source',async t=>{
 const f=fixture(t,{responseStatus:'completed'}),foreign=path.join(path.dirname(f.workspace),'foreign.txt');fs.writeFileSync(foreign,'outside protected');fs.unlinkSync(path.join(f.workspace,f.artifact));fs.symlinkSync(foreign,path.join(f.workspace,f.artifact));
 await assert.rejects(f.execute(),/Publication destination is not a regular file/);assert.equal(fs.readFileSync(foreign,'utf8'),'outside protected');assert.equal(fs.readFileSync(path.join(f.workspace,'app.js'),'utf8'),'canonical implementation');assert.equal(fs.existsSync(path.join(f.workspace,'added.js')),false);
});
test('explicit missing upstream artifact refuses worker admission before any source can be invented',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-missing-input-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);fs.writeFileSync(path.join(workspace,'app.js'),'original source');let starts=0;
 const request={workspace,source_root:path.resolve(import.meta.dirname,'..'),run_id:'missing-input',execution:{max_turns:2,timeout_s:30,model:'host-port'},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(root,'capture')}};
 const executor=createDockerExecutor({request,controllerRoot,workerRunner:async()=>{starts++;throw new Error('Must never start');}}),dispatch={request_digest:digest('missing-input'),stage:'code-generation',unit:'stage',phase:'inline',role:'lead',basis:await executor.snapshotBasis({}),context:{stage:{workspace_requires:true},artifact_targets:[],upstream_artifacts:[{path:'.aidlc/artifacts/requirements.md',digest:'a'.repeat(64)}]}};dispatch.expected_identity=await executor.admit(dispatch);await assert.rejects(executor.execute(dispatch),/ENOENT/);assert.equal(starts,0);assert.equal(fs.readFileSync(path.join(workspace,'app.js'),'utf8'),'original source');
});
