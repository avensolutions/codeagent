#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import {VERSION as SDK_VERSION} from '@anthropic-ai/sdk/version';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {styleText} from 'node:util';
import {policy} from './policy.mjs';
import {PRICES, FALLBACK_MODELS, FALLBACK_OUTPUT_PRICE, costOf, priceOf} from './pricing.mjs';

const API_URL='https://api.anthropic.com';
const MAX_CALLS=10;    // model calls per prompt
const MAX_OUTPUT=32000; // output tokens per call, before the budget limit is applied
const MIN_OUTPUT=1024;  // smallest output limit worth making a call with

const paint=stream=>(format,text)=>styleText(format,text,{stream});
const err=paint(process.stderr),out=paint(process.stdout);
const fail=msg=>{console.error(`${err('red','Error:')} ${msg}`);process.exit(1);};
const envVar=n=>err('yellow',n);
const money=n=>`$${n.toFixed(4)}`;
const installDir=dirname(fileURLToPath(import.meta.url));
const {version}=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));

const key=process.env.ANTHROPIC_API_KEY;
if(!key) fail(`${envVar('ANTHROPIC_API_KEY')} is not set. Set it to a Console API key (sk-ant-...). There is no login fallback.`);
if(!key.startsWith('sk-ant-')) fail(`${envVar('ANTHROPIC_API_KEY')} does not look like a Console API key (expected it to start with sk-ant-).`);
const usd=(name,fallback)=>{const raw=process.env[name]||fallback;if(raw===undefined)fail(`${envVar(name)} is not set. Set it to a positive amount in USD, e.g. 1.00.`);const n=Number(raw);if(!Number.isFinite(n)||n<=0)fail(`${envVar(name)} must be a positive amount in USD, got "${raw}".`);return n;};
const budget=usd('CODEAGENT_BUDGET_USD');
const turnBudget=usd('CODEAGENT_TURN_USD','0.50');
const model=process.env.CODEAGENT_MODEL||'claude-fable-5-2';
if(!PRICES[model]) fail(`${envVar('CODEAGENT_MODEL')} is "${model}", which has no price data for cost tracking. Use one of: ${Object.keys(PRICES).join(', ')}.`);
const fallback=FALLBACK_MODELS.has(model);
// Output is the cost that can be bounded before a call, so each call's max_tokens is set from the budget left.
const outPrice=Math.max(priceOf(model)[1],fallback?FALLBACK_OUTPUT_PRICE:0);
const minCallCost=MIN_OUTPUT*outPrice/1e6;
if(turnBudget<minCallCost) fail(`${envVar('CODEAGENT_TURN_USD')} must be at least ${money(minCallCost)} for ${model}, enough for ${MIN_OUTPUT} output tokens.`);
const p=await policy(process.cwd());
const promptFile=process.env.CODEAGENT_SYSTEM_PROMPT;
const basePrompt=await readFile(promptFile||new URL('./system.md',import.meta.url),'utf8').catch(e=>fail(`Cannot read system prompt${promptFile?` set by ${envVar('CODEAGENT_SYSTEM_PROMPT')}`:''}: ${e.message}`));
// The system prompt and tools stay fixed for the session: editing either mid-conversation invalidates earlier thinking blocks.
const system=`${basePrompt.trim()}\nProject root: ${p.root}`;

// Remove every other ANTHROPIC_* variable so the SDK cannot pick up another credential, host, header or telemetry setting.
for(const k of Object.keys(process.env)) if(/^anthropic_/i.test(k)) delete process.env[k];
const client=new Anthropic({apiKey:key,baseURL:API_URL});

