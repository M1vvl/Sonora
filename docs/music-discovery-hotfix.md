# 0.3.19：音乐发现入口与歌单隔离

本修复纳入0.3.19统一发布；用户随后明确要求全部完成后打包替换0.3.18。

## 实际问题

1. 原上方五卡直接取`state.playlists[index].coverURL`，因此与下方推荐重复，封面并不代表相应模式。
2. 点击只更新屏幕下方歌曲列表；列表多数位于折叠区之外，没有即时加载状态/视区定位，用户难以看到变化。`dashboard-drag.js`本身已把button视为交互，未发现它拦截这五个按钮。
3. 相似歌曲要求先播放才能获得seed；私人雷达没有精确来源时曾返回普通歌单；切换模式还会把专属歌单塞回下方推荐列表。

## 修复

- 顶部五卡的预览来自该模式第一首实际歌曲的封面，绝不取下方playlist cover。每日首曲可直接取home，其他模式后台按两个worker读取，返回后逐卡更新；独立preview任务避免模式间相互取消。匿名状态的私人入口显示需登录，不借用其他封面伪装。
- 点击即时选中/忙碌，成功后显示该模式真实歌曲并滚到歌曲列表；下方推荐歌单保持独立，不被模式返回的私人歌单覆盖。错误短时提示，列表不保留上一模式歌曲来冒充成功。
- 相似歌曲优先当前播放seed，没有播放时用每日首曲；非法seed仍拒绝。心动/漫游/雷达仍调用官方实际协议，私人雷达缺少精确专属来源时明确报错，不以普通歌单替代。
- 下方改用官方`/api/playlist/list`、hot次序候选，按实际playCount排序取18个；过滤每日推荐、私人雷达、私人漫游、心动模式、相似歌曲、我喜欢的音乐等模式专属名称及雷达ID、重复ID。上游失败时保留如实标记的有限精选，不伪造播放量。
- 已播放歌曲变化只使心动/相似预览失效，不重建整个页面或其他卡片。切页、账号变化、销毁通过visit和原服务取消机制隔离迟到结果。

## REA与来源

只读分析本地网易云公开`D:/Music/CloudMusic/cloudmusic.exe`，REA原生provider未配置（Ghidra/IDA等），因此未声称反编译出了客户端或云端推荐算法。原始结果`artifacts/music-discovery-hotfix-rea/cloudmusic-inspect.json`。

对MineRadio所带官方协议适配模块`top_playlist.js`、`recommend_resource.js`、`personal_fm.js`、`playmode_intelligence_list.js`、`simi_song.js`、`user_playlist.js`完成6文件静态REA及人工源码核对，source-map记录SHA256；结果`artifacts/music-discovery-hotfix-rea/`。没有读取其他播放器凭证或正式用户Cookie，没有下载音频或代写收藏。

## 验证

- 59项音乐发现/内容/界面单元通过，涵盖所有五卡独立第一首封面、点击结果定位、下方18歌单不被私人模式污染、真实高播放排序、模式过滤、预览并发不互相取消、无已播歌曲的相似模式。
- 真实匿名网络8项通过：18个独立高播放歌单、30首每日、5首相似歌曲，真实播放量排序；三种私人模式在未登录时正确要求登录。证据`artifacts/music-discovery-hotfix-live/report.json`，脚本`node scripts/check-music-discovery-hotfix.cjs`。
- 当前账号已登录不等于本次自动化验证使用了本人凭证；本人私人资源可用性仍取决于官方账号返回。QQ/AppleMusic等尚未接通，统一provider接口保留，不把网易云结果冒充其他平台。

## 隐藏窗口集成复核

- `node scripts/check-music.cjs --output artifacts/hotfix-music-ui`：92/92通过，渲染器错误为零。五个入口逐一以隔离的已登录fixture点击，验证立即忙碌状态、真实模式结果、滚到结果位置、对应模式第一首歌曲封面；下方18个独立歌单始终保持不变，也不含私人雷达。保留1260、960、1536三种宽度与登录、音质、音量、播放器既有验证，截图见输出目录。
- `node scripts/check-music-auth.cjs --output artifacts/hotfix-music-auth`：45/45通过。通过实际主进程/preload和匿名官方接口核查18个高播放歌单及排序，逐一点击每日推荐、相似歌曲，验证真实首曲、封面及下方歌单隔离；既有音频解码、歌词、历史、DPAPI及二维码验证保留。
- 本轮只修改以上两个检查脚本，不再次修改已冻结的运行源码。测试各自创建隔离配置，浏览器窗口始终隐藏；没有操控实际桌面鼠标，没有读取正式账号、Cookie或配置。私人模式完整点击路径来自fixture，不能将它表述为本人账号的在线验证。
