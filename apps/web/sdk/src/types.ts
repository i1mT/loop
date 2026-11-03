export interface ConsoleEntry {
  t: number;
  level: string;
  msg: string;
  stack?: string;
}

export interface NetEntry {
  t: number;
  kind: "fetch" | "xhr";
  method: string;
  url: string;
  status: number;
  ok: boolean;
  ms: number;
  error?: string;
  body?: string;
}

export interface ElementInfo {
  selector: string;
  path: string;
  tag: string;
  text: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
  attrs: Record<string, string>;
  styles: Record<string, string>;
}

export interface UserInfo {
  id?: string;
  name?: string;
  email?: string;
}

export interface InitOptions {
  /** 来源密钥（后台项目页里的来源 key） */
  key: string;
  /** 网关地址，默认取 sdk.js 所在的域名 */
  endpoint?: string;
  user?: UserInfo;
  /** 接入应用后端签发的身份令牌（HS256 JWT）；网关验证通过才信任其中的角色 */
  identity?: string;
  /** 附带到反馈里的自定义信息，例如版本号、租户 */
  meta?: Record<string, unknown>;
  locale?: "zh" | "en";
  theme?: "auto" | "light" | "dark";
  /** 不显示右下角入口，只用 LoopFeedback.open() 唤起 */
  hideButton?: boolean;
  /** 记录失败请求的响应体（前 800 字符）。默认关闭，避免带出敏感数据 */
  captureResponseBody?: boolean;
  maxConsole?: number;
  maxNetwork?: number;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "screenshot" | "element" | "paste" | "upload";
  blob: Blob;
  url: string;
}
