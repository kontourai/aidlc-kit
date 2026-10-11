import fs from 'node:fs';import path from 'node:path';
import {loadRun} from '@kontourai/flow';
import {digest} from './compile.mjs';import {readArtifact} from './artifacts.mjs';import {snapshotWorkspace} from './workspace.mjs';import {checkpointRetryIdentity} from './dispatch-checkpoints.mjs';import {verifyControllerCheckpoint} from './authority.mjs';
const must=(condition,message)=>{if(!condition)throw new Error(message);};
export function validateOperatorConcerns(concerns,unit){must(Array.isArray(concerns)&&concerns.length<=32&&Buffer.byteLength(JSON.stringify(concerns))<=65536,'Operator concern inventory exceeds bounded context');
 const known=new Set([...(unit.findings??[]),...(unit.operator_concerns??[]),...(unit.reviews??[]).flatMap(review=>review.findings??[])].map(finding=>finding.id)),operatorIds=new Set();
  for(const concern of concerns){must(concern&&typeof concern==='object'&&!Array.isArray(concern)&&Object.keys(concern).every(key=>['id','severity','reason'].includes(key))&&/^operator:[a-z0-9][a-z0-9-]{0,95}$/.test(concern.id)&&!operatorIds.has(concern.id)&&!known.has(concern.id)&&['critical','high','medium','low','info'].includes(concern.severity)&&typeof concern.reason==='string'&&concern.reason.trim()&&concern.reason.length<=8192&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(concern.reason),'Invalid, duplicate or colliding operator review concern');operatorIds.add(concern.id);}
}
export function validateReviewDisposition(input,disposition){
 const action=disposition?.review_disposition;if(action===undefined)return null;
 must(Object.keys(disposition).every(key=>key==='review_disposition'),'Revision request cannot include finding acceptance or other authority');
 must(input.purpose==='review-disposition'&&action&&typeof action==='object'&&!Array.isArray(action)&&Object.keys(action).every(key=>['decision','units'].includes(key))&&action.decision==='request_changes'&&Array.isArray(action.units)&&action.units.length>0&&action.units.length<=128,'Invalid review revision disposition');
 const observed=input.decision?.units??(input.unit?[{id:input.unit,status:'awaiting_decision',findings:input.findings,operator_concerns:input.operator_concerns,continuation:{phase:input.continuation_phase}}]:[]),ids=new Set();
 for(const requested of action.units){
  must(requested&&typeof requested==='object'&&!Array.isArray(requested)&&Object.keys(requested).every(key=>['id','finding_ids','operator_concerns','clarification'].includes(key))&&typeof requested.id==='string'&&!ids.has(requested.id)&&typeof requested.clarification==='string'&&requested.clarification.trim()&&requested.clarification.length<=8192&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(requested.clarification),'Invalid review revision unit or clarification');ids.add(requested.id);
  const unit=observed.find(unit=>unit.id===requested.id);must(unit?.status==='awaiting_decision'&&unit.continuation?.phase==='review-decision','Review revision does not target a current advisory disposition');
  must(Array.isArray(requested.finding_ids)&&requested.finding_ids.length>=0&&requested.finding_ids.length<=256&&new Set(requested.finding_ids).size===requested.finding_ids.length&&requested.finding_ids.every(id=>unit.findings?.some(finding=>finding.id===id&&finding.status==='open')),'Review revision finding IDs differ from the current open findings');
  const concerns=requested.operator_concerns??[];must(Array.isArray(concerns)&&concerns.length<=32&&(requested.finding_ids.length>0||concerns.length>0),'Review revision requires actual model findings or explicit operator concerns');
  validateOperatorConcerns(concerns,unit);
 }
 must(Buffer.byteLength(JSON.stringify(action))<=65536,'Review revision disposition exceeds bounded context');
 return action;
}
/** Ordinary CLI verifies canonical custody before recording a revision grant.
 * The original request and source authority stay unchanged. */
export async function validateReviewVisit({input,controllerRoot,disposition}){
 must(typeof input.run_id==='string'&&typeof input.workspace==='string'&&input.review_admission,'Review disposition lacks current host admission');
 const run=await loadRun(input.run_id,controllerRoot);must(run.state.status==='active'&&run.state.current_step===input.stage&&digest(checkpointRetryIdentity(run))===input.review_admission,'Review disposition Flow visit changed');
 const file=path.join(controllerRoot,'review-checkpoints',`${input.stage}.json`);must(fs.existsSync(file),'Review producer checkpoint missing');const saved=JSON.parse(fs.readFileSync(file));must(verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope}),'Review producer checkpoint signature changed');
 if(input.decision){const normalized=value=>{const copy=structuredClone(value);delete copy.pending;for(const record of copy.units??[])for(const receipt of record.receipts??[]){delete receipt.replayed;delete receipt.persisted;}return copy;};must(digest(normalized(saved.checkpoint.prepared))===digest(normalized(input.decision)),'Review disposition differs from the retained observed aggregate');}
 else{const record=saved.checkpoint.prepared.units.find(record=>record.id===input.unit);must(record&&record.continuation?.phase===input.continuation_phase&&saved.checkpoint.prepared.max_review_revisions===input.max_review_revisions&&(record.review_revisions??0)===input.review_revisions&&digest(record.basis)===digest(input.basis)&&digest(record.receipts.map(receipt=>receipt.receipt))===digest(input.execution_receipts)&&digest(record.reviews.map(review=>review.receipt))===digest(input.review_receipts)&&digest(record.findings)===digest(input.findings)&&digest(record.operator_concerns??[])===digest(input.operator_concerns??[])&&digest(record.dissent)===digest(input.dissent),'Review disposition differs from the retained observed unit');}
 const maximum=saved.checkpoint.prepared.max_review_revisions;must(Number.isSafeInteger(maximum)&&maximum>=1&&maximum<=16,'Review revision budget lacks sealed host admission');
 for(const requested of disposition?.review_disposition?.units??[]){const record=saved.checkpoint.prepared.units.find(unit=>unit.id===requested.id),count=record?.review_revisions??0;must(record&&Number.isSafeInteger(count)&&count>=0&&count<maximum,'Operator review revision budget exhausted');}
 for(const ref of saved.checkpoint.basis)must(readArtifact(input.workspace,ref.path).digest===ref.digest,'Review disposition artifact basis changed');
 const source=snapshotWorkspace(input.workspace).source_digest,waiting=saved.checkpoint.prepared.units.filter(record=>record.status==='awaiting_decision');must(waiting.every(record=>record.basis.source_digest===source),'Review disposition source basis changed');
}

export function unitReviewInput({record,stage,run_id,workspace,review_admission,request_digest,max_review_revisions}){
 return {kind:record.reason,stage,unit:record.id,basis:structuredClone(record.basis),continuation_phase:record.continuation?.phase??null,max_review_revisions,review_revisions:record.review_revisions??0,execution_receipts:record.receipts.map(observed=>structuredClone(observed.receipt)),review_receipts:record.reviews.map(review=>structuredClone(review.receipt)),findings:structuredClone(record.findings),operator_concerns:structuredClone(record.operator_concerns??[]),dissent:structuredClone(record.dissent),purpose:'review-disposition',run_id,workspace,review_admission,request_digest};
}
