// Node 目标的构建配置（Workers 目标见 ../vite.config.ts）。
// 构建根固定为 apps/web/node：vinext 只要在根目录看到 cloudflare.config.ts 就要求 Cloudflare 插件，
// 而 Node 目标恰恰不能带那个插件。appDir 指回上一层，源码与产物都不因此改动。
import { defineConfig } from "vite";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(root, "..");

export default defineConfig({
  root,
  plugins: [tailwindcss(), vinext({ appDir: app })],
  publicDir: path.join(app, "public"),
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${app}/$1` },
      // 源码里唯一保留的 Workers 专有导入；Node 目标指向本机实现。
      { find: "cloudflare:workers", replacement: path.join(app, "lib/runtime/env.node.ts") },
    ],
  },
  build: { outDir: path.join(root, "dist"), emptyOutDir: true },
});
