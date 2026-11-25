import fs from 'node:fs/promises';
import path from 'node:path';
export const inside = (root, p) => { const r = path.relative(root,p); return !path.isAbsolute(r) && r !== '..' && !r.startsWith('..'+path.sep); };
const blocked = name => /^(\.git|node_modules|\.env(?:\..*)?|\.ssh|\.aws|\.claude|\.npmrc|credentials|credential)$/i.test(name) || /\.(pem|key|pfx|p12)$/i.test(name);
export async function policy(cwd) {
 const root = await fs.realpath(cwd); const refs = new Set();
 async function add(p) { const r=await fs.realpath(path.resolve(root,p)); if (!(await fs.stat(r)).isDirectory()) throw Error('Not a directory'); refs.add(r); return r; }
 async function resolve(p,write=false,missing=false) {
  const abs=path.resolve(root,p); const roots=write?[root]:[root,...refs];
  const base=roots.filter(r=>inside(r,abs)).sort((a,b)=>b.length-a.length)[0];
  if(!base) throw Error('Outside approved roots');
  if(write && [...refs].some(r=>r!==root && inside(r,abs))) throw Error('Reference is read only');
  let cur=base; const rel=path.relative(base,abs);
  for(const part of rel.split(path.sep).filter(Boolean)) {
   if(blocked(part)||part.includes(':')) throw Error('Protected path');
   cur=path.join(cur,part);
   try { const st=await fs.lstat(cur); if(st.isSymbolicLink()) throw Error('Links are forbidden'); if(st.isFile() && st.nlink>1 && write) throw Error('Hard-linked file'); }
   catch(e) { if(e.code==='ENOENT' && missing && cur===abs) break; throw e; }
  }
  const parent=await fs.realpath(missing?path.dirname(abs):abs);
  if(!inside(base,parent)) throw Error('Resolved path outside root');
  return abs;
 }
 async function files(dir,pattern='**/*') {
  const base=await resolve(dir); const result=[]; let visited=0;
  for await(const name of fs.glob(pattern,{cwd:base,exclude:p=>p.split(/[\\/]/).some(blocked)})) {
   if(++visited>10000) break;
   try { const file=await resolve(path.join(base,name)); if((await fs.stat(file)).isFile()) result.push(file); } catch {}
   if(result.length>=500) break;
  } return result;
 }
 async function read(p) { const file=await resolve(p); const st=await fs.stat(file); if(!st.isFile()||st.size>512000) throw Error('Not a regular text file under 512 KB'); const b=await fs.readFile(file); if(b.includes(0)) throw Error('Binary file'); return b.toString('utf8'); }
 async function write(p,content,create=false) { const file=await resolve(p,true,create); if(Buffer.byteLength(content)>512000) throw Error('File exceeds 512 KB'); await fs.writeFile(file,content,{flag:create?'wx':'r+'}); if(!create) await fs.truncate(file,Buffer.byteLength(content)); return file; }
 return {root,refs,add,resolve,files,read,write};
}
