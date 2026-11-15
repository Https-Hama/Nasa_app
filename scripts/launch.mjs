import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { createSuggestionHandler } from './gemini-suggestions.mjs';

const suggestions = createSuggestionHandler();

const root=resolve(import.meta.dirname,'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm','.task':'application/octet-stream'};
const server=createServer(async(req,res)=>{
 try{
  if(await suggestions(req,res))return;
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
  if(!(await stat(file)).isFile())throw Error('Not a file');
  const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(bytes);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
let port=4173;
server.on('error',error=>{
 if(error.code==='EADDRINUSE'&&port<4190){port++;server.listen(port,'127.0.0.1');}
 else{console.error('Could not start the game:',error.message);process.exitCode=1;}
});
server.on('listening',()=>{
 const url=`http://127.0.0.1:${port}`;
 console.log('\n  HUMAN.exe — ORBITAL\n\n  Your mission is ready.\n  '+url+'\n\n  Keep this window open while playing. Press Ctrl+C to close.\n');
 if(!process.argv.includes('--no-open')){
  if(process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url]);
  else if(process.platform==='darwin')execFile('open',[url]);
  else execFile('xdg-open',[url]);
 }
});
server.listen(port,'127.0.0.1');
