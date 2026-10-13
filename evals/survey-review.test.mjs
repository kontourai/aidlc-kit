import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildReviewSessionEvents} from '@kontourai/survey/review-workbench';
import {createRequirementsSurveyReview,serveRequirementsSurveyReview,prepareKitReview} from '../scripts/survey-review.mjs';
import {currentRequirementsReviewFixture} from './helpers/current-requirements-review.mjs';
import {loadRun} from '@kontourai/flow';
import {startReviewConsoleServer} from '@kontourai/survey/review-console';

async function review(t,action,note='',options={}){
  const f=await currentRequirementsReviewFixture(t,options);
  const producer=await prepareKitReview({input:{controllerRoot:f.controllerRoot,pendingFile:f.pendingFile,reference:'Controlled local operator fixture'}});
  const created={sessionFile:producer.sessionPath};
  const server=await startReviewConsoleServer({sessionPath:producer.sessionPath,presentation:producer.presentation,producerApply:{binding:producer.binding,apply:producer.apply}});
  t.after(()=>server.close());
  const initial=JSON.parse(fs.readFileSync(created.sessionFile));
  const decisions=Object.fromEntries(initial.snapshot.items.map(item=>[item.metadata.name,item.metadata.name==='workflow-decision'?(action==='could-not-confirm'?'could-not-confirm':'select-proposed'):'accept-proposed']));
  const state={...initial.snapshot,decisionsByItemName:decisions,selectedCandidateIdsByItemName:action==='could-not-confirm'?{}:{'workflow-decision':action},notesByItemName:{'workflow-decision':note}};
  const events=buildReviewSessionEvents(state,initial.session.metadata.name).filter(event=>event.spec.eventType.startsWith('decision-')||event.spec.eventType==='note-changed');
  const get=async()=>await (await fetch(`${server.url}api/session`)).json();
  const post=async(route,body)=>await fetch(`${server.url}api/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const saved=await post('events',{baseRevision:(await get()).revision,events});assert.equal(saved.status,200,JSON.stringify(await saved.json()));
  return {...f,...created,server,get,post,initial,producer,apply:async()=>post('apply',{baseRevision:(await get()).revision})};
}
const decisions=root=>fs.readdirSync(path.join(root,'authority')).filter(name=>name.endsWith('.json')&&!name.endsWith('.input.json')).map(name=>JSON.parse(fs.readFileSync(path.join(root,'authority',name)))).filter(record=>record.payload?.kind==='controller-decision');

for(const action of ['approve','decline','request-changes','could-not-confirm'])test(`saved Survey ${action} maps distinctly to the real signed controller protocol`,async t=>{
  const f=await review(t,action,action==='request-changes'?'Correct the requirements contradiction':action==='could-not-confirm'?'The supplied evidence does not establish the required behavior':'');
  const before=(await loadRun(f.request.run_id,f.controllerRoot)).state;
  const response=await f.apply();assert.equal(response.status,200,JSON.stringify(await response.json()));
  const recorded=decisions(f.controllerRoot);
  if(action==='could-not-confirm')assert.equal(recorded.length,0);
  else{
    assert.equal(recorded.length,1);
    assert.equal(recorded[0].payload.decision,action==='decline'?'deny':'approve');
    assert.equal(recorded[0].payload.decision_kind,'host-observed-operator-interaction');
    assert.equal(recorded[0].payload.disposition?.review_disposition?.decision,action==='request-changes'?'request_changes':undefined);
  }
  assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state,before);
  assert.equal((await f.apply()).status,409);
  assert.equal(decisions(f.controllerRoot).length,action==='could-not-confirm'?0:1);
  if(action==='approve'){const workers=f.starts.length;assert.equal((await f.resume()).status,'completed');assert.equal(f.starts.length,workers);}
});

for(const drift of ['artifact','source','expiry','actor'])test(`Survey ${drift} drift refuses before controller decisions or progression`,async t=>{
  const f=await review(t,'approve');const before=(await loadRun(f.request.run_id,f.controllerRoot)).state;
  if(drift==='artifact'){const document=f.initial.aidlc.checkpoint.snapshot.items[0].spec.candidates[0];const admitted=JSON.parse(fs.readFileSync(path.join(f.controllerRoot,'review-checkpoints','requirements-analysis.json')));fs.writeFileSync(path.join(f.workspace,admitted.checkpoint.basis[0].path),'Changed artifact');assert.ok(document);}
  if(drift==='source')fs.writeFileSync(path.join(f.workspace,'foreign.js'),'module.exports=true;');
  if(drift==='expiry')f.saveHistory({...f.history,started_at:Date.now()-3600_000});
  if(drift==='actor'){const content=JSON.parse(fs.readFileSync(f.sessionFile));content.snapshot.actorId='personally-authenticated-human';fs.writeFileSync(f.sessionFile,JSON.stringify(content));}
  assert.equal((await f.apply()).status,409);
  assert.equal(decisions(f.controllerRoot).length,0);
  assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state,before);
});

test('a missing correction note cannot become approval or a manufactured concern',async t=>{
  const f=await review(t,'request-changes');assert.equal((await f.apply()).status,409);assert.equal(decisions(f.controllerRoot).length,0);
});

test('receipt recovery after presentation-store loss returns the original signed decision',async t=>{
  const f=await review(t,'approve');assert.equal((await f.apply()).status,200);
  const content=JSON.parse(fs.readFileSync(f.sessionFile)),original=content.producerApplication.reference;delete content.producerApplication;fs.writeFileSync(f.sessionFile,JSON.stringify(content));
  const response=await f.apply();assert.equal(response.status,200);assert.equal((await response.json()).application.reference,original);assert.equal(decisions(f.controllerRoot).length,1);
});

test('two current interfaces cannot record competing decisions for one pending subject',async t=>{
  const f=await review(t,'approve');
  const second=await createRequirementsSurveyReview({...f,reference:'Second controlled local transport'});
  assert.equal((await f.apply()).status,200);
  await assert.rejects(()=>createRequirementsSurveyReview({...f,reference:'Third transport'}),/already has a recorded decision/);
  assert.ok(fs.existsSync(second.sessionFile));assert.equal(decisions(f.controllerRoot).length,1);
});

test('a correction request cannot extend an exhausted original worker budget',async t=>{
  const f=await review(t,'request-changes','Correct the current requirement');
  f.saveHistory({...f.history,starts:Array.from({length:32},()=>f.history.starts[0])});
  assert.equal((await f.apply()).status,409);assert.equal(decisions(f.controllerRoot).length,0);
});


test('native review request fields cannot mint host authority or hide an unsupported subject',async()=>{
  await assert.rejects(()=>prepareKitReview({input:{controllerRoot:'/tmp',pendingFile:'/tmp/pending',reference:'operator',actor:'person'}}),/Unsupported AI-DLC review input/);
  await assert.rejects(()=>prepareKitReview({input:{controllerRoot:'/tmp',pendingFile:'/tmp/pending',reference:'operator'},host:{resolveAuthority:async()=>({status:'approved'})}}),/authenticated host authority is not supported/);
});

for(const stage of ['intent-capture','domain-design'])test(`local ${stage} review presents real artifacts and resumes the ordinary controller`,async t=>{
 const f=await review(t,'approve','',{stage});
 assert.equal(f.initial.aidlc.checkpoint.stage.id,stage);
 assert.ok(f.initial.snapshot.items[0].spec.target.includes(stage==='intent-capture'?'Intent Capture':'Domain Design'));
 assert.ok(f.initial.snapshot.items.at(-1).spec.rationale.includes('Observed review context'));
 const workers=f.starts.length;
 assert.equal((await f.apply()).status,200);
 assert.equal(decisions(f.controllerRoot)[0].payload.stage,stage);
 const resumed=await f.resume();
 if(stage==='intent-capture'){
   assert.equal(resumed.status,'waiting');assert.equal(resumed.failure.detail.pending.purpose,'input-confirmation');
   await assert.rejects(()=>prepareKitReview({input:{controllerRoot:f.controllerRoot,pendingFile:resumed.failure.detail.pending.file,reference:'Input confirmation stays separate'}}),/not input confirmation/);
 }else assert.equal(resumed.status,'completed');
 assert.equal(f.starts.length,workers);
});

test('local design findings remain observed concerns and require fresh author and distinct review',async t=>{
 const finding={id:'DESIGN-1',severity:'medium',reason:'The proposed domain model omits an explicitly required entity',kind:'judgment',status:'open'};
 const f=await review(t,'request-changes','Include the required entity in the domain model',{stage:'domain-design',findings:[finding]});
 assert.ok(f.initial.snapshot.items.at(-1).spec.rationale.includes(finding.reason));
 assert.ok(f.producer.presentation.context.includes(finding.reason));
 assert.ok(f.producer.presentation.context.includes('open'));
 assert.equal(f.producer.presentation.items['workflow-decision'].kind,'choice');
 assert.equal((await f.apply()).status,200);
 const recorded=decisions(f.controllerRoot)[0];
 assert.deepEqual(recorded.payload.disposition.review_disposition.units[0].finding_ids,['DESIGN-1']);
 const oldReviewer=JSON.parse(fs.readFileSync(path.join(f.controllerRoot,'review-checkpoints/domain-design.json'))).checkpoint.prepared.units[0].reviews[0].identity;
 const result=await f.resume();assert.equal(result.status,'waiting',JSON.stringify(result.failure));
 const checkpoint=JSON.parse(fs.readFileSync(path.join(f.controllerRoot,'review-checkpoints/domain-design.json'))).checkpoint;
 assert.equal(checkpoint.prepared.units[0].findings[0].status,'fixed');
 assert.notDeepEqual(checkpoint.prepared.units[0].reviews.at(-1).identity,oldReviewer);
 assert.notEqual(checkpoint.basis[0].digest,f.initial.aidlc.checkpoint.snapshot.items[0].spec.candidates[0].source.sourceRef.split('sha256=')[1]);
 assert.equal((await f.apply()).status,409);
 const fresh=await prepareKitReview({input:{controllerRoot:f.controllerRoot,pendingFile:result.failure.detail.pending.file,reference:'Review the corrected current proposal'}});
 const server=await startReviewConsoleServer({sessionPath:fresh.sessionPath,producerApply:{binding:fresh.binding,apply:fresh.apply}});t.after(()=>server.close());
 const session=JSON.parse(fs.readFileSync(fresh.sessionPath));
 assert.ok(session.snapshot.items[0].spec.candidates[0].value.includes('Corrected proposal'));
 const state={...session.snapshot,decisionsByItemName:Object.fromEntries(session.snapshot.items.map(item=>[item.metadata.name,item.metadata.name==='workflow-decision'?'select-proposed':'accept-proposed'])),selectedCandidateIdsByItemName:{'workflow-decision':'approve'}};
 const events=buildReviewSessionEvents(state,session.session.metadata.name).filter(event=>event.spec.eventType.startsWith('decision-')||event.spec.eventType==='note-changed');
 const get=async()=>await(await fetch(server.url+'api/session')).json();
 const post=async(route,body)=>fetch(server.url+'api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('events',{baseRevision:(await get()).revision,events})).status,200);
 assert.equal((await post('apply',{baseRevision:(await get()).revision})).status,200);
 assert.equal((await f.resume()).status,'completed');
 assert.equal(decisions(f.controllerRoot).length,2);
 assert.deepEqual(f.executions.map(x=>x.phase),['inline','review','revise','review']);
});

test('review presentation exposes the wait and findings without changing artifact identity or action values',async t=>{
 const f=await review(t,'approve','',{stage:'domain-design'});
 const {presentation}=f.producer;
 assert.equal(presentation.title,'Domain Design review');
 assert.ok(presentation.context.includes('Waiting for your decision'));
 assert.ok(presentation.context.includes(f.initial.aidlc.checkpoint.budget.deadline));
 assert.deepEqual(presentation.items['workflow-decision'].candidateLabels,{approve:'Approve','request-changes':'Request changes',decline:'Decline'});
 for(const item of f.initial.snapshot.items.filter(item=>item.metadata.name!=='workflow-decision')){
   assert.equal(presentation.items[item.metadata.name].kind,'acknowledgment');
   assert.ok(!presentation.items[item.metadata.name].title.includes('SHA-256'));
   assert.ok(item.spec.target.includes('SHA-256'));
   assert.ok(item.spec.candidates[0].source.sourceRef.includes('#sha256='));
 }
 assert.deepEqual((await f.get()).presentation,presentation);
 assert.equal((await f.apply()).status,200);
 const summary=(await f.get()).producerApplication.summary;
 assert.ok(summary.includes('Approval recorded'));
 assert.ok(summary.includes('original flow-agents kit run aidlc request'));
});

test('editing retained presentation cannot hide findings behind a new producer binding',async t=>{
 const f=await review(t,'approve','',{stage:'domain-design'});
 const content=JSON.parse(fs.readFileSync(f.sessionFile));
 content.aidlc.checkpoint.presentation.context='Nothing to review';
 fs.writeFileSync(f.sessionFile,JSON.stringify(content));
 assert.equal((await f.apply()).status,409);
 assert.equal(decisions(f.controllerRoot).length,0);
});

test('accepting a design card cannot waive an open observed finding',async t=>{
 const f=await review(t,'approve','',{stage:'domain-design',findings:[{id:'DESIGN-1',severity:'medium',reason:'Missing entity',kind:'judgment',status:'open'}]});
 assert.equal((await f.apply()).status,409);assert.equal(decisions(f.controllerRoot).length,0);
});

for(const drift of ['artifact','source','expiry'])test(`local design ${drift} drift refuses before recording a decision`,async t=>{
 const f=await review(t,'approve','',{stage:'domain-design'});
 const before=(await loadRun(f.request.run_id,f.controllerRoot)).state;
 if(drift==='artifact'){const c=JSON.parse(fs.readFileSync(path.join(f.controllerRoot,'review-checkpoints/domain-design.json'))).checkpoint;fs.writeFileSync(path.join(f.workspace,c.basis[0].path),'A different proposed design');}
 if(drift==='source')fs.writeFileSync(path.join(f.workspace,'foreign.mjs'),'export const changed=true;');
 if(drift==='expiry')f.saveHistory({...f.history,started_at:Date.now()-3600_000});
 assert.equal((await f.apply()).status,409);
 assert.equal(decisions(f.controllerRoot).length,0);
 assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state,before);
});
