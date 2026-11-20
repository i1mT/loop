import { readFileSync } from "node:fs";

const metadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string; loopRelease?: string };
export const LOOPD_RELEASE = metadata.loopRelease;
export const LOOPD_VERSION = LOOPD_RELEASE ?? metadata.version;
