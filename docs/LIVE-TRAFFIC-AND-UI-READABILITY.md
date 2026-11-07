# 实时流量统计与 UI 可读性（0.3.15）

状态：**设计已定，待实现**。当前正式版本 0.3.14；本轮目标版本 0.3.15。

## 1. 用户目标

1. 连接中心在连接成功后显示实时上传速度、实时下载速度、本次上传累计、本次下载累计，两项累计必须独立展示。
2. 同时显示当前会话时长；连接结束后停止刷新并保留最后一帧结果，下一次成功连接时创建全新会话计数。
3. 节点管理显示每个节点的历史累计上传、累计下载与合计；节点保留稳定 ID 时统计持续累计，删除节点时清除孤儿统计。
4. 节点表格指标标题可点击排序：PING、TCPING、代理延迟、最近下载速度、累计上传、累计下载、累计流量；再次点击同一标题反转方向。未测试、超时、N/A 或无统计的项目始终排在末尾；相同数值保持原始相对顺序。排序不得改变选中节点、活动节点或批测勾选。
5. 左下角版本标签降为普通辅助文字：14px、常规字重、低对比度颜色，不再使用加粗和强调色。
6. 对所有页面做字号检查；普通正文、说明、表头、表格辅助信息及 HTML small 至少 14px，页面主标题/卡片标题可按现有层级更大。避免为了放大而破坏节点列表横向滚动或表单布局。

## 2. 方案与数据来源

### 2.1 sing-box 会话统计

- 当前运行核心固定为 sing-box 1.14.4，不升级核心、不增加 npm 依赖。
- 使用当前核心内置 Clash API 的 `GET /connections` 快照。v1.14.4 源码 `experimental/clashapi/connections.go` 的响应字段为 `uploadTotal`、`downloadTotal`、`connections`；累计值由 traffic manager 提供，包含活动及已关闭连接的统计。
- `experimental.clash_api.external_controller` 仅监听 `127.0.0.1:<随机端口>`；每次会话生成随机 Bearer secret。secret 与 API 地址仅留在 Electron main/shared controller 的内存中，绝不通过 IPC、Renderer、日志或持久化状态暴露。
- main/shared 每秒轮询一次快照，用累计计数差计算瞬时速率；速率对最近 3 个有效样本做平滑，累计始终使用核心返回的原始单调计数。无效响应、重连和计数回退不得生成负流量；API 短时不可达时 UI 显示“统计暂不可用”，不能把缺失当成 0。
- 会话成功启动后建立独立 sessionId 和零起点；断开/核心意外退出前最后读取一次快照，再停止采样，发出 final 事件。下一次连接绝不继承上一次会话数值。

### 2.2 本地代理与系统 TUN 的归属边界

- **本地代理会话：** 当前配置的 route final 固定为 selected-proxy，因此该会话累计上传/下载可归属到当前 nodeId。累加到加密状态中的该节点历史统计。
- **系统 TUN 会话：** 分流规则可能把 LAN、用户规则、SSTap Direct、大陆规则等流量交给 direct outbound。当前随包官方核心不应假定提供 V2Ray outbound stats。因此首页显示的是“系统 TUN 本次流量（含直连流量）”，可准确反映本次 sing-box 会话流量，但**不得将整个 TUN 总量错误加到当前节点的累计流量**。
- 节点管理累计列明确标注“代理累计”；当前版本只累计可准确归属的本地代理会话。TUN 的系统总流量只在连接中心显示，不计入节点个人累计。未来若要做到 TUN 下精确 per-outbound 统计，必须先对随包二进制验证额外统计 API 能力，再另行设计，不在本轮假装精确。

### 2.3 UI 布局

连接中心新增一张紧凑的会话流量卡片：
- 两个主要数值：下载速度、上传速度（单位自动 B/s、KB/s、MB/s、GB/s）。
- 两个独立累计值：本次下载、本次上传（自动 B、KB、MB、GB、TB）。
- 显示会话时长、工作模式（本地代理 / 系统 TUN）。
- 未连接时显示占位提示，不展示旧会话的速率；结束时保留 final 累计和“已断开”状态，下一次成功连接清零。

节点表增加“上传累计”“下载累计”“合计”三列，标题可点击并有当前排序方向指示；所有排序都只生成派生列表，不改写 state.nodes。

### 2.4 持久化与性能

- 在当前加密 `state.enc.json` 中新增 `nodeTrafficStats`，结构为按 nodeId 索引的 `uploadBytes`、`downloadBytes`、`updatedAt`；字节数为非负安全整数。
- 每秒事件只更新 main 内存缓存并向 Renderer 推送；最多每 10 秒批量写一次加密状态，并在本地代理断开、核心意外退出和应用退出时强制 flush。禁止每秒对磁盘进行一次加密写入。
- 复用现有 serialized save queue / atomic temp-file rename；统计写入失败必须记录错误但不能影响连接进程退出或 TUN 清理。
- 校验持久化条目时只接受当前有效 nodeId；删除节点时清理对应统计；订阅刷新保留稳定 ID 的统计。

