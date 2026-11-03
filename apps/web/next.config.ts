import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 只影响开发服务器：放行接入验证用的跨站来源（SDK 会从别的网站向网关发请求）。生产 Worker 不受影响。
  allowedDevOrigins: ["app.example.com", "evil.com", "localhost", "127.0.0.1"],
};

export default nextConfig;