const str=z.string();
const tools=[
 ['Read','Read numbered lines from approved text files',{path:str,start:z.number().int().positive().optional(),count:z.number().int().positive().optional()},async a=>(await p.read(a.path)).split('\n').slice((a.start??1)-1,(a.start??1)-1+Math.min(a.count??200,500)).map((l,i)=>`${i+(a.start??1)}: ${l}`).join('\n').slice(0,40000)],
 ['Glob','Find files in an approved directory',{dir:str,pattern:str},async a=>(await p.files(a.dir,a.pattern)).join('\n')||'No files found'],
 ['Grep','Search text literally, case insensitive, in approved files',{dir:str,pattern:str,glob:str.optional()},async a=>{let out=[];for(const f of await p.files(a.dir,a.glob??'**/*')){try{const lines=(await p.read(f)).split('\n');for(let i=0;i<lines.length;i++){if(lines[i].toLowerCase().includes(a.pattern.toLowerCase()))out.push(`${f}:${i+1}: ${lines[i].slice(0,500)}`);if(out.length>=100)return out.join('\n');}}catch{}}return out.join('\n')||'No matches in scanned files';}],
 ['Edit','Replace exactly one occurrence in an existing project file',{path:str,old_text:str,new_text:str},async a=>{await p.resolve(a.path,true);const s=await p.read(a.path);if(!a.old_text||s.split(a.old_text).length!==2)throw Error('Expected exactly one occurrence');await p.write(a.path,s.replace(a.old_text,()=>a.new_text));return 'Edited';}],
 ['Write','Create a new project file; parent must exist',{path:str,content:str},async a=>{await p.write(a.path,a.content,true);return 'Created';}]
].map(([name,description,shape,run])=>{const schema=z.object(shape);const {$schema,...input_schema}=z.toJSONSchema(schema);return {name,description,input_schema,schema,run};});
const toolDefs=tools.map(({name,description,input_schema})=>({name,description,input_schema}));

async function runTool(use){
 const result=(text,isError)=>({type:'tool_result',tool_use_id:use.id,content:text||'(empty)',...(isError?{is_error:true}:{})});
 const t=tools.find(t=>t.name===use.name);
 if(!t) return result(`Unknown tool: ${use.name}`,true);
 const args=t.schema.safeParse(use.input);
 if(!args.success) return result(`Invalid input: ${z.prettifyError(args.error)}`,true);
 console.log(`[${t.name}] ${args.data.path??args.data.dir??''}`);
 try{return result(await t.run(args.data));}catch(e){return result(String(e.message),true);}
}

// After a fallback that happens mid-output, only text blocks from before the last fallback marker may be sent back.
const echoable=content=>{const i=content.findLastIndex(b=>b.type==='fallback');return i<0?content:content.filter((b,j)=>j>=i||b.type==='text');};

