#!/usr/bin/env node
import {query,tool,createSdkMcpServer} from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {styleText} from 'node:util';
import {policy} from './policy.mjs';
const c=(f,t)=>styleText(f,t,{stream:process.stderr});
const fail=msg=>{console.error(`${c('red','Error:')} ${msg}`);process.exit(1);};
const envVar=n=>c('yellow',n);
const key=process.env.ANTHROPIC_API_KEY;
if(!key) fail(`${envVar('ANTHROPIC_API_KEY')} is not set. Set it to a Console API key (sk-ant-...). There is no login fallback.`);
if(!key.startsWith('sk-ant-')) fail(`${envVar('ANTHROPIC_API_KEY')} does not look like a Console API key (expected it to start with sk-ant-).`);
const usd=(name,fallback)=>{const raw=process.env[name]||fallback;if(raw===undefined)fail(`${envVar(name)} is not set. Set it to a positive amount in USD, e.g. 1.00.`);const n=Number(raw);if(!Number.isFinite(n)||n<=0)fail(`${envVar(name)} must be a positive amount in USD, got "${raw}".`);return n;};
const budget=usd('CODEAGENT_BUDGET_USD');
const turnBudget=usd('CODEAGENT_TURN_USD','0.50');
const model=process.env.CODEAGENT_MODEL||'claude-fable-5-2';
const p=await policy(process.cwd());
const promptFile=process.env.CODEAGENT_SYSTEM_PROMPT;
const systemPrompt=await readFile(promptFile||new URL('./system.md',import.meta.url),'utf8').catch(e=>fail(`Cannot read system prompt${promptFile?` set by ${envVar('CODEAGENT_SYSTEM_PROMPT')}`:''}: ${e.message}`));
const rl=createInterface({input:process.stdin,output:process.stdout});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_CONFIG_DIR)/.test(k)));
Object.assign(env,{ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:'https://api.anthropic.com'});
const wrap=(name,desc,shape,fn)=>tool(name,desc,shape,async args=>{try{console.log(`[${name}] ${args.path??args.dir??''}`);return {content:[{type:'text',text:await fn(args)}]};}catch(e){return {isError:true,content:[{type:'text',text:String(e.message)}]};}});
const str=z.string();
const definitions=[
 wrap('Read','Read numbered lines from approved text files',{path:str,start:z.number().int().positive().optional(),count:z.number().int().positive().optional()},async a=>(await p.read(a.path)).split('\n').slice((a.start??1)-1,(a.start??1)-1+Math.min(a.count??200,500)).map((l,i)=>`${i+(a.start??1)}: ${l}`).join('\n').slice(0,40000)),
 wrap('Glob','Find files in an approved directory',{dir:str,pattern:str},async a=>(await p.files(a.dir,a.pattern)).join('\n')),
 wrap('Grep','Search text literally, case insensitive, in approved files',{dir:str,pattern:str,glob:str.optional()},async a=>{let out=[];for(const f of await p.files(a.dir,a.glob??'**/*')){try{const lines=(await p.read(f)).split('\n');for(let i=0;i<lines.length;i++){if(lines[i].toLowerCase().includes(a.pattern.toLowerCase()))out.push(`${f}:${i+1}: ${lines[i].slice(0,500)}`);if(out.length>=100)return out.join('\n');}}catch{}}return out.join('\n')||'No matches in scanned files';}),
 wrap('Edit','Replace exactly one occurrence in an existing project file',{path:str,old_text:str,new_text:str},async a=>{await p.resolve(a.path,true);const s=await p.read(a.path);if(!a.old_text||s.split(a.old_text).length!==2)throw Error('Expected exactly one occurrence');await p.write(a.path,s.replace(a.old_text,()=>a.new_text));return 'Edited';}),
 wrap('Write','Create a new project file; parent must exist',{path:str,content:str},async a=>{await p.write(a.path,a.content,true);return 'Created';})
];
const server=createSdkMcpServer({name:'local',tools:definitions});
const allowedTools=['Read','Glob','Grep','Edit','Write'].map(n=>'mcp__local__'+n);
let session,spent=0;
console.log(`codeagent | ${model}\nProject: ${p.root}\nAPI key configured: ${key.slice(0,11)}...${key.slice(-4)} (not yet verified by server)\nEstimated session ceiling: $${budget}\nCommands: /add <directory>, /roots, /cost, /reset, /exit`);
console.log('Disable Console auto-recharge and check promotional balance BEFORE proceeding. SDK estimates are not hard billing caps.');
if((await rl.question('Confirm billing checks completed (yes/no): ')).trim()!=='yes'){rl.close();process.exit(0);}
try { while(spent<budget){const input=(await rl.question('codeagent> ')).trim();if(!input)continue;if(input==='/exit')break;if(input==='/cost'){console.log(`Estimated $${spent.toFixed(4)} / $${budget}`);continue;}if(input==='/roots'){console.log(p.root,[...p.refs]);continue;}if(input==='/reset'){session=undefined;continue;}if(input.startsWith('/add ')){try{console.log('Read-only:',await p.add(input.slice(5).trim().replace(/^"|"$/g,'')));}catch(e){console.error(e.message);}continue;}if(input.startsWith('/')){console.log('Unknown command');continue;}
 const cap=Math.min(budget-spent,turnBudget);
 const q=query({prompt:input,options:{cwd:p.root,model,env,systemPrompt:systemPrompt+'\nApproved reference roots: '+JSON.stringify([...p.refs]),settingSources:[],tools:[],allowedTools,mcpServers:{local:server},strictMcpConfig:true,permissionMode:'default',canUseTool:async(name,args)=>allowedTools.includes(name)?{behavior:'allow',updatedInput:args}:{behavior:'deny',message:'Tool disabled'},maxTurns:10,maxBudgetUsd:cap,...(session?{resume:session}:{})}});
 let gotResult=false;try{for await(const m of q){if(m.type==='system'&&m.subtype==='init'){session=m.session_id;console.log('Runtime auth:',m.apiKeySource??'not reported','| model:',m.model);if(m.apiKeySource&&!['user','environment','env'].includes(m.apiKeySource)){throw Error('Unexpected API key source; verify runtime authentication');}}if(m.type==='assistant'){for(const b of m.message.content)if(b.type==='text')console.log(b.text);}if(m.type==='result'){gotResult=true;session=m.session_id;spent+=Number(m.total_cost_usd??cap);console.log(`Result: ${m.subtype}; estimated $${m.total_cost_usd}; accumulated $${spent.toFixed(4)}`);}}}finally{q.close();if(!gotResult){console.error('No final usage report; ending session to avoid untracked expenditure.');break;}}
 }}finally{rl.close();}
