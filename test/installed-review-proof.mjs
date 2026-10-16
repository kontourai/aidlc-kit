/** Installed native host contract proof; no model or provider is invoked. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const [consumer,scratch]=process.argv.slice(2);
const require=createRequire(path.join(consumer,'package.json'));
const kit=path.dirname(require.resolve('@kontourai/aidlc-kit/kit.json'));
const {currentRequirementsReviewFixture}=await import(pathToFileURL(path.join(kit,'evals/helpers/current-requirements-review.mjs')));
// This proof is copied into the clean consumer so the import uses that
// consumer's public ESM export, rather than the source checkout's dependencies.
const {openInstalledKitReview}=await import('@kontourai/flow-agents/kit-review');
const {findControllerReviewDecision}=await import(pathToFileURL(path.join(kit,'scripts/authority.mjs')));
const cleanups=[];
let server;
try{
 const fixture=await currentRequirementsReviewFixture({after:cleanup=>cleanups.push(cleanup)},{stage:'domain-design',findings:[{id:'DESIGN-1',severity:'medium',reason:'The proposed domain model omits a required entity',kind:'judgment',status:'open'}]});
 const requestFile=path.join(scratch,'installed-review-request.json');
 fs.writeFileSync(requestFile,JSON.stringify({schema:'kontour.kit.review_request',version:'1.0',kit_id:'aidlc',input:{controllerRoot:fixture.controllerRoot,pendingFile:fixture.pendingFile,reference:'Controlled installed native review contract proof'}}),{mode:0o600});
 server=await openInstalledKitReview({kitId:'aidlc',dest:consumer,requestFile});
 const response=await fetch(new URL('/api/session',server.url));
 assert.equal(response.status,200);
 const session=await response.json();
 assert.ok(session.presentation,'Installed native host omitted the kit review presentation');
 assert.match(session.presentation.title,/domain.design/i);
 assert.match(session.presentation.context,/DESIGN-1/);
 assert.match(session.presentation.context,/omits a required entity/);
 assert.match(session.presentation.context,/Original deadline:/);
 assert.match(session.presentation.context,/Remaining worker slots:/);
 assert.equal(session.presentation.items['document-0'].kind,'acknowledgment');
 assert.deepEqual(session.presentation.items['workflow-decision'].candidateLabels,{approve:'Approve','request-changes':'Request changes',decline:'Decline'});
 // Display hints must survive the actual installed host without authorizing an
 // unresolved queue or mutating the controller's signed decision history.
 const submit=await fetch(new URL('/api/apply',server.url),{method:'POST',headers:{'content-type':'application/json',origin:new URL(server.url).origin},body:JSON.stringify({baseRevision:session.revision})});
 assert.equal(submit.status,422,await submit.text());
 assert.equal(findControllerReviewDecision({controllerRoot:fixture.controllerRoot,pendingFile:fixture.pendingFile}),null);
 console.log(JSON.stringify({status:'pass',transport:'installed-native-host',presentation_forwarded:true,unresolved_submission_refused:true,model_or_provider_invoked:false}));
}finally{
 await server?.close();
 for(const cleanup of cleanups.reverse())await cleanup();
}
