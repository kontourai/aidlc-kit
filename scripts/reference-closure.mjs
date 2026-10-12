import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const REFERENCE_UPSTREAM_COMMIT='2a555f7a4387cd1b8254029cccb9fd1e99974574';
export const REFERENCE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const REFERENCE_MANIFEST_SHA256='04c6479c1d523a55db604ecc70db7aefc8b2d874c007109bba33d3ad13dc2be2';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Every mention is accounted for: pinned support, proven per-run inputs, or
// explicitly illustrative template/frontmatter examples. Unknown static names fail.
export function classifyDocumentReferences(text,sourcePath,inventory,generatedNames=new Set(),{audit=false}={}){
 const references=new Set(),mentions=[];
 const examples=/^---\s*\n[\s\S]*?\n---/.exec(text)?.[0]??'';
 const exampleNames=new Set([...examples.matchAll(/^  - ([^\n]+\.md)\s*$/gm)].map(match=>match[1]));
 for(const match of text.matchAll(/[A-Za-z0-9_./{}<>*\-]+\.md/g)){
  const token=match[0].replace(/^\*{2,}(?!\/)/,'');
  const line=text.slice(0,match.index).split('\n').length;
  const lineText=text.split('\n')[line-1];
  let kind;
  if(/https?:$/.test(text.slice(Math.max(0,match.index-6),match.index)))kind='external-unpinned-link';
  if(/^(?:\.\/)?ADR-[0-9]+-.*\.md$/.test(token))kind='illustrative-decision-record';
  if(/\(not [^)]*with[^)]*/i.test(lineText))kind='negated-layout-example';
  if(/\{\{INVOKE\}\} engine\s|^\s*aidlc\s/.test(lineText))kind='runtime-command-path';
  if(/\|[^|]*\b(?:Write|Create|Generate)\b[^|]*\|/i.test(lineText))kind='declared-project-output';
  if(token.includes('<record>')||token.includes('<workspace>')||token.startsWith('aidlc/')||token.startsWith('aidlc-docs/')||token.startsWith('.aidlc-engine/')||['aidlc-state.md','audit.md','memory.md','README.md','AGENTS.md','CLAUDE.md','INSTRUCTIONS.md','OUTCOMES.md','plan.md','content.md','report.md','timestamp.md'].includes(token))kind='runtime-or-project-input';
  const normalized=token.replace(/^.*\{\{HARNESS_DIR\}\}\//,'core/').replace(/<[^>]+>|\{\{[^}]+\}\}|\{[^}]+\}/g,'*');
  const generatedPattern=path.posix.basename(normalized).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*');
  const generatedMatch=generatedNames.has(path.posix.basename(token))||(normalized.includes('*')&&[...generatedNames].some(name=>new RegExp(`^${generatedPattern}$`).test(name)));
  if(!kind&&!/^(?:core|docs|harness|plugins)\//.test(normalized)&&(exampleNames.has(token)||generatedMatch))kind='declared-generated-artifact';
  if(!kind&&(/[<>{}]/.test(token)||token.startsWith('-'))&&!normalized.startsWith('core/'))kind='computed-runtime-path';
  const direct=[normalized,path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath),normalized))].filter(candidate=>inventory.includes(candidate));
  let candidates=direct.length?direct:inventory.filter(candidate=>path.posix.basename(candidate)===path.posix.basename(normalized));
  if(normalized.includes('*')){const pattern=normalized.startsWith('core/')?normalized:path.posix.basename(normalized);const escaped=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*');candidates=inventory.filter(candidate=>new RegExp(`^${escaped}$`).test(normalized.startsWith('core/')?candidate:path.posix.basename(candidate)));}
  if(!kind&&candidates.length){kind='pinned-support';for(const candidate of candidates)references.add(candidate);}
  const nearby=text.slice(Math.max(0,match.index-100),match.index);
  if(!kind&&sourcePath.startsWith('plugins/')&&/\b(?:Write|Build|manifest)\b[^.!?]{0,100}$/i.test(nearby))kind='declared-project-output';
  if(!kind&&sourcePath.startsWith('docs/')&&token==='./vision.md')kind='illustrative-user-input';
  if(!kind&&sourcePath==='CHANGELOG.md')kind='historical-change-record';
  if(!kind&&sourcePath.startsWith('docs/')&&!/\]\([^)]*\.md/.test(lineText)&&! /\b(?:read|follow|load|consult)\b/i.test(lineText))kind='illustrative-documentation-path';
  if(!kind&&/^(?:core|docs|harness|plugins)\//.test(normalized)){if(!audit)throw new Error(`Missing pinned support path ${sourcePath}:${line}: ${token}`);kind='unresolved-static';}
  if(!kind&&/^[A-Z]\.md$/.test(token))kind='illustrative-path-placeholder';
  if(!kind&&(sourcePath.startsWith('core/templates/')||/^core\/knowledge\/.*-template\.md$/.test(sourcePath)||token.startsWith('./ADR-'))&&!/\b(?:read|follow|load|see)\b/i.test(lineText)&&!/\]\([^)]*\.md/.test(lineText))kind='illustrative-workspace-template';
  if(!kind){if(!audit)throw new Error(`Unresolved static methodology reference ${sourcePath}:${line}: ${token}`);kind='unresolved-static';}
  mentions.push({token,line,kind,...(kind==='pinned-support'?{targets:[...new Set(candidates)].sort()}: {})});
 }
 return {references:[...references].sort(),mentions};
}
export function documentReferences(text,sourcePath,inventory,generatedNames){return classifyDocumentReferences(text,sourcePath,inventory,generatedNames).references;}