## 3. 影响文件

预期新增：
- `src/shared/singbox-traffic.cjs`：Clash API 端口/随机密钥配置、快照采样、速率平滑、会话 final 事件。
- `src/shared/singbox-traffic.test.mjs`：统计快照解析、上传/下载方向、首个样本、累计差、速率、计数回退、API 超时、停止与 final 事件等测试。

预期修改：
- `src/shared/singbox-config.cjs`、`src/shared/tun-config.cjs`：可选且经过校验的 Clash API 配置，仅当 controller 显式传入时启用。
- `src/shared/core-controller.cjs`、`src/shared/tun-controller.cjs`：为各会话启动/停止统计器并在生命周期中安全回收。
- `apps/desktop/src/main/index.cjs`：统计事件、节点累计统计加总、加密持久化批处理、断开/退出 flush。
- `apps/desktop/src/preload/index.cjs`、`apps/desktop/src/renderer/src/global.d.ts`：仅增加 typed traffic event 订阅。
- `apps/desktop/src/renderer/src/main.tsx`、`style.css`：连接中心卡片、节点流量列、可排序表头、字节/速率/时长格式化、版本标签弱化和全局 small 字号下限。
- `scripts/validate-singbox-configs.mjs`、相关 shared tests：真实核心配置矩阵增加启用/未启用 Clash API 的检查。
- `package.json`、`package-lock.json`、.NET Agent 版本字段、构建脚本、README、CHANGELOG、`docs/RELEASE-0.3.15.md` 与交接文档：正式版本统一提升到 0.3.15。

## 4. 安全和回归约束

- Clash API 不得监听 0.0.0.0、LAN 地址或可被外部访问的接口；每次会话必须有不可预测 secret。
- API URL 和 secret 不得从 IPC 返回；Renderer 不允许直接 fetch 本地 API。
- 统计器失败不应导致核心连接失败、TUN start/stop 失败或绕过现有 fail-closed 清理锁。
- 不得修改系统代理、不变更路由、不影响节点测速/批量测速隔离。
- TUN 当前统计名称必须明确含直连；节点表统计只累计本地代理，避免把 Direct 流量错归到代理节点。
- 所有字节差值必须非负、安全整数；异常计数重置时重建基线而不添加负值/溢出值。
- 批量测速独立 sing-box 进程不并入主会话计数；单节点测速若复用活动本地代理会话，其真实经过该会话的流量属于该会话流量，文档明确此行为。
- 字号巡检必须扫描 CSS 字号声明、浏览器默认小字号、Renderer inline style 和页面中实际使用的 small 文本；普通可读文本不低于 14px。

## 5. 验收与测试

### 自动化
- 快照解析：识别 v1.14.4 的 `uploadTotal`、`downloadTotal`；分别验证方向，不交叉、不反号。
- 首次样本建立基线，不把启动前流量计入当前会话；后续样本累计差准确；速率有界且平滑。
- API 返回错误、超时、非法/负数/溢出计数时不崩溃、不产生伪流量；累计回退时重建基线。
- stop 时清除定时器、阻断晚到结果并发出一次 final。
- 本地代理累计按正确 nodeId 单独加上行/下行；TUN 样本不进入 per-node 统计；删除节点后统计修剪。
- 状态迁移兼容旧版缺少 `nodeTrafficStats` 的加密文件。
- 节点排序升/降序、稳定同值、无数据永远置底、切换排序不变更 selectedNodeId/勾选集。
- UI 字体回归：所有普通文本及 small 至少 14px；版本号 14px、常规字重、弱对比度。
- npm test、verify:lock、sing-box 真实配置检查、Windows .NET Agent / TS/Vite / NSIS 安装包全链路。

### Windows 10/11 实机
- 本地代理：连接后实时速率随流量上下变化；本次上传/下载分别累计；断开停止并保留最终值；重连归零。
- 本地代理节点个人累计跨断开/应用重启持续累加；换节点不串账；节点删除后不留统计。
- TUN global 与 bypass-cn/rule：显示本次上传/下载及速率；浏览器访问直连/代理业务时总量增加；显示文案明确“含直连流量”。
- TUN 流量不得被错误加到节点个人累计；TUN 清理行为与当前安全锁一致。
- 不连接时无旧速率残留；API 故障时 UI 不显示伪 0。
- 全部页面字号、节点页横向滚动、窄窗口布局、版本号显示均需实际检查。
- 自动化与 Windows 构建通过不等于上述实机验收通过。

## 6. 回滚

- 单独的 main 小提交便于用 GitHub Revert 回退；不重写历史或 force push。
- 若 Clash API 配置导致核心配置校验失败，回退本轮 API 配置前先禁用该配置，但不放宽 loopback/secret 约束。
- 持久化统计是向 state schemaVersion 1 增加可选字段；旧数据文件未含字段时迁移为空对象即可。回滚代码不应损坏节点、订阅或旧测速结果。
