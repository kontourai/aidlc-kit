#!/usr/bin/env node
import {executeRequestFile} from './run.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {withControllerLock,recoverControllerLock} from './controller-lock.mjs';
import {reviseInput} from './input-revisions.mjs';
import {recomposeRun} from './recomposition.mjs';
import {recordControllerInteraction} from './authority.mjs';
import {readSnapshot,generatedFiles} from './compile.mjs';
const [command,...args]=process.argv.slice(2);
const get=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const HELP='kontour-aidlc profiles | check | revise-input --request <original-request.json> --controller-root <private-root> --pending <current-signed-wait.json> --proposal <exact-input-revision.json> | recover-controller --controller-root <private-root> | recompose --request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json> | run --request <kit-request.json> --controller-root <private-root> [--auth-file <host-auth.json>] | review --controller-root <private-root> --pending <current-signed-review.json> --reference <host-operator-reference> [--port <port>] | inspect-review --controller-root <private-root> --pending <current-signed-review.json> | decisions --controller-root <private-root> | decide --controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference>';
// Usage errors are operator input mistakes, not faults: print the message without a stack and exit 2,
// keeping exit 1 for commands that ran and failed.
const usage=message=>{process.stderr.write(`kontour-aidlc: ${message}\n`);process.exit(2);};
if(command==='run'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root');
 if(!requestFile||!controllerRoot)usage('Usage: kontour-aidlc run --request <kit-request.json> --controller-root <private-root> [--auth-file <host-auth.json>]');
 const result=await executeRequestFile({requestFile,controllerRoot,authFile:get('--auth-file')});
 console.log(JSON.stringify(result));
 if(!['completed','waiting'].includes(result.status))process.exitCode=1;
}else if(command==='recover-controller'){
 const controllerRoot=get('--controller-root');if(!controllerRoot)usage('Usage: kontour-aidlc recover-controller --controller-root <private-root>');console.log(JSON.stringify(recoverControllerLock(controllerRoot)));
}else if(command==='revise-input'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root'),pendingFile=get('--pending'),proposalFile=get('--proposal');
 if(!requestFile||!controllerRoot||!pendingFile||!proposalFile)usage('Usage: kontour-aidlc revise-input --request <original-request.json> --controller-root <private-root> --pending <current-signed-wait.json> --proposal <exact-input-revision.json>');
 console.log(JSON.stringify(await reviseInput({request:JSON.parse(fs.readFileSync(requestFile,'utf8')),controllerRoot,pendingFile,proposal:JSON.parse(fs.readFileSync(proposalFile,'utf8'))})));
}else if(command==='recompose'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root'),proposalFile=get('--proposal');
 if(!requestFile||!controllerRoot||!proposalFile)usage('Usage: kontour-aidlc recompose --request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json>');
 console.log(JSON.stringify(await recomposeRun({request:JSON.parse(fs.readFileSync(requestFile,'utf8')),controllerRoot,proposal:JSON.parse(fs.readFileSync(proposalFile,'utf8'))})));
}else if(command==='decisions'){
 const controllerRoot=get('--controller-root');if(!controllerRoot)usage('Usage: kontour-aidlc decisions --controller-root <private-root>');
 const root=path.join(path.resolve(controllerRoot),'authority/pending');
 const pending=fs.existsSync(root)?fs.readdirSync(root).filter(file=>file.endsWith('.json')).map(file=>({file:path.join(root,file),...JSON.parse(fs.readFileSync(path.join(root,file),'utf8')).payload})):[];
 console.log(JSON.stringify(pending,null,2));
}else if(command==='review'){
 const controllerRoot=get('--controller-root'),pendingFile=get('--pending'),reference=get('--reference');
 if(!controllerRoot||!pendingFile||!reference)usage('Usage: kontour-aidlc review --controller-root <private-root> --pending <current-signed-review.json> --reference <host-operator-reference> [--port <port>]');
 const port=get('--port')===null?0:Number(get('--port'));if(!Number.isInteger(port)||port<0||port>65535)usage('Review port must be an integer from 0 to 65535');
 const {createArtifactSurveyReview,serveArtifactSurveyReview}=await import('./survey-review.mjs');
 const created=await createArtifactSurveyReview({controllerRoot,pendingFile,reference});
 const server=await serveArtifactSurveyReview({controllerRoot,sessionPath:created.sessionFile,port});
 console.log(JSON.stringify({...created,url:server.url}));
 const close=()=>server.close().then(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}else if(command==='inspect-review'){
 const controllerRoot=get('--controller-root'),pendingFile=get('--pending');
 if(!controllerRoot||!pendingFile)usage('Usage: kontour-aidlc inspect-review --controller-root <private-root> --pending <current-signed-review.json>');
 const {inspectArtifactReview}=await import('./review-admission.mjs');
 console.log(JSON.stringify(await withControllerLock(controllerRoot,()=>inspectArtifactReview({controllerRoot,pendingFile}))));
}else if(command==='decide'){
 const controllerRoot=get('--controller-root'),pendingFile=get('--pending'),reference=get('--reference');
 if(!controllerRoot||!pendingFile||!reference)usage('Usage: kontour-aidlc decide --controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference> [--decision approve|deny] [--disposition <explicit-disposition.json>]');
 const dispositionFile=get('--disposition'),disposition=dispositionFile?JSON.parse(fs.readFileSync(dispositionFile,'utf8')):undefined;
 console.log(JSON.stringify(await withControllerLock(controllerRoot,()=>recordControllerInteraction({controllerRoot,pendingFile,reference,disposition,decision:get('--decision')??'approve'}))));
}else if(command==='profiles')console.log(JSON.stringify(Object.keys(readSnapshot().profiles)));
else if(command==='check'){
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[new URL('./compile.mjs',import.meta.url).pathname,'--check'],{stdio:'inherit'});process.exitCode=result.status??1;
}else if(command==='--help'||command==='help'||!command)console.log(HELP);
else usage(`Unknown command: ${command}\nUsage: ${HELP}`);
