#!/usr/bin/env node
import {executeRequestFile} from './run.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {withControllerLock} from './controller-lock.mjs';
import {recomposeRun} from './recomposition.mjs';
import {recordControllerDecision} from './authority.mjs';
import {readSnapshot,generatedFiles} from './compile.mjs';
const [command,...args]=process.argv.slice(2);
const get=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
if(command==='run'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root');
 if(!requestFile||!controllerRoot)throw new Error('Usage: aidlc run --request <kit-request.json> --controller-root <private-root> --auth-file <host-auth.json>');
 const result=await executeRequestFile({requestFile,controllerRoot,authFile:get('--auth-file')});
 console.log(JSON.stringify(result));
 if(!['completed','waiting'].includes(result.status))process.exitCode=1;
}else if(command==='recompose'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root'),proposalFile=get('--proposal');
 if(!requestFile||!controllerRoot||!proposalFile)throw new Error('Usage: aidlc recompose --request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json>');
 console.log(JSON.stringify(await recomposeRun({request:JSON.parse(fs.readFileSync(requestFile,'utf8')),controllerRoot,proposal:JSON.parse(fs.readFileSync(proposalFile,'utf8'))})));
}else if(command==='decisions'){
 const controllerRoot=get('--controller-root');if(!controllerRoot)throw new Error('Usage: aidlc decisions --controller-root <private-root>');
 const root=path.join(path.resolve(controllerRoot),'authority/pending');
 const pending=fs.existsSync(root)?fs.readdirSync(root).filter(file=>file.endsWith('.json')).map(file=>({file:path.join(root,file),...JSON.parse(fs.readFileSync(path.join(root,file),'utf8')).payload})):[];
 console.log(JSON.stringify(pending,null,2));
}else if(command==='decide'){
 const controllerRoot=get('--controller-root'),pendingFile=get('--pending'),reference=get('--reference');
 if(!controllerRoot||!pendingFile||!reference)throw new Error('Usage: aidlc decide --controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference> [--decision approve|deny] [--disposition <explicit-disposition.json>]');
 const dispositionFile=get('--disposition'),disposition=dispositionFile?JSON.parse(fs.readFileSync(dispositionFile,'utf8')):undefined;
 console.log(JSON.stringify(await withControllerLock(controllerRoot,()=>recordControllerDecision({controllerRoot,pendingFile,reference,disposition,decision:get('--decision')??'approve'}))));
}else if(command==='profiles')console.log(JSON.stringify(Object.keys(readSnapshot().profiles)));
else if(command==='check'){
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[new URL('./compile.mjs',import.meta.url).pathname,'--check'],{stdio:'inherit'});process.exitCode=result.status??1;
}else if(command==='--help'||command==='help'||!command)console.log('aidlc profiles | check | recompose --request <original-kit-request.json> --controller-root <private-root> --proposal <pending-stage-delta.json> | run --request <kit-request.json> --controller-root <private-root> --auth-file <host-auth.json> | decisions --controller-root <private-root> | decide --controller-root <private-root> --pending <signed-pending.json> --reference <operator-reference>');
else throw new Error(`Unknown command: ${command}`);
