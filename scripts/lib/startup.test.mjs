import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('启动脚本先加载自定义数据目录，再沿用原机器连接并清除网关秘密',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-startup-'));
  try{
    for(const dir of ['scripts','apps/daemon','bin','custom data'])mkdirSync(join(root,dir),{recursive:true});
    copyFileSync(new URL('../start-daemon.sh',import.meta.url),join(root,'scripts/start-daemon.sh'));
    writeFileSync(join(root,'custom data/connection.json'),JSON.stringify({gateway:'https://loop.example.com',machineId:'existing-machine',token:'fixture'}));
    const config=join(root,'loop.env');
    writeFileSync(config,`LOOPD_HOME='${join(root,'custom data')}'\nLOOP_GATEWAY='https://loop.example.com'\nDATABASE_URL='fixture-private'\n`);
    writeFileSync(join(root,'bin/node'),`#!/bin/sh\nprintf '%s\\n' "$LOOPD_HOME" "\${LOOPD_MACHINE_ID:-unset}" "\${LOOPD_DAEMON_TOKEN:-unset}" "\${DATABASE_URL:-unset}" > "$LOOP_TEST_OUTPUT"\n`,{mode:0o755});
    const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,LOOP_CONFIG_PATH:config,LOOP_TEST_OUTPUT:join(root,'result')};
    for(const key of ['LOOPD_GATEWAY','LOOPD_DAEMON_TOKEN','LOOPD_MACHINE_ID','LOOPD_HOME','LOOP_DAEMON_TOKEN'])delete env[key];
    const result=spawnSync('bash',[join(root,'scripts/start-daemon.sh')],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(readFileSync(join(root,'result'),'utf8').trim().split('\n'),[join(root,'custom data'),'unset','unset','unset']);
  }finally{rmSync(root,{recursive:true,force:true});}
});
