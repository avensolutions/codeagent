import {test} from 'node:test';
import assert from 'node:assert/strict';
import {costOf, PRICES} from './pricing.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('prices input, output, cache writes and cache reads',()=>{
 const msg={model:'claude-fable-5-2',usage:{input_tokens:1000,output_tokens:2000,cache_creation_input_tokens:10000,cache_read_input_tokens:50000}};
 close(costOf(msg,'claude-fable-5-2'),(1000*8+2000*40+10000*10+50000*0.2)/1e6);
});

test('prices each attempt in usage.iterations at its own model',()=>{
 const msg={model:'claude-opus-5',usage:{input_tokens:100,output_tokens:900,iterations:[
  {type:'message',model:'claude-fable-5-2',input_tokens:100,output_tokens:50,cache_creation_input_tokens:0,cache_read_input_tokens:0},
  {type:'fallback_message',model:'claude-opus-5',input_tokens:100,output_tokens:900,cache_creation_input_tokens:0,cache_read_input_tokens:0}]}};
 close(costOf(msg,'claude-fable-5-2'),(100*8+50*40+100*5+900*25)/1e6);
});

test('unknown models are priced at the highest listed rate',()=>{
 const maxOut=Math.max(...Object.values(PRICES).map(p=>p[1]));
 close(costOf({model:'claude-unknown',usage:{input_tokens:0,output_tokens:1000}},'claude-fable-5-2'),1000*maxOut/1e6);
});

test('web searches add $0.01 each; web fetches add nothing beyond tokens',()=>{
 const msg={model:'claude-fable-5-2',usage:{input_tokens:100,output_tokens:10,server_tool_use:{web_search_requests:3,web_fetch_requests:5}}};
 close(costOf(msg,'claude-fable-5-2'),(100*8+10*40)/1e6+0.03);
});

test('compaction steps in usage.iterations are priced at the requested model',()=>{
 const msg={model:'claude-fable-5-2',usage:{input_tokens:40,output_tokens:20,iterations:[
  {type:'compaction',input_tokens:1000,output_tokens:300,cache_creation_input_tokens:0,cache_read_input_tokens:0},
  {type:'message',model:'claude-fable-5-2',input_tokens:40,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0}]}};
 close(costOf(msg,'claude-fable-5-2'),(1000*8+300*40+40*8+20*40)/1e6);
});

test('1-hour cache writes are priced at twice the input rate',()=>{
 const msg={model:'claude-opus-5-5',usage:{input_tokens:0,output_tokens:0,cache_creation_input_tokens:300,cache_creation:{ephemeral_5m_input_tokens:100,ephemeral_1h_input_tokens:200},cache_read_input_tokens:0}};
 close(costOf(msg,'claude-opus-5-5'),(100*5+200*4*2)/1e6);
});
