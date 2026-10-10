import fs from 'node:fs';
import path from 'node:path';
import {requestBindingDigest,requestBindingValue,digest} from './compile.mjs';

/** Retain the original input binding beside its exact host-admitted projection.
 * Runtime access capabilities and owner ids never become durable authorization. */
export function retainRequestAdmission({request,originalDigest,controllerRoot}){
 const file=path.join(controllerRoot,'request-admission.json'),record={version:'1.0',original_request_digest:originalDigest,effective_request_digest:requestBindingDigest(request),request:requestBindingValue(request)};
 if(fs.existsSync(file)){if(digest(JSON.parse(fs.readFileSync(file,'utf8')))!==digest(record))throw new Error('Original or admitted execution request changed');}
 else fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 return record;
}
export function admittedRecompositionRequest({request,controllerRoot}){
 const file=path.join(controllerRoot,'request-admission.json');if(!fs.existsSync(file))return structuredClone(request);
 const record=JSON.parse(fs.readFileSync(file,'utf8'));if(record.version!=='1.0'||record.original_request_digest!==requestBindingDigest(request)||record.effective_request_digest!==requestBindingDigest(record.request))throw new Error('Original recomposition request or admitted projection changed');
 const bindingFile=path.join(controllerRoot,'binding.json');if(!fs.existsSync(bindingFile)||JSON.parse(fs.readFileSync(bindingFile,'utf8')).request_digest!==record.effective_request_digest)throw new Error('Admitted request does not bind the canonical run');
 return record.request;
}
