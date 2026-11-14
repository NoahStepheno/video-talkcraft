# 复用本地 Toonflow 的 ComfyUI 适配器

用户已在 Toonflow 配好、测试过 ComfyUI 时，使用 `scripts/toonflow_media.mjs` 引用用户本地的可信 TypeScript 适配器。
需要 Bun；本入口不复制第三方实现到仓库，不改 Toonflow 的文件和模型配置，也不读取其他供应商的凭据。
直接 import 会执行本地代码，因此仅用于用户明确授权的适配器，不加载来源不明的文件。

## 配置与预检

```bash
bun <skill根>/scripts/toonflow_media.mjs configure <Toonflow的providers目录>
bun <skill根>/scripts/toonflow_media.mjs probe
```

当前支持 `flux3Klein.ts`（默认 `flux3-klein-t2i`）和 `comfyMinimaxH3.ts`（默认 `minimaxH3`），同适配器内其他模型可以在请求里指定。
首次配置前确认用户要复用这两项；本地 `settings.json` 保存 choice=existing、适配器路径、内容指纹、服务地址与校验状态，不保存密钥。
配置本身不代表启用；开工仍需重验。源文件变化会拒绝继续，先核对模型、参数与行为，再重新 configure。configure 会重置两项验证状态。

`probe` 仅 GET `/system_stats` 与 `/object_info`，核可达性与适配器使用的节点是否在场，不调用 `/prompt`、不产生成本、不上传素材。
节点检查成功仍记 unverified，因为不能证明模型文件存在、模型能运行或产物合格；明确失败记 unavailable。两者均保持 enabled=false。
历史的 Toonflow 测试仅作参考，不能当作这次连通与生成成功。
本入口用的是当前适配器硬编码地址，不支持仅在 settings.json 更改 endpoint；要换地址先由用户在源适配器修正并测试，再重新配置。

## 需要时做一次明确授权的生成验证

正常制作只在 ai-broll.md §0 通过后启用；首次连通性通过但仍 unverified 时，下面入口也可用于用户明确授权的单次端到端验证。
命令里的 `--allow-generation` 是防误触标志，不替代对话中的真实用户授权。不会自动运行验证生成，不自动重试。

准备本地 UTF-8 请求文件，例如：

```json
{"prompt":"A quiet modern office, soft daylight, cinematic wide shot, no text", "ratio":"16:9"}
```

```bash
bun <skill根>/scripts/toonflow_media.mjs generate image request.json <工程>/assets/generated/test-image.png --allow-generation
bun <skill根>/scripts/toonflow_media.mjs generate video request.json <工程>/assets/generated/test-video.mp4 --allow-generation
```

文件后缀应匹配适配器的实际产物；当前 FLUX 返回 PNG、MiniMax 视频 SaveVideo 需按工作流实际编码核验。
可透传已支持的 ratio/size/duration/resolution、model 与参考图等字段，不传供应商不支持的参数。
参考图可用适配器接受的 base64 MediaInput；此入口限制网络到配置服务地址，不下载其他站点参考图。

入口旁存 `.task.json`（远端任务编号）和 `.source.json`（参数与来源记录）；这些属于工程私有过程文件，不提交公共库。
原任务编号已记录或目标文件已存在时不得盲目重复调用；失败或取消后保留日志以便按编号查历史，远端任务可能仍继续。
入口不会调用全局 `/interrupt` 或 `/free`，不会清队列或历史。没有远端历史时也不自动重提任务。

### 资源调度：生图与生视频串行、生成等待无时限

同一 ComfyUI 服务地址共用用户本地 `resources/<地址摘要>.lock`，跨本 skill 的进程、项目和图片/视频类型互斥。
取得锁后先等服务已有的运行及待执行队列清空，再提交本任务。完成、下载并保存后释放；不同时提交多张或多个视频。
该锁不能约束 Toonflow 等其他客户端在检查后另行提交；使用同一显卡时请避免在其他应用同时发起生成，ComfyUI 自身队列仍负责服务端调度。

生成总等待和生成请求的传输等待不设超时，只因用户取消、远端明确失败或连接错误停止；每三秒查询同一个任务编号，慢不等于失败。
单独 `probe` 的只读诊断保留短连接超时，不用它中断正在运行的生成。CLI 工具返回“仍运行”只是交还控制权，不是任务超时或自动取消。
本入口截取 Toonflow 适配器即将提交的工作流，并在其限时等待开始前退出适配器；由本入口原样提交、无时限轮询和下载，
不修改模型参数、节点连接或 Toonflow 原文件，不受原图片四分钟/视频两小时等待上限影响。

提交前就锁定资源并落提交状态；响应丢失、收到任务编号后断网、进程被杀等无法确认远端结束的情况，保留锁和 `.task.json`，
停止后续生成而非盲目重提。先查任务历史/队列，确认终态并取回现有产物，再由 agent 核对该明确锁目录的 owner 与进程状态后解除锁。
不得仅因等得久、进程已死或队列暂空而自动清锁；没有任务编号时需查队列与历史判明是否实际提交过。

生成返回不自动将 enabled 置 true：需量尺寸、视频帧率/时长、确认可解码与内容质量，依据本片需求验收，
通过后由 agent 更新用户设置内对应 validation.status=available、记录方法/时间与媒体证据，再 enabled=true。
下次开工 probe 会重新关闭为待验证；可结合本次只读结果与同一源文件指纹下的已验收产物补充核验，不能只凭旧绿灯启用。

## 当前两套适配器的限制

- FLUX 3 Klein：当前本地实现有约 1280×720 的像素预算上限；大尺寸请求会缩小，不把参数里写 4K 当作真实 4K。
- MiniMax H3：当前本地实现为 0.4MP、16:9 / 1:1、24fps，目标五秒（实际约 5.17 秒），有生成音频；接入口播时默认静音，不替换原口播音轨。
- 输出像素不足以覆盖成片主体及运镜时，只能用作足够小的辅助窗或另行取得合格素材；不能为接上模型取消原有分辨率规则。
- 网络不可达时检查运行 ComfyUI 的电脑、服务与私有网络连接。能力保持关闭，真实素材 / 图库 / 动效卡制作照常进行。

上述限制来自用户当前本地适配器；源文件更新后以实际源码和产物为准，不是对这些模型的通用能力声明。