// There is no build step: codeagent runs from its source folder, so the commit it runs from stands in for a build stamp.
const git=(...args)=>{try{return execFileSync('git',['-C',installDir,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();}catch{return null;}};
function info(){
 const [hash,date]=(git('log','-1','--format=%h %cI')??'').split(' ');
 const source=hash?`commit ${hash}, ${date}${git('status','--porcelain')?', plus uncommitted changes':''}`:'commit unknown: not a git checkout or git not found';
 const [inPrice,outPrice]=priceOf(model);
 return [`codeagent ${version}`,
  `Source:  ${installDir} (${source})`,
  `Runtime: Node ${process.version}, @anthropic-ai/sdk ${SDK_VERSION}`,
  `Model:   ${model}${fallback?' (refusal fallback on)':''}, $${inPrice} / $${outPrice} per million input / output tokens`,
  `Budget:  $${budget} per session, $${turnBudget} per prompt`].join('\n');
}

let messages=[],noted='[]',spent=0;

async function runPrompt(input){
 const cap=Math.min(budget-spent,turnBudget),start=messages.length,prevNoted=noted;
 let cost=0,calls=0,status='done',rollback=false,endSession=false;
 const content=[],refs=JSON.stringify([...p.refs]);
 if(refs!==noted){content.push({type:'text',text:`[codeagent] Approved read-only reference roots: ${refs}`});noted=refs;}
 content.push({type:'text',text:input});
 messages.push({role:'user',content});
 while(true){
  if(calls>=MAX_CALLS){status=`stopped after ${MAX_CALLS} model calls`;break;}
  const maxTokens=Math.min(MAX_OUTPUT,Math.floor((cap-cost)*1e6/outPrice));
  if(maxTokens<MIN_OUTPUT){status='prompt budget used up';break;}
  let msg;
  try{
   msg=await client.beta.messages.stream({model,max_tokens:maxTokens,system,tools:toolDefs,messages,cache_control:{type:'ephemeral'},...(fallback?{betas:['server-side-fallback-2026-07-01'],fallbacks:'default'}:{})}).finalMessage();
  }catch(e){
   // A 4xx is a rejected request with nothing generated. Anything else (5xx, dropped stream, network) may have
   // been billed without a usage report, so the session ends to avoid untracked spending.
   const rejected=e instanceof Anthropic.APIError&&e.status>=400&&e.status<500;
   console.error(`${err('red','API error:')} ${e.status?`${e.status} `:''}${e.error?.error?.message??e.message}`);
   status='API error';endSession=!rejected;break;
  }
  calls++;
  const callCost=costOf(msg,model);cost+=callCost;spent+=callCost;
  if(msg.model&&msg.model!==model) console.log(out('yellow',`(answered by ${msg.model})`));
  if(msg.stop_reason==='refusal'){status=`declined${msg.stop_details?.category?` (${msg.stop_details.category})`:''}; this prompt was removed from the conversation`;rollback=true;break;}
  if(msg.stop_reason==='max_tokens'){status=`response cut off at ${maxTokens} output tokens, the most the remaining prompt budget allows; the partial response was discarded`;break;}
  if(!['end_turn','tool_use','stop_sequence'].includes(msg.stop_reason)){status=`stopped (${msg.stop_reason}); the partial response was discarded`;break;}
  const blocks=echoable(msg.content);
  for(const b of blocks) if(b.type==='text') console.log(b.text);
  messages.push({role:'assistant',content:blocks});
  const uses=blocks.filter(b=>b.type==='tool_use');
  if(msg.stop_reason!=='tool_use'||!uses.length) break;
  const results=[];
  for(const u of uses) results.push(await runTool(u));
  messages.push({role:'user',content:results});
 }
 if(rollback||!calls){messages.length=start;noted=prevNoted;}
 return {status,cost,endSession};
}

console.log(`codeagent ${version} | ${model}${fallback?' (refusal fallback on)':''}\nProject: ${p.root}\nAPI key configured: ${key.slice(0,11)}...${key.slice(-4)} (not yet verified by server)\nEstimated budget: $${budget} per session, $${turnBudget} per prompt\nCommands: /add <directory>, /roots, /cost, /info, /reset, /exit`);
console.log('Disable Console auto-recharge and check promotional balance BEFORE proceeding. Cost figures are local estimates, not billing caps.');
const rl=createInterface({input:process.stdin,output:process.stdout});
const closed=new Promise(r=>rl.once('close',()=>r(null))); // input ended (Ctrl+Z / Ctrl+D or a closed pipe)
const ask=q=>Promise.race([rl.question(q).catch(()=>null),closed]);
if((await ask('Confirm billing checks completed (yes/no): '))?.trim()!=='yes'){rl.close();process.exit(0);}
try{
 while(budget-spent>=minCallCost){
  const line=await ask('codeagent> ');
  if(line===null) break;
  const input=line.trim();
  if(!input) continue;
  if(input==='/exit') break;
  if(input==='/cost'){console.log(`Estimated ${money(spent)} / $${budget}`);continue;}
  if(input==='/roots'){console.log(p.root,[...p.refs]);continue;}
  if(input==='/info'){console.log(info());continue;}
  if(input==='/reset'){messages=[];noted='[]';continue;}
  if(input.startsWith('/add ')){try{console.log('Read-only:',await p.add(input.slice(5).trim().replace(/^"|"$/g,'')));}catch(e){console.error(e.message);}continue;}
  if(input.startsWith('/')){console.log('Unknown command');continue;}
  const r=await runPrompt(input);
  console.log(`Result: ${r.status}; estimated ${money(r.cost)}; accumulated ${money(spent)}`);
  if(r.endSession){console.error('The failed request may have been billed without a usage report; ending the session. Check the Console before restarting.');break;}
 }
 if(budget-spent<minCallCost) console.log(`Session budget reached (estimated ${money(spent)} of $${budget}).`);
}finally{rl.close();}
