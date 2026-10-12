import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildReviewSessionEvents} from '@kontourai/survey/review-workbench';
import {createRequirementsSurveyReview,serveRequirementsSurveyReview} from '../scripts/survey-review.mjs';
import {currentRequirementsReviewFixture} from './helpers/current-requirements-review.mjs';
import {loadRun} from '@kontourai/flow';

async function review(t,action,note=''){
  const f=await currentRequirementsReviewFixture(t);
  const created=await createRequirementsSurveyReview({...f,reference:'Controlled local operator fixture'});
  const server=await serveRequirementsSurveyReview({controllerRoot:f.controllerRoot,sessionPath:created.sessionFile});
  t.after(()=>server.close());
  const initial=JSON.parse(fs.readFileSync(created.sessionFile));
  const decisions=Object.fromEntries(initial.snapshot.items.map(item=>[item.metadata.name,item.metadata.name==='workflow-decision'?(action==='could-not-confirm'?'could-not-confirm':'select-proposed'):'accept-proposed']));
  const state={...initial.snapshot,decisionsByItemName:decisions,selectedCandidateIdsByItemName:action==='could-not-confirm'?{}:{'workflow-decision':action},notesByItemName:{'workflow-decision':note}};
  const events=buildReviewSessionEvents(state,initial.session.metadata.name).filter(event=>event.spec.eventType.startsWith('decision-')||event.spec.eventType==='note-changed');
  const get=async()=>await (await fetch(`${server.url}api/session`)).json();
  const post=async(route,body)=>await fetch(`${server.url}api/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const saved=await post('events',{baseRevision:(await get()).revision,events});assert.equal(saved.status,200,JSON.stringify(await saved.json()));
  return {...f,...created,server,get,post,initial,apply:async()=>post('apply',{baseRevision:(await get()).revision})};
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
