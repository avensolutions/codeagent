import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {setTimeout as sleep} from 'node:timers/promises';
import {stripVTControlCharacters} from 'node:util';
import {parseInput,promptReader,CONTINUATION} from './input.mjs';

const GAP=20;
// A fake terminal. Each write to input is one chunk, as a terminal sends one keypress or one paste.
function terminal({tty=true}={}){
 const input=new PassThrough(),output=new PassThrough();
 if(tty){input.isTTY=output.isTTY=true;input.setRawMode=()=>{};output.columns=120;}
 let shown='';output.on('data',d=>shown+=d);
 const reader=promptReader({input,output,pasteGap:GAP});
 const send=async text=>{input.write(text);await sleep(GAP*2);};
 return {input,reader,shown:()=>stripVTControlCharacters(shown),paste:send,type:async(...keys)=>{for(const k of keys)await send(k);}};
}
const pending=promise=>{const state={done:false};promise.then(()=>state.done=true);return state;};

test('a typed line is sent by Enter, with its indentation',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.type('    indented code','\r');
 assert.equal(await r,'    indented code');
 t.reader.close();
});

test('pasted Markdown keeps its line breaks and is sent by the next Enter',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 await t.paste('# Title\r\r- item with `code`\r\tindented\r```js\rx=1\r```\rlast line');
 assert.equal(state.done,false);
 assert.ok(t.shown().includes(`${CONTINUATION}- item with`));
 await t.type('\r');
 assert.equal(await r,'# Title\n\n- item with `code`\n\tindented\n```js\nx=1\n```\nlast line');
 t.reader.close();
});

test('a paste with CRLF line breaks and a trailing line break waits for Enter',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 await t.paste('one\r\ntwo\r\n');
 assert.equal(state.done,false);
 await t.type('\r');
 assert.equal(await r,'one\ntwo\n');
 t.reader.close();
});

test('a one-line paste that ends in a line break waits for Enter',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 await t.paste('just this\r');
 assert.equal(state.done,false);
 await t.type('\r');
 assert.equal(await r,'just this\n');
 t.reader.close();
});

test('a line break that arrives right after a pasted chunk is part of the paste',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 t.input.write('first\rsecond');t.input.write('\r');t.input.write('\r');t.input.write('third');
 await sleep(GAP*2);
 assert.equal(state.done,false);
 await t.type('\r');
 assert.equal(await r,'first\nsecond\n\nthird');
 t.reader.close();
});

test('typing after a paste adds to it',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.paste('pasted\r');
 await t.type('typed','\r');
 assert.equal(await r,'pasted\ntyped');
 t.reader.close();
});

test('a typed line that ends in a backslash continues on the next line',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 await t.type('first','\\','\r');
 assert.equal(state.done,false);
 assert.ok(t.shown().endsWith(CONTINUATION));
 await t.type('second','\r');
 assert.equal(await r,'first\nsecond');
 t.reader.close();
});

test('a backslash at the end of a pasted line is kept',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.paste('C:\\temp\\\rnext');
 await t.type('\r');
 assert.equal(await r,'C:\\temp\\\nnext');
 t.reader.close();
});

test('a backslash at the end of the last pasted line is kept and Enter sends',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.paste('make all \\\r  install \\');
 await t.type('\r');
 assert.equal(await r,'make all \\\n  install \\');
 t.reader.close();
});

test('a one-line paste that ends in a backslash is sent as is',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.paste('look in C:\\temp\\');
 await t.type('\r');
 assert.equal(await r,'look in C:\\temp\\');
 t.reader.close();
});

// Every Markdown construct that uses backticks, fences, blockquotes, backslashes or significant whitespace.
const MARKDOWN=[
 '```',
 'a fence as the very first line',
 '```',
 'Inline `code`, ``double `tick` code``, and a lone ` backtick.',
 'Hard line break with two spaces  ',
 'and a backslash hard break\\',
 '',
 '> a blockquote',
 '> with `code` and **bold**',
 '>',
 '>> nested quote',
 '> > spaced nested quote',
 '> ```sql',
 '> SELECT 1;',
 '> ```',
 '',
 '````md',
 '```js',
 'nested fence inside a longer fence',
 '```',
 '````',
 '',
 '~~~',
 'tilde fence',
 '~~~',
 '',
 '```powershell',
 'Get-ChildItem `',
 '  -Recurse',
 '```',
 '',
 '```bash',
 'make all \\',
 '  install',
 '```',
 '',
 '    indented code block',
 '\tand a tab-indented line',
 '1. list',
 '   - nested item with `code`',
 '/not/a/command inside multi-line input',
 '```',
].join('\n');

test('pasted Markdown with fences, inline code, blockquotes and backslashes arrives unchanged',async()=>{
 for(const eol of ['\r','\r\n','\n']){
  const t=terminal();
  const r=t.reader.read('> ');
  const state=pending(r);
  await t.paste(MARKDOWN.replaceAll('\n',eol));
  assert.equal(state.done,false,`sent before Enter with ${JSON.stringify(eol)} line breaks`);
  await t.type('\r');
  assert.equal(await r,MARKDOWN,`changed with ${JSON.stringify(eol)} line breaks`);
  t.reader.close();
 }
});

test('typed backticks, fences and blockquotes are plain text',async()=>{
 const t=terminal();
 for(const line of ['```','`','> quoted','>','```js','~~~']){
  const r=t.reader.read('> ');
  await t.type(line,'\r');
  assert.equal(await r,line);
 }
 t.reader.close();
});

test('parseInput keeps Markdown intact and finds only one-line commands',()=>{
 assert.deepEqual(parseInput(MARKDOWN),{text:MARKDOWN,command:''});
 assert.deepEqual(parseInput('\n  \n    indented first line\n> quote\n\n'),{text:'    indented first line\n> quote',command:''});
 assert.deepEqual(parseInput('```\n/cost\n```'),{text:'```\n/cost\n```',command:''});
 assert.deepEqual(parseInput('/add C:\\repo\nexplain this'),{text:'/add C:\\repo\nexplain this',command:''});
 assert.deepEqual(parseInput('  /cost  '),{text:'  /cost',command:'/cost'});
 assert.deepEqual(parseInput('> /cost'),{text:'> /cost',command:''});
 assert.deepEqual(parseInput('`/cost`'),{text:'`/cost`',command:''});
 assert.deepEqual(parseInput(' \n\t\n'),{text:'',command:''});
});

test('Ctrl+C clears the input entered so far and keeps reading',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 const state=pending(r);
 await t.paste('wrong\rpaste');
 await t.type('\x03');
 assert.equal(state.done,false);
 assert.ok(t.shown().includes('(input cleared)'));
 await t.type('right','\r');
 assert.equal(await r,'right');
 t.reader.close();
});

test('Ctrl+C on an empty prompt ends input',async()=>{
 const t=terminal();
 const r=t.reader.read('> ');
 await t.type('\x03');
 assert.equal(await r,null);
 assert.equal(await t.reader.read('> '),null);
});

test('the next prompt starts empty with its own prompt text',async()=>{
 const t=terminal();
 const first=t.reader.read('> ');
 await t.paste('a\rb');
 await t.type('\r');
 assert.equal(await first,'a\nb');
 const second=t.reader.read('again> ');
 await t.type('c','\r');
 assert.equal(await second,'c');
 assert.ok(t.shown().includes('again> c'));
 t.reader.close();
});

test('without a terminal each line is sent as it arrives',async()=>{
 const t=terminal({tty:false});
 const r=t.reader.read('> ');
 await t.paste('yes\n');
 assert.equal(await r,'yes');
 t.reader.close();
});