export function readReferenceManifest(root=REFERENCE_ROOT){
 if(!fs.lstatSync(path.join(root,'upstream')).isDirectory()||!fs.lstatSync(path.join(root,'upstream/reference-manifest.json')).isFile())throw new Error('Methodology reference metadata is not regular');
 const bytes=fs.readFileSync(path.join(root,'upstream/reference-manifest.json'));
 if(hash(bytes)!==REFERENCE_MANIFEST_SHA256)throw new Error('Pinned methodology reference manifest changed');
 const manifest=JSON.parse(bytes);
 if(manifest.schema_version!=='1.0'||manifest.upstream.commit!==REFERENCE_UPSTREAM_COMMIT)throw new Error('Foreign methodology reference closure');
 return manifest;
}

export function verifyReferenceClosure(root=REFERENCE_ROOT){
 const manifest=readReferenceManifest(root);
 if(!fs.lstatSync(path.join(root,'upstream/references')).isDirectory())throw new Error('Methodology reference root is not a directory');
 const actual=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())actual.push(path.relative(root,file).split(path.sep).join('/'));else throw new Error('Unsupported methodology reference entry');}}
 walk(path.join(root,'upstream/references'));
 const declared=new Set();
 for(const entry of manifest.documents){
  if(!(/^(?:core|docs|harness|plugins)\//.test(entry.source_path)||/^[A-Z][A-Z0-9_-]*\.md$/.test(entry.source_path))||entry.packaged_path!==`upstream/references/${entry.source_path}`||declared.has(entry.packaged_path))throw new Error('Invalid methodology reference path');
  declared.add(entry.packaged_path);const absolute=path.join(root,entry.packaged_path);
  if(!fs.lstatSync(absolute).isFile()||hash(fs.readFileSync(absolute))!==entry.source_digest)throw new Error(`Pinned methodology reference missing or changed: ${entry.source_path}`);
 }
 if(actual.length!==declared.size||actual.some(file=>!declared.has(file)))throw new Error('Foreign methodology reference inventory');
 const paths=new Set(manifest.documents.map(entry=>entry.source_path));for(const entry of manifest.documents)for(const ref of entry.references)if(!paths.has(ref))throw new Error('Unresolved methodology reference');
 return manifest;
}

export function applicableReferenceInputs({stage,profile,snapshot,root=REFERENCE_ROOT}){
 const manifest=readReferenceManifest(root),byPath=new Map(manifest.documents.map(entry=>[entry.source_path,entry]));
 const contract=snapshot.stages.find(entry=>entry.slug===stage),seeds=[];
 if(contract){seeds.push(contract.source_path);for(const role of [contract.lead_agent,contract.reviewer,...(contract.support_agents??[])]){const agent=snapshot.agents.find(entry=>entry.slug===role);if(agent)seeds.push(agent.source_path);}}
 if(profile&&snapshot.profiles[profile])seeds.push(`core/scopes/aidlc-${profile}.md`);
 const selected=new Set();function visit(sourcePath){if(selected.has(sourcePath))return;const entry=byPath.get(sourcePath);if(!entry)throw new Error(`Required methodology reference absent: ${sourcePath}`);selected.add(sourcePath);for(const ref of entry.references)visit(ref);}
 for(const seed of seeds)visit(seed);
 return {upstream:manifest.upstream,manifest_digest:REFERENCE_MANIFEST_SHA256,root:'/treatment',manifest_path:'upstream/reference-manifest.json',document_root:'upstream/references',source_paths:[...selected].sort()};
}
