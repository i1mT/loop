import { readFileSync } from "node:fs";

/** 源码与便携包共用包版本，避免命令输出与心跳不一致。 */
export const LOOPD_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
