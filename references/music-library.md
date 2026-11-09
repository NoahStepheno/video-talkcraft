# 口播配乐候选库与使用模板

本页管理开场音乐、正文背景音乐、章节过渡与收尾音乐（BGM），不属于 sfx-map.js 的点击、划线、whoosh 短音效。
默认先选现成授权曲库，不默认用 Suno 生成。音乐是否适合某段须与实际口播混听，不能只看曲名或标签。

## 1. 来源与授权（2026-11-09 核对；未能读取的条款明确标待核）

| 来源 | 用途 | 授权与接入注意 |
|---|---|---|
| Mixkit Music | 免费候选首选，先筛开场与轻正文配乐 | 官方说明可用于商业/非商业网络视频、社媒、播客、网络广告；无需强制署名。不能由此推定允许原曲二次分发、嵌进公开素材库或音乐混音作品 |
| Artlist | 已有订阅时补充，按情绪与配器筛选 | 待核：官方帮助页本次返回 403，不能据此确认具体计划范围。选用前在账号内核个人/客户项目、商业用途、取消订阅后的新项目与原文件分发限制 |
| Epidemic Sound | 已有订阅时补充，适合按栏目组织候选 | 按 Creator / Pro 等实际计划核渠道、客户工作与发布时间；不要为本次选曲自动订阅或购买 |
| Pixabay Music | 备选曲源 | 待核：官方 FAQ 本次返回 403。选用前核曲目授权及 Content ID 状态，保留曲目页与下载授权记录，不能承诺不会被识别或索赔 |

官网记录（正式选用时再核曲目当日条款）：
- Mixkit 曲库：https://mixkit.co/free-stock-music/
- Mixkit 音乐授权：https://mixkit.co/license/modal/musicFree/
- Mixkit 使用条款：https://mixkit.co/terms/
- Artlist 计划：https://help.artlist.io/hc/en-us/articles/29559573229725-Artlist-s-Music-and-SFX-plans-explained
- Artlist 授权：https://help.artlist.io/hc/en-us/articles/29490991524253-Understanding-Artlist-s-license/
- Epidemic Sound 计划：https://www.epidemicsound.com/pricing/
- Pixabay FAQ：https://pixabay.com/service/faq/

本仓库只存候选索引和使用方法；第三方音乐原文件按正式下载与授权流程保存在使用者本地，不提交公开仓库，也不转存 base64。
模板复用的是使用方法与选曲记录；每次新片仍核授权范围，不能把“旧片可继续发布”理解成“取消订阅后可继续做新片”。

## 2. 首批曲目候选（已核名称、作者、时长与标签；未试听、未下载、未定版）

下面的用途是基于官网标签的初筛建议，不是听感结论。网页是分类页，可按曲名定位并试听；不猜测下载直链。

| 候选 id | 曲名 / 作者 | 全长 | 官网标签摘要 | 建议试用位置 | 来源页 |
|---|---|---|---|---|---|
| music-intro-light | Raising Me Higher / Ahjay Stelino | 1:38 | Relaxed、Lighthearted、Intro、Bass、Drums | 轻快开场，试听后选短段衔接正文 | https://mixkit.co/free-stock-music/corporate-music/ |
| music-body-tech | Close Up / Michael Ramir C. | 1:35 | Rhythmic Underscore、Futuristic、Technology、Bass、Drums | 科技/产品类正文，重点检查鼓点是否抢字 | https://mixkit.co/free-stock-music/corporate-music/ |
| music-body-atmosphere | Relax Beat / Arulo | 1:48 | Atmospheric、Meditative、Synth | 概念解释/平稳正文，检查是否太松散 | https://mixkit.co/free-stock-music/ambient/ |
| music-reflective | Forest Mist Whispers / Alejandro Magaña (A. M.) | 2:31 | Hopeful、Piano、Synth、Documentary | 故事、思考段或收尾，检查旋律是否分散注意 | https://mixkit.co/free-stock-music/ambient/ |
| music-intro-mystery | Valley Sunset / Alejandro Magaña (A. M.) | 2:14 | Mysterious、Atmospheric、Synth、Intro | 问题式开场/悬念段，不能默认铺全片 | https://mixkit.co/free-stock-music/ambient/ |

初筛时优先无歌词、旋律克制、动态稳定、可剪辑的段落；避免因标签是 Ambient 就假定没有人声或没有突兀起伏。
先听结构，再拿同一段口播对比候选；用户确认之前只标候选。章节短过渡可从已选同曲的自然乐句选段，不要求每章换曲。

## 3. 四种使用模板（数值是试听起点，不是统一交付标准）

| 模板 | 适用位置 | 起始编排建议 |
|---|---|---|
| 轻快开场 | 科技/观点/产品口播 | 截取约 3–6 秒有辨识度的段落；首句照常开始，不强加无人声片头；开口后自动压低音乐 |
| 平稳正文 | 解释、教程、信息密集段 | 低存在感铺底；按语义段铺设，可保留干声区；长段只在自然乐句处剪接或循环 |
| 悬念/思考 | 提问、转折、故事段 | 局部进入，不整片制造紧张；关键论断或数字可降到接近静音，避免旋律替口播抢重音 |
| 收尾 | 总结、结束画面 | 最后一句后音乐适度抬起并自然收束；约 2–4 秒可作为试排起点，实际按尾句与画面决定 |

一片优先一首主配乐，必要时一首补充，不按镜头机械换歌。音乐响度包络用秒/词锚控制开场、压低、抬升与淡出；
不能将整首统一归一后固定一个音量就认为混好了。先按正文音乐比口播低约 18–24 dB 的相对响度试混，再按实际语音密度、音乐频谱和终端试听调整，
它不是 `<Audio volume>` 的固定数值，更不是所有片子的硬门槛。SFX 电平规则不能直接套给 BGM。

## 4. 制作时落地

1. 在 SHOTBOOK G0 写配乐方案：曲目/候选、情绪、使用段、干声段、音乐入出点、需要压低人声下的区间。
2. 正式选用时通过官网或已有授权账号获取文件；记录作者、曲名、来源、下载时间、许可证明与本地路径。预览水印版不进入成片。
3. 本地音乐放 `remotion/public/music/`（或项目约定的忽略目录），在工程 sources.md 记账；原文件不进公开库。没有合适且可用的曲子时可保留干声，不强行生成或铺曲。
4. 给用户听“口播 + 音乐”的实际混音样段，再确认模板；独立音乐试听不能替代混音试听。记录实际选段 in/out 和压低/淡入淡出参数，不预先编造最佳秒数。
5. 配乐作为单独 BGM 轨合成，不混入人物源文件，不写进逐卡 SFX 表；沿用视频分段、全片音轨一次混入的渲染纪律。
6. 输出单独的 BGM 参考轨，结合无音乐的配音基线检查代表性段落；SFX 的 solo/mix 检查不能证明 BGM 合适。最终响度处理后重新检查抢话、突兀切口、循环接缝与尾音截断。

配乐来源与方案随④-1分镜审核提交；⑤-1样板镜包含实际配乐混音供确认。更换主配乐造成整体气质变化时重新确认受影响方案。
