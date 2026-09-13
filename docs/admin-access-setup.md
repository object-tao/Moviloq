# 管理员账号密码登录与恢复

## 当前方案

按所有者要求，`admin.moviloq.com` 只使用 Moviloq 自有账号密码登录；不要求 Cloudflare 邮箱验证码或 MFA。旧 Access/JWT 方案已由本方案替代，不要重新运行历史版本的 Access 初始化脚本。

- 首位管理员用户名为所有者确认的邮箱（仅保存在私有配置及认证数据库）。没有公开注册入口或通用默认密码。
- 专用 EU D1：`moviloq-admin-auth-production`，只保存管理员认证数据，不连接客户草稿数据库。
- 密码采用随机盐和版本化 scrypt 哈希（N=32768、r=8、p=3，32 MiB），不保存明文。新密码 15–128 个字符，允许长句与 Unicode。
- 登录时账号/邮箱别名合并限流：每个账号每 15 分钟最多 5 次尝试；每个 IP 最多 20 次。成功登录也计入该窗口。达到限制后等待窗口结束，不永久锁死账号。
- 随机会话令牌只以 SHA-256 保存；生产 Cookie 使用 `__Host-`、Secure、HttpOnly、SameSite=Strict，绝不设置父域 Domain。最长 8 小时，30 分钟无活动失效。
- 登录、退出、改密均检查同源 Origin 和 CSRF；退出必须 POST。改密要求当前密码并立即撤销所有旧会话。
- 如按所有者要求配置临时初始凭据，服务端设置 `must_change_password=1`。登录后仅允许改密/退出及受限会话状态，工作台和其他接口不能绕过该限制。成功设置独立新密码后才解除；新密码不能与账号或邮箱相同。不在仓库记录临时凭据内容。
- 认证事件不记录原始密码、Cookie、邮箱或 IP；IP 使用服务端密钥 HMAC。认证事件保留 30 天，过期会话及限流记录每日 03:17 UTC 清理。提供商备份保留另行管理。
- 当前只开放安全状态页、改密和退出；订单、客户、司机、车队和资金操作均未开放。司机与车队不能获得管理员权限。

参考：[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Workers Node.js crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)。没有 MFA 时密码泄露仍可能导致账户被接管；请使用独立长密码并保存在密码管理器中。

## 首次配置（受信任操作员本机）

1. 按 `wrangler.admin.jsonc` 对专用 `ADMIN_DB` 应用 `admin-migrations`，不要对客户 DB 执行这套迁移。
2. 为 admin Worker 设置随机 32 字节、64 位十六进制 `ADMIN_AUTH_SECRET` secret，用于日志 IP 指纹。它不是密码，也不是 Cloudflare API Token。发布会保留该 secret。
3. 本机环境变量提供 `CLOUDFLARE_API_TOKEN`、`MOVILOQ_ADMIN_OWNER_EMAIL` 和 `MOVILOQ_ADMIN_OWNER_SHA256`（已确认邮箱的小写 SHA-256），运行 `node scripts/setup-admin-password.mjs`。工具核对邮箱与指纹一致；这些值不写入公开源码。
4. 所有者亲自打开工具输出的 `127.0.0.1` 链接设置密码；窗口 15 分钟后关闭，只绑定回环地址，校验 Host、Origin、一次性令牌及 Cookie。工具不打印密码/哈希，不将密码写入文件。首次设置仅允许空的管理员表，绝不覆盖现有账号。
5. 密码保存在数据库前已在本机哈希。不要把密码、API Token 或含敏感信息的截图发到聊天、GitHub 或 CI。

## 从旧 Access 方案切换

这是一次受控迁移，不是每次部署自动删除 Access 应用：

1. 先完成独立数据库、密码及 secret；旧 Access 仍保护 admin 域名。
2. 在真实 workerd + D1 + 浏览器中验证新程序及合成凭据；确认构建和安全测试通过。
3. 手动部署已验证的新 admin Worker，保持旧 Access 前置保护。
4. 核对 Worker 已是密码版本、绑定只包含认证数据库、生产所有者已配置后，仅移除 `admin.moviloq.com` 的旧 Access 应用，并删除该 Worker 的旧 `ADMIN_AUTH_CONFIG` secret。不得修改其他应用、身份提供商或组织全局策略。
5. 执行 `admin-smoke.mjs` 与 `verify-admin-password.mjs`，确认自有登录表单、未登录 API 拒绝、源站隔离及所有者状态；再合并发布，使后续 CI/CD 使用新检查。

不要在配置完成前移除旧保护。新版本缺少 secret/DB 时返回 503，业务访问保持关闭。切换后不要直接回滚到依赖已删除 Access 配置的旧 Worker。

## 日常使用与恢复

- 在管理台使用“修改密码”；输入当前密码和新密码后全部设备退出，再用新密码登录。
- 忘记密码时，由已获授权的本机操作员在同样环境运行 `node scripts/setup-admin-password.mjs --reset-owner`，让所有者本人设置。工具必须匹配唯一的 owner 身份；提高凭据版本使旧会话立即失效，不通过公开网页提供无验证重置。
- 紧急停用通过专用数据库将对应 owner 的 `status` 设为 `disabled`，所有旧会话立即失效。操作须另有明确授权；不要删除用户表或整个数据库。
- 持续 CI 使用 `MOVILOQ_ADMIN_OWNER_SHA256` 检查身份漂移，不保存真实管理员密码。浏览器测试只在隔离的内存数据库中使用一次性合成密码。
- 已在聊天中暴露的 Cloudflare API Token 应在替换本机/CI 使用者后撤销；不得为此意外中断其他项目。

## 本地验证

`pnpm check` 完成 lint、类型、SQLite/密码单元测试和构建；随后运行 `node scripts/admin-browser-smoke.mjs`，启动隔离 workerd 与 D1，在真实 Chromium 中完成登录、退出、改密及移动端布局检查。不会使用生产账号。

如所有者提供了临时凭据，可以在不打印或提交凭据的前提下验证生产登录及改密限制；不能代替所有者选择最终独立密码。Workers 密码哈希需要 CPU 预算；应观察实际运行限制，不得自动购买或升级套餐，也不得为绕过限制降低哈希强度。
