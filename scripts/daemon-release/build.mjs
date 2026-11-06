// 在维护者电脑打包；用户不需要 Node、pnpm 或仓库。--os/--cpu 让 pnpm 安装目标平台的可选依赖。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, chmodSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '/tmp/loop-machine-scratchpad/releases');
const targets = (process.argv[3] ?? `${process.platform}-${process.arch}`).split(',');
const version = JSON.parse(readFileSync(join(root,'apps/daemon/package.json'),'utf8')).version + '-' + execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const nodeVersion = '24.13.0';
mkdirSync(out,{recursive:true});
const manifest = {};
function run(command,args,cwd=root) { execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}}); }
function portableBins(dir) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const file=join(dir,entry.name);
    if (entry.isSymbolicLink()) {
      // deploy 的虚拟仓库会保留未打包工作区的 hoisted 别名；这些不是运行依赖。
      if (!existsSync(file)) {rmSync(file);continue;}
      const target=realpathSync(file);
      if (!target.startsWith(realpathSync(dir).split('/node_modules')[0]+'/')) {
        if (file.includes('/.pnpm/node_modules/@loop/')) {rmSync(file);continue;}
        throw new Error('依赖链接指向安装目录外：'+file);
      }
    } else if (entry.isDirectory()) portableBins(file);
    else if (dir.endsWith('/.bin') && !file.endsWith('.cmd') && !file.endsWith('.ps1')) {
      const source=readFileSync(file,'utf8');
      writeFileSync(file,source.replace(/if \[ -z "\$NODE_PATH" \]; then[\s\S]*?\nfi\n/,'').replace(/export NODE_PATH=[^\n]+\n/g,''));
    }
  }
}
function prune(dir) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const file=join(dir,entry.name);
    if (entry.isDirectory()) { if (entry.name==='testing') rmSync(file,{recursive:true});else prune(file); }
    else if (entry.name.endsWith('.test.js') || entry.name.endsWith('.map')) rmSync(file);
  }
}
for (const target of targets) {
  if (!/^(darwin|linux)-(arm64|x64)$/.test(target)) throw new Error('不支持的平台 '+target);
  const [os,cpu]=target.split('-');
  const stage=join(out,`stage-${target}`);
  rmSync(stage,{recursive:true,force:true});
  run('pnpm',['--filter','@loop/daemon','--prod','deploy','--legacy',`--os=${os}`,`--cpu=${cpu}`,stage]);
  prune(join(stage,'dist'));
  portableBins(join(stage,'node_modules'));
  rmSync(join(stage,'pnpm-lock.yaml'),{force:true});
  for (const metadata of ['.modules.yaml','.pnpm-workspace-state-v1.json','.pnpm/lock.yaml']) rmSync(join(stage,'node_modules',metadata),{force:true});
  const archive=`node-v${nodeVersion}-${target}.tar.gz`;
  const archiveFile=join(out,archive);
  const sumsFile=join(out,'SHASUMS256.txt');
  run('curl',['--fail','--location','--silent','--show-error',`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`,'-o',sumsFile]);
  run('curl',['--fail','--location','--silent','--show-error',`https://nodejs.org/dist/v${nodeVersion}/${archive}`,'-o',archiveFile]);
  const expected=readFileSync(sumsFile,'utf8').split('\n').find(line=>line.endsWith('  '+archive))?.split(' ')[0];
  if (!expected || createHash('sha256').update(readFileSync(archiveFile)).digest('hex')!==expected) throw new Error('Node 官方摘要不匹配');
  const nodeDir=join(out,`node-${target}`);mkdirSync(nodeDir,{recursive:true});
  run('tar',['-xzf',archiveFile,'--strip-components=1','-C',nodeDir]);
  mkdirSync(join(stage,'bin'),{recursive:true});
  cpSync(join(nodeDir,'bin/node'),join(stage,'bin/node'));
  cpSync(join(nodeDir,'LICENSE'),join(stage,'NODE_LICENSE'));
  writeFileSync(join(stage,'bin/loopd'),'#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexport PATH="$ROOT/bin:$PATH"\nexec "$ROOT/bin/node" "$ROOT/dist/cli.js" "$@"\n',{mode:0o755});
  chmodSync(join(stage,'bin/node'),0o755);
  const file=`loopd-${version}-${target}.tar.gz`;
  run('tar',['-czf',join(out,file),'-C',stage,'.']);
  const sha256=createHash('sha256').update(readFileSync(join(out,file))).digest('hex');
  manifest[target]={version,file,sha256};
  console.log(JSON.stringify({target,file,sha256}));
  rmSync(stage,{recursive:true});rmSync(nodeDir,{recursive:true});rmSync(archiveFile);
}
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
