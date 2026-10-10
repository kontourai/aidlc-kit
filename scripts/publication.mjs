import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
const identity=stat=>`${stat.dev}:${stat.ino}`;
const absent=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
/** No-follow preflight and atomic leaf replacement. Parent rename races require
 * a descriptor-relative platform primitive; this does not claim kernel CAS. */
export function createPublicationJail(workspace){
 const root=fs.realpathSync(workspace),admitted=fs.lstatSync(root);if(!admitted.isDirectory()||admitted.isSymbolicLink())throw new Error('Publication workspace must be a real directory');
 function rootCurrent(){const current=fs.lstatSync(root);if(fs.realpathSync(root)!==root||!current.isDirectory()||current.isSymbolicLink()||identity(current)!==identity(admitted))throw new Error('Publication workspace identity changed');}
 return {preflight(files){
  rootCurrent();const dirs=new Map([[root,identity(admitted)]]),targets=new Map();
  function inspect(file){
   if(typeof file!=='string'||!file||path.isAbsolute(file)||/^[a-z]:/i.test(file)||file.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'||part.includes('\0')))throw new Error('Invalid canonical publication destination');
   const target=path.join(root,file),parts=path.relative(root,target).split(path.sep);let parent=root;
   for(const part of parts.slice(0,-1)){parent=path.join(parent,part);const stat=absent(parent);if(stat){if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Publication destination ancestor is not a real directory');const known=dirs.get(parent);if(known&&known!==identity(stat))throw new Error('Publication destination ancestor identity changed');dirs.set(parent,identity(stat));}}
   const leaf=absent(target);if(leaf&&(leaf.isSymbolicLink()||!leaf.isFile()))throw new Error('Publication destination is not a regular file');targets.set(file,target);return target;
  }
  for(const file of files)inspect(file);
  function assert(file){if(!targets.has(file))throw new Error('Publication destination was not preflighted');rootCurrent();for(const [dir,expected]of dirs){const current=fs.lstatSync(dir);if(current.isSymbolicLink()||!current.isDirectory()||identity(current)!==expected)throw new Error('Publication destination ancestor identity changed');}for(const candidate of targets.keys())inspect(candidate);return targets.get(file);}
  function ensureParents(file){assert(file);const target=targets.get(file),parts=path.relative(root,path.dirname(target)).split(path.sep).filter(Boolean);let parent=root;for(const part of parts){parent=path.join(parent,part);if(!absent(parent)){fs.mkdirSync(parent,{mode:0o700});const stat=fs.lstatSync(parent);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Created publication parent is not a real directory');dirs.set(parent,identity(stat));}assert(file);}return target;}
  return {assert,write(file,bytes,mode=0o600){const target=ensureParents(file),tmp=path.join(path.dirname(target),`.aidlc-publish-${randomUUID()}.tmp`);let fd;try{assert(file);fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),mode&0o777);fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,mode&0o777);fs.closeSync(fd);fd=undefined;assert(file);fs.renameSync(tmp,target);assert(file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}}},remove(file){const target=assert(file);fs.unlinkSync(target);rootCurrent();}};
 }};
}
