# 桌面版 ChatGPT 订阅与文本模型自动注册计划

2026-11-28 · 已在 `develop` 实现 · 开发基线 `0d787555`

用户在桌面版的「模型连接 → 文本」连接自己的 ChatGPT 订阅。授权成功后，Prompt Optimizer 自动把该账号可见的文本模型加入现有选择器，用户可以直接优化、迭代、对照测试和评估提示词。首版每份桌面资料保存一个订阅账号，切换账号会替换当前连接。

## 1. 用户体验

1. 文本模型页提供「连接 ChatGPT 订阅」入口，说明调用会使用所选账号的套餐额度。点击后打开系统浏览器，用户在 OpenAI 页面登录、选择工作区并授权套餐使用。
2. 返回桌面后校验实际授予的权限。取得套餐权限才同步模型。若用户只同意身份登录，页面显示「尚未授权使用套餐」并提供继续授权的操作。取消登录会回到原有页面，已有连接仍可使用。
3. 同步完成后，账号作为一条文本连接出现。编辑连接可以修改名称、默认模型及其参数。工作区和功能默认的选择器列出该账号的可用文本模型。
4. 连接区域提供「刷新模型」「管理用量」「断开连接」。首次启用按官方指引确认套餐使用。选中订阅模型时，在模型选择器附近标明「使用 ChatGPT 套餐」，管理用量打开 ChatGPT 官方设置。文案随项目现有语言资源交付。[官方交互指引](https://developers.openai.com/siwc/ui-ux-guidelines)

## 2. 工程落点

| 改动位置 | 实施内容 |
| --- | --- |
| [Electron 主进程](../../../packages/desktop/main.js) 与 [preload](../../../packages/desktop/preload.js) | 主进程负责授权、受保护凭据、模型目录和实际请求。preload 只提供连接状态、发起或取消授权、刷新、断开等业务操作。渲染层取得显示信息和模型配置引用。 |
| [文本适配器注册表](../../../packages/core/src/services/llm/adapters/registry.ts) 与 [LLM 服务](../../../packages/core/src/services/llm/service.ts) | 增加独立的 `chatgpt-subscription` 提供商标识。桌面创建服务时注入订阅适配器和当前连接，复用已有 LLM 调用与取消接口。桌面渲染层按需识别该提供商元数据。Web、扩展及独立 MCP 运行时不加载桌面授权模块。 |
| [ModelManager](../../../packages/core/src/services/model/manager.ts) 与 [文本模型配置](../../../packages/core/src/services/model/types.ts) | 将账号目录写入现有文本模型配置。沿用模型标识、启停、历史引用和导出机制，只新增订阅配置所需的连接引用及目录同步逻辑。 |
| [文本模型管理页](../../../packages/ui/src/components/TextModelManager.vue) 与 [工作区刷新入口](../../../packages/ui/src/components/app-layout/PromptOptimizerApp.vue) | 按桌面桥能力显示连接入口。同步成功后重新加载文本模型并触发现有 `modelsUpdated`，让已打开的工作区同步更新。 |

**依赖选择。** 官方 Electron 示例可以用来核对行为。其 DevKit 源码采用非商业许可证，本项目按 AGPL-3.0 分发。实施采用公开的 OAuth/OIDC 协议、标准库和现有 OpenAI SDK，自行实现桌面连接，不复制或打包 DevKit。ID Token 签名等密码学验证交给成熟的 OIDC/JWT 库。桌面新增模块和生产依赖须进入安装包的文件清单。[DevKit 许可证](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE) · [项目许可证](../../../LICENSE) · [桌面打包配置](../../../packages/desktop/package.json)

## 3. 授权与凭据

- **首次连接。** 每份本地安装生成并持久化稳定的 `ext_agent_host_id`。主进程先在 `127.0.0.1` 的可用端口监听，再以产品名 Prompt Optimizer 和首次注册入口 `dynamic_agent_client` 打开官方登录页面。使用 PKCE S256、随机 `state` 和 `nonce`，请求身份权限及 `offline_access resource.invoke chatgpt.tokens.use.direct`。回调验证后用实际签发的 `client_id` 换取令牌，验证 ID Token 的签名、签发者、受众、时效和 nonce，并核对实际授予的套餐权限。同一注册重新授权时复用已签发的客户端标识。[官方注册与授权流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- **持久化与续期。** 凭据由主进程放在当前桌面资料下的专用受保护存储中，与业务数据库、设置和备份分开。持久化采用 Electron 系统安全存储和原子替换。Linux 缺少有效密钥环时可在本次会话内使用，并提示重启后需重连。并发请求共享同一连接的续期操作，轮换后的令牌和过期时间一并保存。同一资料若有多个进程，续期写入须协调，避免复用旧 refresh token。[官方会话管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [Electron 安全存储](https://www.electronjs.org/docs/latest/api/safe-storage)
- **断开与恢复。** 断开后立即停用该连接、取消待完成的授权或请求，按官方协议撤销可续期会话并清理本地令牌。离线时也能本地退出，同时说明远端撤销尚未确认。重启可恢复有效连接。将备份恢复到新设备时，订阅配置只带回模型引用，需在新设备上完成授权才能调用。日志、错误、IPC 返回值和备份均不携带令牌或授权码。[官方服务条款](https://openai.com/policies/sign-in-with-chatgpt-terms/)

## 4. 模型目录怎样同步

授权成功和手动刷新时，以当前连接调用 `GET https://api.openai.com/v1/models`。订阅目录读取 `models[]`，只采用 `visibility == "list"` 的可见文本模型，保留服务端顺序。界面显示 `display_name`，请求使用 `slug`。获取目录本身足以注册模型，无需为每个模型发送消耗套餐的试用请求。[官方模型目录](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

| 情况 | 处理 |
| --- | --- |
| 首次发现、重复登录、重启 | 用本地账号注册引用派生连接 ID，目录里的模型使用各自的 `slug`。重启恢复上次成功目录，同一注册重新授权复用原连接。 |
| 用户已有配置或偏好 | 刷新保留当前连接的名称、启停状态、仍然可用的默认模型和兼容参数。 |
| 成功目录有增减 | 新增模型自动出现，已下架模型从选择器中移除。若原默认模型已下架，连接改用目录中的首个可用文本模型。 |
| 目录失败或返回格式异常 | 保留上次成功目录，允许直接重试刷新。首次授权成功但目录获取失败时，展示「已连接，模型同步失败」，重试同步无需重新登录。有效的空目录单独显示。 |
| 断开、换号、刷新请求交错 | 配置绑定已核验的账号和工作区。旧条目不能借新账号发请求。提交目录前核对连接和刷新版本，丢弃旧请求的迟到结果。 |

目录先完整解析，再通过 ModelManager 使用现有存储的 `updateData` 对模型集合做一次同步写入，避免同步中途只出现半批条目。执行工作区请求时，主进程分别核对当前连接可用性和用户启停设置。手动「测试连接」沿用现有语义，允许测试已停用的模型，同样校验账号授权和模型可用性。[现有 SQLite 原子更新](../../../packages/core/src/services/storage/sqliteStorageProvider.ts) · [现有连接测试](../../../packages/core/src/services/llm/service.ts)

## 5. 文本推理怎样接入

- 订阅连接固定使用官方 `POST https://api.openai.com/v1/responses`。渲染层或导入的模型配置无法改变令牌发送目的地。请求使用桌面现有网络与代理设置。将系统提示映射为 developer 消息或 `instructions`，按原顺序携带用户、助手及所需历史，每次固定 `store: false`、`stream: true`。[官方推理协议](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- 复用现有 Responses 文本增量、推理和用量解析。流式入口向原有回调实时返回数据。要求一次性结果的入口在适配器内部收完整条流，再返回原有 `LLMResponse`。这覆盖「测试连接」、优化和评估中的非流式调用。沿用原来的取消信号。[现有 Responses 适配器](../../../packages/core/src/services/llm/adapters/openai-adapter.ts) · [评估服务](../../../packages/core/src/services/evaluation/service.ts)
- 参数表只展示订阅通道和所选模型实际支持的参数。构造请求时同样过滤历史或导入配置中的 `temperature`、`top_p`、`max_output_tokens` 等不支持字段。普通文本请求只发送所需内容。高级测试若携带函数工具，须按订阅协议转换并确认模型支持，否则向用户指出不支持的能力。[官方能力范围](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- 只有收到 `response.completed` 才记为成功。分别处理 `response.failed`、`response.incomplete`、用户取消和提前断流。额度耗尽时保留账号连接并提供「管理用量」，授权失效时提供重新连接，网络错误允许重试。已开始输出的请求不自动重放，避免重复消耗额度。[官方错误与恢复说明](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## 6. 实施顺序与验收

| 阶段 | 可检查的交付结果 |
| --- | --- |
| 1. 打通桌面授权与一条文本请求 | 从桌面打开官方登录页，完成回调、权限校验和凭据保存。用同一连接取回目录，从中选一个真实 `slug` 完成一次文本回复。先验证授权和推理可连通。 |
| 2. 接入模型管理与工作区 | 实现目录同步、订阅适配器、参数与流式处理。通过原有模型选择和 LLM 服务运行优化、迭代、测试和评估。合成目录与事件流覆盖动态增减、并发续期、取消和中断。 |
| 3. 完成桌面交互和回归 | 完成连接、额度提示、刷新、重连、断开与多语言。检查桌面打包、原有文本提供商调用、备份导入，以及共享 UI 在其他端的表现。 |
| 4. 真实业务验收 | 使用已授权的真实订阅账号，在隔离的桌面资料中执行以下验收，并记录实际平台、版本、模型、结果和未验证项。 |

**真实验收用例**

1. 启动桌面版，连接订阅并完成官方授权。确认文本列表只出现一条订阅连接，工作区选择器里的模型与该账号的可见目录一致。再次刷新，核对连接 ID、仍可用的默认模型和启停状态。
2. 选一个订阅模型，优化一段提示词。用同一模型对照测试原版与优化版，再用订阅模型完成一次评估。检查流式输出、最终结果、实际模型名和历史记录，并从界面打开官方用量设置。
3. 测试连接成功后，发起一条流式请求并取消。重启应用后确认连接恢复、原选择仍有效。断开连接后旧配置立即不可调用，再连接能恢复对应模型。
4. 自动化覆盖拒绝套餐权限、目录失败后重试、账号切换、额度错误、流中失败、令牌轮换与备份恢复。使用合成凭据检查日志、IPC 和导出内容。Windows、macOS、Linux 分别记录已验证的系统浏览器回调与安全存储行为。

### 当前验证记录

- 在 Windows x64 和 Electron 44.9.3 的独立桌面资料中，从实际界面点击「使用 ChatGPT 继续」，用模拟 OpenAI 服务完成回调、JWT 验签和目录同步。含可见文本、隐藏及图像条目的目录只注册了 `qa-text`。刷新后配置 ID 相同。
- 在桌面选择器选中 `qa-text`，完成优化、写入历史并执行迭代。在工作区点击「全部运行」，原版和优化版分别显示各自的模拟回复。点击「分析」后界面显示预设的 85 分。重启后连接恢复，断开后旧配置无法调用。独立测试还验证了评估模板、分数解析和模型引用。[文本服务测试](../../../packages/core/tests/unit/llm/chatgpt-subscription.test.ts)
- 双列测试复现了 Electron 调用返回先于流式事件到达的问题。主进程现在为每次请求发送有序的结束事件，预加载层等该事件到达后才移除监听。回归用例覆盖并发请求分别显示各自的结果，以及失败后的监听清理。[桌面 IPC 测试](../../../scripts/desktop-ipc-handlers.test.mjs)
- 授权与会话测试覆盖错误 state、签名与 nonce 校验、取消、仅身份授权、目录错误、跨实例续期、切换账号和远端撤销失败。界面测试覆盖连接、刷新失败后保留目录以及断开后的工作区更新。[桌面会话测试](../../../packages/desktop/config/chatgpt-subscription.test.js) · [界面测试](../../../packages/ui/tests/unit/components/ChatGPTSubscriptionConnection.spec.ts)
- 开发期间生成了未签名的 Windows x64 NSIS 测试安装包，并用隔离资料验证打包版可以读取配置、进入工作区。
- 本次按约定仅完成隔离测试与 Windows 桌面打包。真实账号授权、实时套餐目录与扣量，以及 macOS 和 Linux 的原生运行效果，均未实测。
