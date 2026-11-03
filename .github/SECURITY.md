# Security policy

Loop 仍处于早期版本。请使用最新 main，并在受信任的机器与项目上部署。

## Reporting a vulnerability

请不要在公开 Issue 中发布可用凭证、攻击载荷或涉及用户数据的细节。优先使用 GitHub 仓库的 **Security → Advisories → Report a vulnerability** 私密报告入口：

https://github.com/i1mT/loop/security/advisories/new

如果入口尚未启用，可提交一个不包含漏洞细节的 Issue，请求维护者提供私密联络方式。不要在该 Issue 附上密钥或利用步骤。

报告请说明受影响版本、执行环境、复现条件、实际影响和建议修复方向。维护者暂不承诺固定响应时间或漏洞奖励。

## Deployment boundaries

- Coding agents run with automatic approval and inherit the execution user's access. Git worktrees are not a security sandbox.
- Do not expose a development gateway directly to the public internet.
- Keep gateway, daemon, project API and SDK identity credentials separate.
- Use separate development and production databases. Review backups, R2 permissions and provider authentication for your deployment.
