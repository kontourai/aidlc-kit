import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from './compile.mjs';
import {inspectRequirementsReview} from './review-admission.mjs';
import {recordControllerInteraction,findControllerReviewDecision,sealControllerCheckpoint,verifyControllerCheckpoint} from './authority.mjs';
import {withControllerLock} from './controller-lock.mjs';

const must=(condition,message)=>{if(!condition)throw new Error(message);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const actions=['approve','request-changes','decline'];
async function survey(){try{return await import('@kontourai/survey/review-workbench');}catch{throw new Error('Optional review requires @kontourai/survey@8.1.0 or a compatible later version');}}
function sessionFile(controllerRoot,file){const root=fs.realpathSync(path.join(controllerRoot,'survey-reviews')),real=fs.realpathSync(file);must(path.dirname(real)===root,'Review must be a retained private Survey session');return real;}
function assertSession(controllerRoot,content){
  const domain=content.aidlc?.checkpoint;
  must(domain?.version==='1.0'&&domain.kind==='requirements-survey-review'&&verifyControllerCheckpoint({controllerRoot,checkpoint:domain,envelope:content.aidlc?.envelope}),'Survey producer binding signature changed');
  must(digest(content.snapshot)===digest(domain.snapshot)&&content.session?.metadata?.name===domain.id,'Survey review snapshot or identity changed');
  return domain;
}

/** Create an optional presentation over an existing signed wait, not a new process. */
export async function createRequirementsSurveyReview({controllerRoot,pendingFile,reference}){
  must(typeof reference==='string'&&reference.trim()&&reference.length<=512,'Explicit host-observed operator reference required');
  const api=await survey();
  return withControllerLock(controllerRoot,async()=>{
    const admitted=await inspectRequirementsReview({controllerRoot,pendingFile});
    must(!findControllerReviewDecision({controllerRoot,pendingFile}),'This current review already has a recorded decision');
    must(admitted.input.decision?.units?.length===1&&admitted.input.decision.units[0].id==='stage','This review interface requires a single requirements stage unit');
    const id=randomUUID(),at=new Date().toISOString(),sourceId=`aidlc-review:${id}`;
    const candidate=(name,value,target)=>({id:name,role:'proposed',value,source:{sourceId,sourceRef:`controller-review:${admitted.basis_digest}`,kind:'manual-entry',observedAt:at,locatorScheme:'structured-field'},extraction:{extractionId:`${name}:observation`,target,extractor:'aidlc-host-artifact-observer',extractedAt:at},locator:{scheme:'structured-field'},claimTarget:{claimId:`${name}:claim`,subjectType:'artifact-set',subjectId:admitted.basis_digest,facet:'workflow',claimType:'workflow.review-observation',fieldOrBehavior:target,impactLevel:'high',collectedBy:'aidlc-host'}});
    const items=admitted.documents.map((document,index)=>({apiVersion:'survey.kontourai.io/v1alpha1',kind:'ReviewItem',metadata:{name:`document-${index}`,producer:{displayName:`Requirements review — deadline ${admitted.budget.deadline} — ${admitted.budget.remaining_workers} worker slots remaining`}},spec:{target:`Requirements artifact: ${document.path} (SHA-256 ${document.digest})`,candidates:[{...candidate(`document-${index}:proposed`,document.text,document.path),source:{...candidate(`document-${index}:proposed`,document.text,document.path).source,sourceRef:`workspace-artifact:${document.path}#sha256=${document.digest}`},locator:{scheme:'structured-field',excerpt:document.text}}],editable:false,rationale:'Inspect the current artifact bytes. Accepting this card acknowledges this artifact; the separate workflow decision controls approval.'}}));
    items.push({apiVersion:'survey.kontourai.io/v1alpha1',kind:'ReviewItem',metadata:{name:'workflow-decision'},spec:{target:'Decision for this exact requirements artifact set',candidateSetStatus:'conflict',editable:false,candidates:actions.map(action=>candidate(action,action==='approve'?'Approve this artifact basis':action==='decline'?'Decline this artifact basis':'Request changes — describe the required correction in the note',action)),rationale:`Host-observed operator interaction; no personal human authentication is asserted. Original deadline: ${admitted.budget.deadline}. Remaining worker slots: ${admitted.budget.remaining_workers}. Choose one action, or Could not confirm with a reason. Decisions supply no missing questionnaire answers.`}});
    const snapshot={items,activeItemName:items[0].metadata.name,notesByItemName:{},decisionsByItemName:{},reviewedAt:at,actorId:'host-observed:local-operator'};
    const binding=api.bindReviewQueue(snapshot,{sessionName:id});
    const checkpoint={version:'1.0',kind:'requirements-survey-review',id,pendingFile:fs.realpathSync(pendingFile),basis_digest:admitted.basis_digest,reference:`survey-review:${id}:${reference}`,snapshot,binding,budget:admitted.budget};
    const content={session:{apiVersion:'survey.kontourai.io/v1alpha1',kind:'ReviewSession',metadata:{name:id}},snapshot,events:[],aidlc:{checkpoint,envelope:sealControllerCheckpoint({controllerRoot,checkpoint})}};
    const root=path.join(fs.realpathSync(controllerRoot),'survey-reviews');fs.mkdirSync(root,{recursive:true,mode:0o700});const file=path.join(root,`${id}.json`);
    fs.writeFileSync(file,JSON.stringify(content,null,2)+'\n',{flag:'wx',mode:0o600});
    return {sessionFile:file,budget:admitted.budget,decision_kind:'host-observed-operator-interaction'};
  });
}

function decisionFor(domain,results){
  const choice=results.find(result=>result.reviewItemName==='workflow-decision');must(choice,'Workflow decision is missing');
  const documents=results.filter(result=>result.reviewItemName!=='workflow-decision');
  must(documents.length===domain.snapshot.items.length-1,'Review document inventory changed');
  if(results.some(result=>result.decision==='could-not-confirm'))return {action:'could-not-confirm',note:results.filter(result=>result.decision==='could-not-confirm').map(result=>result.reviewDecision?.spec?.rationale??result.reviewOutcome?.note??'Could not confirm').join('\n')};
  must(documents.every(result=>result.decision==='accept-proposed'),'Every current artifact must be inspected and accepted before selecting a workflow action');
  must(choice.decision==='select-proposed'&&actions.includes(choice.selectedCandidateId),'Choose an explicit workflow action');
  const note=choice.reviewDecision?.spec?.rationale??choice.reviewOutcome?.note??'';
  if(choice.selectedCandidateId==='request-changes')must(typeof note==='string'&&note.trim()&&note.length<=4096,'Request changes requires a bounded correction note');
  return {action:choice.selectedCandidateId,note};
}

/** Only server-derived Survey results reach this host-owned application path. */
async function applyRequirementsSurveyReview({controllerRoot,sessionPath}){
  const api=await survey();
  return withControllerLock(controllerRoot,async()=>{
    const file=sessionFile(controllerRoot,sessionPath),content=read(file),domain=assertSession(controllerRoot,content);
    const derived=api.deriveReviewSessionApplyResultForSnapshot({snapshot:domain.snapshot,events:content.events,requiredResolvedItems:'all'});
    must(derived.ok,'Resolve every current review item before application');
    const decision=decisionFor(domain,derived.results);
    const disposition=decision.action==='request-changes'?{review_disposition:{decision:'request_changes',units:[{id:'stage',finding_ids:[],operator_concerns:[{id:`operator:survey-${digest({id:domain.id,note:decision.note}).slice(0,24)}`,severity:'medium',reason:decision.note}],clarification:decision.note}]}}:undefined;
    const expected=decision.action==='decline'?'deny':'approve';
    const prior=findControllerReviewDecision({controllerRoot,pendingFile:domain.pendingFile,reference:domain.reference});
    if(prior){must(decision.action!=='could-not-confirm'&&prior.payload.decision===expected&&digest(prior.payload.disposition)===digest(disposition??null),'This review already recorded a different decision');return {reference:`controller-decision:${prior.payload.id}`,summary:`Previously recorded ${decision.action}; no second decision was written`};}
    must(!findControllerReviewDecision({controllerRoot,pendingFile:domain.pendingFile}),'Another transport already recorded a decision for this review');
    const feedbackFile=path.join(path.dirname(file),`${domain.id}.feedback.json`);
    if(fs.existsSync(feedbackFile)){const saved=read(feedbackFile);must(verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope})&&saved.checkpoint.basis_digest===domain.basis_digest&&decision.action==='could-not-confirm'&&saved.checkpoint.note===decision.note,'Review feedback changed');return {reference:`controller-review-feedback:${domain.id}`,summary:'Could not confirm; no approval was recorded'};}
    const current=await inspectRequirementsReview({controllerRoot,pendingFile:domain.pendingFile});
    must(current.basis_digest===domain.basis_digest,'Review artifact or visit basis changed while the interface was open');
    if(decision.action==='could-not-confirm'){
      const checkpoint={kind:'requirements-review-feedback',id:domain.id,basis_digest:domain.basis_digest,note:decision.note,recorded_at:new Date().toISOString()};
      fs.writeFileSync(feedbackFile,JSON.stringify({checkpoint,envelope:sealControllerCheckpoint({controllerRoot,checkpoint})})+'\n',{flag:'wx',mode:0o600});
      return {reference:`controller-review-feedback:${domain.id}`,summary:'Could not confirm; no approval was recorded'};
    }
    if(decision.action==='request-changes')must(current.budget.remaining_workers>=2,'Original worker budget cannot admit a new author and distinct reviewer');
    const result=await recordControllerInteraction({controllerRoot,pendingFile:domain.pendingFile,reference:domain.reference,decision:expected,disposition});
    return {reference:result.reference,summary:decision.action==='approve'?'Approval recorded for this exact requirements basis; continue through the existing controller':decision.action==='decline'?'Decline recorded; the requirements remain unapproved':'Correction requested; a new author and distinct review are required'};
  });
}

export async function serveRequirementsSurveyReview({controllerRoot,sessionPath,port=0}){
  const content=read(sessionFile(controllerRoot,sessionPath)),domain=assertSession(controllerRoot,content);
  let api;try{api=await import('@kontourai/survey/review-console');}catch{throw new Error('Optional console requires @kontourai/survey@8.1.0 or a compatible later version');}
  return api.startReviewConsoleServer({sessionPath,port,producerApply:{binding:domain.binding,apply:()=>applyRequirementsSurveyReview({controllerRoot,sessionPath})}});
}
