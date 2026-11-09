# 账号歌单与收藏到歌单：MineRadio 定向分析与适配

本轮在0.3.19中交付，最终打包由主流程统一执行。本文件只记录音乐后端和来源；抽屉、队列与播放模式由独立前端模块处理。

## 实际查阅范围

只读查看`D:/Music/Mineradio/resources/app`公开程序资源，没有读取MineRadio账号、Cookie、浏览历史或个人配置，也没有启动其服务。

使用本机缓存的REA 6.8.0对`NeteaseCloudMusicApi/module`下四个精确文件执行`analyze-javascript-application`：`user_playlist.js`、`playlist_tracks.js`、`playlist_track_all.js`、`playlist_detail.js`。退出码0，四文件解析无失败。父证据ID：`ev_fcdb2b2aa5395eab0a15b72f43ca1f0be614db1536a7c793db59fd4cf7330638`；完整静态证据在`artifacts/music-library-rea/evidence`，摘要在`summary.json`。REA只静态解析指定文件，不能当作运行时抓包或全部应用分析。

另人工查阅`public/js/modules/06-lyrics/01-playlist-panel-shell.js`和`02-playlist-detail.js`：其歌单列表按offset/limit分页，明细从完整trackIds抽取当前窗口，再查询歌曲详情；取消时通过token/AbortController拒绝迟到结果。这些文件及四个协议模块的SHA256记录在`artifacts/music-library-rea/source-map.json`。

## 迁移后的边界

- `src/music/library.cjs`负责登录账号歌单元数据、所有权与显式添加操作；复用目录的取消/账号代次和原网易云传输，不启动额外HTTP服务，不引入MineRadio运行时。
- `userPlaylists`每次最多30条，保留真实来源游标；最多缓存8页、60秒，账号变化清空。列表公开字段只有名称、封面、歌曲数、作者与owned，不把Cookie传给界面。
- 现有`playlist`增加offset/limit，默认仍30首，沿完整trackIds保留顺序，最多补齐当前30个详情。51首的歌单可以先30再21，未后台下载整库或歌曲音频。`total`、`nextOffset`、`hasMore`表示真实分页；来源未返回完整ID时明确报错，不能将截断结果伪称全集。
- `playlistAdd`仅在用户选择目标后调用。每次先从官方详情重新核实creator与当前登录用户一致，再发单首`/api/playlist/manipulate/tracks`的add；重复点击共用同一任务，最多8个在途操作，不自动重复写入。关注他人的歌单不能添加。
- MineRadio原模块对某些512响应会重复trackIds再次写入。本次不迁移该不透明重试，以免重复操作；添加失败如实提示，不能凭本地乐观状态声称已收藏。
- 账号、服务、bridge各只增加固定动作；请求仍共用原2个内容/1个认证并发与超时。离页、退出、账号改变继续取消在途任务；不新增轮询。
- 沉浸页的`visualSettings`固定动作仅组装独立视觉偏好模块，与账号歌单、歌曲缓存、监控主题相互独立；视觉模块本身由对应实现记录验证。

## 验证与限制

`node --test tests/music-library.test.cjs tests/music-content.test.cjs tests/music-discovery.test.cjs tests/music-bridge.test.cjs`：47/47通过。新增六项覆盖匿名拒绝/登录所有权、重复ID与缓存、51首两页且顺序不乱、一次写入与双击合并、他人歌单拒绝/上游失败不重试、离页取消，以及原官方端点路径。

测试只使用合成Cookie和模拟服务，没有调用本人账号的添加接口或写入真实歌单。协议路径与权限判断已验证，但正式账号的在线歌单写入仍取决于网易云返回；不能将模拟成功表述为已修改用户歌单。未接通的QQ、Apple Music等平台保留不可用状态，不拿网易云歌单冒充其他平台。
