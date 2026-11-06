import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('安装脚本：完整性失败保留旧版本，重连复用缓存，平台限制有明确反馈',()=>{
 const scratch=mkdtempSync(join(tmpdir(),'loop-install-test-'));
 try {
  const bin=join(scratch,'bin');const fixture=join(scratch,'fixture');const home=join(scratch,'用户 HOME');
  mkdirSync(bin);mkdirSync(join(fixture,'bin'),{recursive:true});mkdirSync(home);
  writeFileSync(join(fixture,'bin/loopd'),'#!/bin/sh\nprintf "fixture loopd\\n"\n',{mode:0o755});
  const archive=join(scratch,'package.tar.gz');execFileSync('tar',['-czf',archive,'-C',fixture,'.']);
  const sha=createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(bin,'uname'),'#!/bin/sh\nif [ "$1" = "-s" ]; then printf "%s\\n" "${MOCK_OS:-Darwin}"; else printf "arm64\\n"; fi\n',{mode:0o755});
  writeFileSync(join(bin,'curl'),`#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2);const url=args.find(value=>value.startsWith('https:'));
appendFileSync(process.env.MOCK_CALLS,url+'\\n');
const version=process.env.MOCK_VERSION ?? '1.0.0';
const file='loopd-'+version+'-darwin-arm64.tar.gz';
if(url.includes('/latest?')) process.stdout.write(version+' '+file+' '+process.env.MOCK_SHA+'\\n');
else writeFileSync(args[args.indexOf('-o')+1],process.env.MOCK_CORRUPT ? Buffer.from('not a gzip') : readFileSync(process.env.MOCK_ARCHIVE));
`,{mode:0o755});
  // 扩展名为空的脚本默认按 CommonJS 读取；显式使用 .mjs 入口。
  const curl=readFileSync(join(bin,'curl'),'utf8').replace("import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';","const {readFileSync,writeFileSync,appendFileSync}=require('node:fs');");
  writeFileSync(join(bin,'curl'),curl);chmodSync(join(bin,'curl'),0o755);
  const calls=join(scratch,'calls');
  const env={...process.env,HOME:home,PATH:bin+':'+dirname(process.execPath)+':/usr/bin:/bin',MOCK_SHA:sha,MOCK_ARCHIVE:archive,MOCK_CALLS:calls};
  const installer=resolve(import.meta.dirname,'../../apps/web/public/install.sh');
  const run=(overrides={})=>spawnSync('/bin/sh',[installer,'--gateway','https://install.example.test'],{env:{...env,...overrides},encoding:'utf8'});
  const installed=run();assert.equal(installed.status,0,installed.stderr);
  const command=join(home,'.local/bin/loopd');assert.ok(existsSync(command));
  const before=readFileSync(command,'utf8');
  const cached=run();assert.equal(cached.status,0,cached.stderr);assert.match(cached.stdout,/无需重新下载/);
  assert.equal(readFileSync(calls,'utf8').split('\n').filter(line=>line.endsWith('.tar.gz')).length,1,'重复连接不重新下载');
  const badChecksum=run({MOCK_VERSION:'2.0.0',MOCK_SHA:'0'.repeat(64)});
  assert.notEqual(badChecksum.status,0);assert.match(badChecksum.stderr,/校验失败/);assert.equal(readFileSync(command,'utf8'),before);
  const corrupt=run({MOCK_VERSION:'3.0.0',MOCK_CORRUPT:'1',MOCK_SHA:createHash('sha256').update('not a gzip').digest('hex')});
  assert.notEqual(corrupt.status,0);assert.equal(readFileSync(command,'utf8'),before);assert.ok(!existsSync(join(home,'.local/share/loop/versions/3.0.0')));
  const unsupported=run({MOCK_OS:'Windows_NT'});assert.notEqual(unsupported.status,0);assert.match(unsupported.stderr,/WSL2/);
 }finally {rmSync(scratch,{recursive:true,force:true});}
});
