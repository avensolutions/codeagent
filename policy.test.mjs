import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {policy} from './policy.mjs';
test('project writes, reference reads, denied escapes and links',async()=>{const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'codeagent-'));try{const root=path.join(tmp,'project'),ref=path.join(tmp,'reference');await fs.mkdir(root);await fs.mkdir(ref);await fs.writeFile(path.join(ref,'a.txt'),'ref');const p=await policy(root);await assert.rejects(p.read(path.join(ref,'a.txt')));await p.add(ref);assert.equal(await p.read(path.join(ref,'a.txt')),'ref');await assert.rejects(p.write(path.join(ref,'a.txt'),'bad'));await p.write('a.txt','abc',true);await p.write('a.txt','x');assert.equal(await p.read('a.txt'),'x');await assert.rejects(p.write('.env','secret',true));await fs.symlink(ref,path.join(root,'link'),'junction');await assert.rejects(p.read('link/a.txt'));assert.deepEqual(await p.files(root),[path.join(root,'a.txt')]);}finally{await fs.rm(tmp,{recursive:true,force:true});}});
