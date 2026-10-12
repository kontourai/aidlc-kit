import fs from 'node:fs';
import path from 'node:path';
import {digest,requestBindingDigest} from './compile.mjs';
import {inspectControllerReview} from './authority.mjs';
import {readArtifact} from './artifacts.mjs';

const must=(condition,message)=>{if(!condition)throw new Error(message);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

/** The host calls this under its controller lock before presentation and again
 * before application. Browser/MCP input supplies neither authority nor budgets. */
export async function inspectRequirementsReview({controllerRoot,pendingFile}) {
  const input=await inspectControllerReview({controllerRoot,pendingFile});
  must(input.stage==='requirements-analysis','This review interface handles requirements artifacts only');
  const admission=read(path.join(controllerRoot,'request-admission.json'));
  const request=admission.request;
  must(admission.version==='1.0'&&admission.effective_request_digest===input.request_digest&&requestBindingDigest(request)===input.request_digest,'Review execution request is not the retained admitted request');
  must(request.run_id===input.run_id&&fs.realpathSync(request.workspace)===fs.realpathSync(input.workspace),'Review execution scope changed');
  const execution=request.execution;
  must(Number.isSafeInteger(execution?.max_turns)&&execution.max_turns>0&&execution.max_turns<=10000&&Number.isFinite(execution.timeout_s)&&execution.timeout_s>0&&execution.timeout_s<=86400,'Review requires the original finite execution budget');
  const saved=read(path.join(controllerRoot,'executor-history.json'));
  const history=saved.history;
  must(saved.digest===digest(history)&&history.binding===digest({run_id:request.run_id,execution:request.execution,image:request.engine_sandbox?.image,workspace:fs.realpathSync(request.workspace)})&&Array.isArray(history.starts)&&history.starts.length<=execution.max_turns&&Number.isFinite(history.started_at),'Review execution history changed');
  const deadline=history.started_at+execution.timeout_s*1000;
  must(Date.now()>=history.started_at&&Date.now()<deadline,'Review execution deadline expired or could not be confirmed');
  must(history.starts.every(start=>Number.isInteger(start.worker?.terminal?.status)&&(start.worker.container_removed===true||start.worker.observed?.execution_profile==='host-native'&&start.worker.engine_outcome==='completed')),'Review requires every started worker to be observed and settled');
  const checkpoint=read(path.join(controllerRoot,'review-checkpoints',`${input.stage}.json`)).checkpoint;
  const documents=[];let bytes=0;
  for(const ref of checkpoint.basis){
    const artifact=readArtifact(input.workspace,ref.path);
    must(artifact.digest===ref.digest,'Review artifact bytes changed');
    must(digest(artifact.text)===artifact.digest,'Review artifact cannot be presented faithfully as UTF-8 text');
    bytes+=artifact.bytes;must(bytes<=16*1024*1024&&documents.length<512,'Review artifact presentation exceeds bounds');
    documents.push({path:ref.path,digest:artifact.digest,text:artifact.text});
  }
  must(documents.length>0,'Review has no observed artifacts');
  must(Date.now()<deadline,'Review execution deadline expired during presentation admission');
  return {input,documents,basis_digest:digest({input,documents:documents.map(({path,digest})=>({path,digest}))}),budget:{deadline:new Date(deadline).toISOString(),max_workers:execution.max_turns,started_workers:history.starts.length,remaining_workers:execution.max_turns-history.starts.length}};
}
