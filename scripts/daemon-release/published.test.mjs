import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPublished, isPackagedPath, parseRelease } from './published.mjs';

const sha = 'a'.repeat(64);
const line = (version) => `${version} loopd-${version}-darwin-arm64.tar.gz ${sha}`;

test('解析清单：拒绝格式不对的版本与摘要', () => {
  assert.equal(parseRelease(line('0.4.2-173e908')).commit, '173e908');
  assert.equal(parseRelease('0.4.2 file abc'), null);
  assert.equal(parseRelease(`0.4.2 file ${sha}`), null);
  assert.equal(parseRelease(''), null);
});

test('只有进入便携包的文件才算 daemon 改动', () => {
  for (const file of ['apps/daemon/src/serve.ts', 'packages/core/src/task-states.ts', 'apps/web/public/install.sh', 'pnpm-lock.yaml', 'scripts/daemon-release/build.mjs']) {
    assert.equal(isPackagedPath(file), true, file);
  }
  for (const file of ['apps/web/lib/status.ts', 'docs/architecture.md', 'apps/daemon/src/serve.test.ts', 'apps/daemon/src/testing/fake-agent.ts', 'packages/core/src/x.test.ts']) {
    assert.equal(isPackagedPath(file), false, file);
  }
});

test('线上版本低于仓库版本：过期（这次事故的情形）', () => {
  const result = checkPublished({ published: line('0.3.1-48c74de'), localVersion: '0.4.2', changedFiles: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /0\.3\.1-48c74de.*0\.4\.2/);
});

test('版本号相同但之后改过 daemon 代码：过期', () => {
  const result = checkPublished({ published: line('0.4.2-173e908'), localVersion: '0.4.2', changedFiles: ['apps/web/lib/a.ts', 'apps/daemon/src/serve.ts'] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /apps\/daemon\/src\/serve\.ts/);
  assert.doesNotMatch(result.reason, /apps\/web/);
});

test('之后只改了网页、文档和测试：视为最新', () => {
  const result = checkPublished({ published: line('0.4.2-173e908'), localVersion: '0.4.2', changedFiles: ['apps/web/lib/a.ts', 'docs/x.md', 'apps/daemon/src/serve.test.ts'] });
  assert.equal(result.ok, true);
});

test('无法确认时按过期处理：缺平台、找不到提交、清单损坏', () => {
  assert.equal(checkPublished({ published: null, localVersion: '0.4.2', changedFiles: [] }).ok, false);
  assert.equal(checkPublished({ published: line('0.4.2-173e908'), localVersion: '0.4.2', changedFiles: null }).ok, false);
  assert.equal(checkPublished({ published: 'garbage', localVersion: '0.4.2', changedFiles: [] }).ok, false);
});
