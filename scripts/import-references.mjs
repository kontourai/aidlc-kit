#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {REFERENCE_UPSTREAM_COMMIT,classifyDocumentReferences} from './reference-closure.mjs';

export function importReferenceClosure(checkout,output){
 const git=args=>execFileSync('git',['-C',checkout,...args]);
 if(git(['rev-parse','HEAD']).toString().trim()!==REFERENCE_UPSTREAM_COMMIT)throw new Error('Pinned reference upstream HEAD required');
 const inventory=git(['ls-tree','-r','--name-only',REFERENCE_UPSTREAM_COMMIT]).toString().trim().split('\n').filter(file=>(/^(?:core|docs|harness|plugins)\//.test(file)||/^[A-Z][A-Z0-9_-]*\.md$/.test(file))&&file.endsWith('.md')&&!file.includes('/test/')&&!file.includes('/tests/')).sort();
 const core=inventory.filter(file=>file.startsWith('core/')),sourceBytes=new Map();
 const read=file=>{if(!sourceBytes.has(file))sourceBytes.set(file,git(['show',`${REFERENCE_UPSTREAM_COMMIT}:${file}`]));return sourceBytes.get(file);};
 const generatedNames=new Set();
 for(const file of inventory){const text=read(file).toString('utf8');const frontmatter=/^---\s*\n[\s\S]*?\n---/.exec(text)?.[0]??'';for(const block of frontmatter.matchAll(/^(?:produces|optional_produces):\s*\n((?:  - [^\n]+\n)+)/gm))for(const output of block[1].matchAll(/^  - ([A-Za-z0-9_-]+)$/gm))generatedNames.add(output[1]+'.md');for(const match of text.matchAll(/<[^>]*record[^>]*>[^\s`"']*\.md/g))generatedNames.add(path.posix.basename(match[0]).replace(/^\*{2,}/,''));}
 const snapshot=JSON.parse(fs.readFileSync(path.join(output,'snapshot.json'),'utf8'));for(const stage of snapshot.stages){for(const id of [...(stage.produces??[]),...(stage.optional_produces??[])])generatedNames.add(id+'.md');if(stage.summary_confirmation)generatedNames.add(stage.slug+'-questions.md');for(const match of String(stage.outputs??'').matchAll(/[A-Za-z0-9_-]+\.md/g))generatedNames.add(match[0]);}
 const documents=[],pending=[...core],included=new Set();
 while(pending.length){const source_path=pending.shift();if(included.has(source_path))continue;included.add(source_path);
  const bytes=read(source_path),packaged_path=`upstream/references/${source_path}`;
  const classified=classifyDocumentReferences(bytes.toString('utf8'),source_path,inventory,generatedNames,{audit:true});
  for(const mention of classified.mentions)if(['declared-generated-artifact','declared-project-output','illustrative-workspace-template'].includes(mention.kind))generatedNames.add(path.posix.basename(mention.token));
  const destination=path.join(output,'references',source_path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
  documents.push({source_path,packaged_path,source_digest:createHash('sha256').update(bytes).digest('hex'),...classified});pending.push(...classified.references);
 }
 documents.sort((a,b)=>a.source_path.localeCompare(b.source_path));
 const unresolved=documents.flatMap(document=>document.mentions.filter(mention=>mention.kind==='unresolved-static').map(mention=>({source_path:document.source_path,...mention})));
 if(unresolved.length)throw new Error('Unresolved pinned reference mentions: '+JSON.stringify(unresolved));
 const manifest={schema_version:'1.0',upstream:{repository:'https://github.com/awslabs/aidlc-workflows',commit:REFERENCE_UPSTREAM_COMMIT,version:'2.11.0'},documents};
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(output,'reference-manifest.json'),bytes);return createHash('sha256').update(bytes).digest('hex');
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)console.log(importReferenceClosure(path.resolve(process.argv[2]),path.resolve(process.argv[3])));
