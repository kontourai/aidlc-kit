#!/usr/bin/env node
import {executeRequestFile} from './run.mjs';
import {readSnapshot,generatedFiles} from './compile.mjs';
const [command,...args]=process.argv.slice(2);
const get=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
if(command==='run'){
 const requestFile=get('--request'),controllerRoot=get('--controller-root');
 if(!requestFile||!controllerRoot)throw new Error('Usage: aidlc run --request <kit-request.json> --controller-root <private-root> --auth-file <host-auth.json>');
 const result=await executeRequestFile({requestFile,controllerRoot,authFile:get('--auth-file')});
 console.log(JSON.stringify(result));
 if(!['completed','waiting'].includes(result.status))process.exitCode=1;
}else if(command==='profiles')console.log(JSON.stringify(Object.keys(readSnapshot().profiles)));
else if(command==='check'){
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[new URL('./compile.mjs',import.meta.url).pathname,'--check'],{stdio:'inherit'});process.exitCode=result.status??1;
}else if(command==='--help'||command==='help'||!command)console.log('aidlc profiles | check | run --request <kit-request.json> --controller-root <private-root> --auth-file <host-auth.json>');
else throw new Error(`Unknown command: ${command}`);
