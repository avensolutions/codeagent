import {createInterface} from 'node:readline';
import {styleText} from 'node:util';

// Terminals send a paste as one chunk of input and each typed key as its own chunk; Node's readline relies on the same
// to keep Tab completion out of pastes. A line break in a chunk that holds more than a single Enter is therefore pasted,
// as is one in a chunk that arrives within PASTE_GAP ms of a pasted chunk (a long paste can arrive in several chunks).
// Pasted line breaks are kept as part of the input; only an Enter typed after the paste sends it. No other character
// has a meaning: backticks, code fences and the rest of Markdown are passed on as they are. A trailing backslash means
// "continue on the next line" only when it was typed as the last key before Enter, so pasted code and paths that end
// in a backslash are kept. Bracketed paste mode is not used, because Node's readline inserts its markers as text.
export const PASTE_GAP=50;
export const CONTINUATION='... ';
const ENTER=/^(\r\n?|\n)$/;

// Drops blank lines around the input but keeps the first line's indentation, which matters in Markdown (an indented
// line is a code block). command is the input when it is a single line that starts with "/", otherwise ''.
export function parseInput(raw){
 const text=raw.replace(/^\s*\n/,'').trimEnd(),line=text.trim();
 return {text,command:!line.includes('\n')&&line.startsWith('/')?line:''};
}

export function promptReader({input=process.stdin,output=process.stdout,pasteGap=PASTE_GAP}={}){
 const rl=createInterface({input,output});
 let pasting=false,lastPaste=-Infinity,backslashTyped=false,ended=false,current=null; // current: the prompt being answered
 const onData=chunk=>{
  const s=String(chunk),now=Date.now();
  pasting=rl.terminal&&((/[\r\n]/.test(s)&&!ENTER.test(s))||now-lastPaste<pasteGap);
  if(pasting) lastPaste=now;
  if(!ENTER.test(s)) backslashTyped=rl.terminal&&s==='\\';
 };
 input.prependListener('data',onData); // runs before readline turns the chunk into lines
 const finish=value=>{const {resolve}=current;current=null;resolve(value);};
 const more=()=>{rl.setPrompt(CONTINUATION);rl.prompt(true);};
 rl.on('line',line=>{
  if(!current) return; // input while no prompt is shown, such as during a model call, is ignored
  if(pasting){current.lines.push(line);more();}
  else if(backslashTyped&&line.endsWith('\\')){backslashTyped=false;current.lines.push(line.slice(0,-1));more();}
  else{current.lines.push(line);finish(current.lines.join('\n'));}
 });
 // Ctrl+C clears the input entered so far; on an empty prompt it ends input, as readline does by default.
 rl.on('SIGINT',()=>{
  if(!current||(!current.lines.length&&!rl.line)){rl.close();return;}
  current.lines=[];
  rl.write(null,{ctrl:true,name:'e'});rl.write(null,{ctrl:true,name:'u'});
  output.write(`${styleText('dim','(input cleared)',{stream:output})}\n`);
  rl.setPrompt(current.prompt);rl.prompt();
 });
 rl.on('close',()=>{ended=true;input.off('data',onData);if(current)finish(null);});
 return {
  // Resolves with the input, its lines joined with \n, or with null once input has ended (Ctrl+C or Ctrl+D on an
  // empty prompt, or the end of piped input).
  read:prompt=>ended?Promise.resolve(null):new Promise(resolve=>{current={prompt,lines:[],resolve};rl.setPrompt(prompt);rl.prompt();}),
  close:()=>rl.close(),
 };
}
