import { withAgent } from "./harness.ts";
const [kind = "claude", repo = process.cwd()] = process.argv.slice(2) as any;
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  console.log(JSON.stringify({ modes: s.modes, models: (s.newSessionResponse as any).models ?? null }).slice(0, 900));
});
