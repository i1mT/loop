import {test} from "node:test";
import assert from "node:assert/strict";
import {canonicalPath} from "./path.ts";
test("鉴权路径与编码路由使用同一资源分类，拒绝分隔符与重复编码",()=>{
 for(const path of ["/api/projects/id/%73dk","/api/%70rojects/id/sdk","/api//projects/id/sdk","//api/projects/id/sdk"]){assert.equal(canonicalPath(new Request('https://test'+path)),"/api/projects/id/sdk");}
 assert.equal(canonicalPath(new Request('https://test/api/projects/id/api%2dkeys')),"/api/projects/id/api-keys");
 for(const path of ["/api/projects/id%2Fsdk","/api/projects/id%5Csdk","/api/%2570rojects/id/sdk","/api/projects/%00/sdk","/api/projects/%zz/sdk"]){assert.equal(canonicalPath(new Request('https://test'+path)),null,path);}
});
