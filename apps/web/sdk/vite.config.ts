import { defineConfig } from "vite";

// 单独把 SDK 打成一个 IIFE，输出到 public/sdk.js，由网关自己托管
export default defineConfig({
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    lib: { entry: "sdk/src/index.ts", name: "LoopFeedbackBundle", formats: ["iife"], fileName: () => "sdk.js" },
    outDir: "public",
    emptyOutDir: false,
    minify: true,
    target: "es2019",
    sourcemap: false,
  },
});
