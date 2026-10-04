#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationRoot } from './integration.mjs';

const child=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe']});
let buffer='';const pending=new Map();let nextId=1;
const timeout=setTimeout(()=>{child.kill();process.stderr.write('Codex skill discovery timed out.\n');process.exitCode=1;},20000);
child.stdout.on('data',data=>{buffer+=data.toString();while(buffer.includes('\n')){const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const message=JSON.parse(line);if(message.id&&pending.has(message.id)){const handler=pending.get(message.id);pending.delete(message.id);message.error?handler.reject(new Error(JSON.stringify(message.error))):handler.resolve(message.result)}}catch{}}});
function rpc(method,params){const id=nextId++;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
try{
  await rpc('initialize',{clientInfo:{name:'sketch_diagram_install_check',title:'Sketch diagram installation check',version:'1.0.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized',params:{}})+'\n');
  const result=await rpc('skills/list',{cwds:[applicationRoot],forceReload:true});
  const discovered=(result.data||[]).flatMap(entry=>entry.skills||[]).filter(skill=>skill.name==='diagram');
  const usable=discovered.filter(skill=>skill.enabled!==false);
  if(!usable.length)throw new Error('Installed diagram skill absent or disabled: '+JSON.stringify(result));
  const filename=path.join(applicationRoot,'.installation.json');const metadata=JSON.parse(await readFile(filename,'utf8'));metadata.discovery='verified_via_codex_skills_list';metadata.discoveryVerifiedAt=new Date().toISOString();metadata.discoveredPaths=usable.map(skill=>skill.path);await writeFile(filename,JSON.stringify(metadata,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:'discovered',skills:usable.map(({name,path,enabled})=>({name,path,enabled}))},null,2)+'\n');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}finally{clearTimeout(timeout);child.kill();}
