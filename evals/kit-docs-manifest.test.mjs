import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generatedFiles,readSnapshot} from '@kontourai/aidlc-kit/compile';

const read=relative=>JSON.parse(readFileSync(new URL(`../${relative}`,import.meta.url),'utf8'));
const published=read('docs-kit.json').documents.map(document=>document.source);

test('the generated kit manifest advertises every published document and the parity ledger',()=>{
 const advertised=JSON.parse(generatedFiles(readSnapshot()).get('kit.json')).docs.map(entry=>entry.path);
 assert.ok(published.includes('docs/reference.md'));
 for(const source of [...published,'docs/parity.json'])assert.ok(advertised.includes(source),`kit.json does not advertise ${source}`);
});

test('the committed kit manifest matches the generated one',()=>{
 assert.deepEqual(read('kit.json').docs,JSON.parse(generatedFiles(readSnapshot()).get('kit.json')).docs);
});
