// 生成"给 AI Agent 的接入说明"：自包含，复制给负责接入的 agent 就能照着做。
// 不包含签名密钥：密钥只通过环境变量交给后端，由人单独提供。

export function buildIntegrationDoc(o: { base: string; key: string; projectName: string; allowedOrigins: string | null }): string {
  const origins = (o.allowedOrigins ?? "").split(/[\s,]+/).filter(Boolean);
  const host = new URL(o.base).host;
  return `# 接入 Loop 反馈 SDK

你要把「Loop 反馈 SDK」接入当前这个网站（项目：${o.projectName}）。接入后，用户可以点页面右下角的"反馈"按钮，截图、选择页面元素、粘贴截图、写说明，并自动附带控制台报错和网络请求。反馈会进入 Loop 网关，由智能体处理，经项目负责人审核后发布。

请按下面的步骤做，做完逐条自检。**不要修改与接入无关的代码。**

## 已知信息

- 网关地址：\`${o.base}\`
- SDK 公钥（公开，可以写进前端）：\`${o.key}\`
- SDK 脚本：\`${o.base}/sdk.js\`
- 允许提交的站点（网关侧白名单）：${origins.length ? origins.map((x) => `\`${x}\``).join("、") : "未限制（任何站点都能提交）"}

## 第 1 步：加载 SDK（必做）

在每个页面都会加载的公共位置（根布局或 \`index.html\`）加入下面这行，**越靠前越好**，这样才能抓到页面加载早期的报错：

\`\`\`html
<script src="${o.base}/sdk.js" data-key="${o.key}" async></script>
\`\`\`

按项目的技术栈改写成对应写法，例如：

- **Next.js（App Router）**：在 \`app/layout.tsx\` 里用 \`next/script\`：
  \`\`\`tsx
  import Script from "next/script";
  // 放在 <body> 末尾
  <Script src="${o.base}/sdk.js" data-key="${o.key}" strategy="afterInteractive" />
  \`\`\`
- **Vite / React / Vue 等单页应用**：直接写进 \`index.html\` 的 \`<head>\`。
- **只想在登录后显示，或用自己的入口按钮**：不要用 \`data-key\` 自动初始化，改用代码调用：
  \`\`\`js
  LoopFeedback.init({ key: "${o.key}", hideButton: true }); // 不显示右下角入口
  LoopFeedback.open(); // 在你自己的按钮里调用
  \`\`\`

### 如果网站有内容安全策略（CSP）

需要放行下面这些，否则按钮不出现或发送失败：

- \`script-src\`：\`${o.base}\`
- \`connect-src\`：\`${o.base}\`
- \`img-src\`：\`blob: data:\`

## 第 2 步：识别用户身份（推荐，网站有登录体系时做）

目的：让网关知道提交者是管理员还是普通用户（管理员的反馈会被优先处理）。**角色必须由网站自己的后端签名**，网关验证签名后才信任；没有签名的反馈一律按普通用户处理。

### 2.1 后端签发令牌

令牌是标准的 JWT（算法 HS256），签名密钥放在**后端环境变量 \`LOOP_FEEDBACK_SECRET\`** 里。密钥由项目负责人在 Loop 网关"项目 → 接入 → SDK"里复制给你，**不要把密钥写进代码、前端或提交到仓库**。

令牌载荷字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| \`sub\` | 是 | 用户在本站的唯一 ID |
| \`role\` | 是 | \`"admin"\` 或 \`"user"\`，按本站的权限体系映射 |
| \`exp\` | 是 | 过期时间（秒级时间戳），建议 1 小时 |
| \`name\` / \`email\` | 否 | 用于后台展示和通知 |

Node.js 示例（其他语言用对应的 JWT 库，HS256 即可）：

\`\`\`js
import { createHmac } from "node:crypto";

export function signFeedbackIdentity(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: String(user.id),
    role: user.isAdmin ? "admin" : "user", // 按本站实际的管理员判断改写
    name: user.name,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = createHmac("sha256", process.env.LOOP_FEEDBACK_SECRET).update(head + "." + body).digest("base64url");
  return head + "." + body + "." + sig;
}
\`\`\`

### 2.2 前端传给 SDK

登录用户的页面拿到令牌后：

\`\`\`js
// 已经用 data-key 自动初始化的话：
LoopFeedback.setIdentity(tokenFromBackend);
// 或者手动初始化时一起传：
LoopFeedback.init({ key: "${o.key}", identity: tokenFromBackend });
\`\`\`

用户退出登录时调用 \`LoopFeedback.setIdentity(undefined)\`。令牌快过期时重新获取并再次调用 \`setIdentity\`。

## 第 3 步：自检

逐条确认并在最后汇报结果：

- [ ] 打开网站任意页面，右下角出现"反馈"按钮（改成自定义入口的话，调用 \`LoopFeedback.open()\` 能弹出面板）。
- [ ] 浏览器控制台没有与 SDK 相关的报错，网络面板里 \`${host}/sdk.js\` 返回 200。
- [ ] 点"截取页面"能截图并标注；点"选择元素"能高亮并选中页面上的元素；能 Ctrl/⌘+V 粘贴截图。
- [ ] 发送一条测试反馈，提示"已收到"，并显示反馈编号；让项目负责人在网关该项目的"任务"里确认收到（来源显示为 SDK）。测试反馈的说明里请写明"这是接入测试"。
- [ ] （做了第 2 步）以管理员账号提交一条，网关里的提交者显示"管理员、身份已验证"；以普通账号或未登录提交，显示"普通用户、身份未验证"。

## 常见问题

- **按钮不出现**：检查 CSP、脚本是否被打包工具或广告拦截误伤，以及页面是否在 \`<body>\` 之前就报了错。
- **发送失败（403）**：网关限制了允许提交的站点，把网站的域名告诉项目负责人，让他在网关"项目 → 接入 → SDK"里添加。
- **发送失败（429）**：提交太频繁被限流，稍后再试。
- **管理员身份没生效**：令牌过期、签名密钥不对、或没有在提交前调用 \`setIdentity\`；网关任务详情里会显示令牌无效的原因。

## SDK 接口速查

\`\`\`ts
LoopFeedback.init({
  key: string,                  // SDK 公钥（必填）
  identity?: string,            // 后端签发的身份令牌
  user?: { id?, name?, email? },// 仅用于展示，不会被信任为角色
  meta?: Record<string, unknown>, // 附带信息，如版本号、租户
  locale?: "zh" | "en",
  theme?: "auto" | "light" | "dark",
  hideButton?: boolean,         // 不显示右下角入口
  captureResponseBody?: boolean // 记录失败请求的响应体，默认关闭
});
LoopFeedback.open(); LoopFeedback.close();
LoopFeedback.setIdentity(token | undefined);
LoopFeedback.setUser({ id, name, email } | undefined);
\`\`\`
`;
}
