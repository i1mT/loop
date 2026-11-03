# 接入指南

所有接入最终进入同一套反馈与任务流程，优先级、合并、方案审核和代码审核沿用项目规则。

## 项目 API

在项目 → 接入 → API 接入创建项目密钥。密钥只在创建时完整展示一次，数据库保存哈希，可以撤销。服务端调用：

```bash
curl -X POST "$LOOP_URL/api/v1/tasks" \
  -H "Authorization: Bearer $LOOP_PROJECT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"改进登录页提示","body":"说明背景与验收条件","releaseReview":true}'
```

支持 `title`、`body`、`priority`、`planReview`、`releaseReview`、`agent` 与 `externalRef`。反馈可能先进入合并池，此时返回 `feedbackId`、`pooled` 和空 `task`；形成任务后才能查询相应任务。

使用 `GET /api/v1/tasks/{id}` 查询本项目的任务。项目密钥不应进入网站前端、公开截图或日志。

## 浏览器 SDK

项目 → 接入 → SDK 接入提供可复制的嵌入代码、站点白名单与接入说明。构建网关时会生成 `/sdk.js`。

```html
<script src="https://loop.example.com/sdk.js" data-key="YOUR_SDK_PUBLIC_KEY" async></script>
```

SDK 支持截图、选择元素、文本描述、控制台信息和请求信息。只收集 SDK 加载后的控制台与请求记录。配置允许的站点；SDK 公钥可以公开，身份签名密钥不能公开。

如果需要将已登录用户关联到反馈，由网站后端签发身份 JWT，再传给 SDK。未经验证的反馈保留不可信输入声明；不能把任意访客反馈当作项目管理员指令。

## 飞书

空间 → 设置 → 飞书绑定企业自建应用机器人，配置应用凭证、企业标识与知识库父文档链接。

1. 开通单聊消息、群内 @ 机器人、发送消息、Wiki 与新版文档所需权限，订阅 `im.message.receive_v1`。
2. 为机器人授予目标 Wiki 父节点的编辑权限；API scope 与资源权限需要分别配置。
3. 复制页面生成的事件回调地址，配置 Verification Token 和 Encrypt Key。
4. 登录 Loop 生成账号关联码，单聊机器人完成关联。
5. 群聊需要在设置中绑定群 ID 与项目；每次命令仍检查发送者的空间成员资格。

发送「创建任务：需求内容」，或者「项目名称：创建任务：需求内容」。项目不明确时，机器人会要求选择。状态回复返回原聊天；同聊天中的合并反馈避免重复通知。

技术方案文档存放在固定 Wiki 父节点下。普通独立 docx 链接不能直接当作文档目录。方案保存失败时暂停实现；解决授权或网络问题后可以重试。

账号退出空间后，飞书身份不再获得该空间任务权限。配置页检查读取成功不等于拥有文档写入权限，需要完成一次实际测试任务。
