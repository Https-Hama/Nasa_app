import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('licenses',{recursive:true});
for(const name of ['three','react','react-dom']){
 await writeFile(`licenses/${name}.txt`,await readFile(`node_modules/${name}/LICENSE`));
}
for(const [name,url] of [
 ['mediapipe','https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE'],
 ['opencv','https://raw.githubusercontent.com/opencv/opencv/4.x/LICENSE'],
]){
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`${response.status}: ${url}`);
 await writeFile(`licenses/${name}.txt`,await response.text());
}
console.log('Runtime license notices collected.');
