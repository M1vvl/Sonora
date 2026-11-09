# 音乐纯网络播放与存储复核（0.3.18）

用户要求歌曲临时网络读取，不把歌曲下载/缓存到磁盘，删除已存在的测试音频存储。本模块维持单一当前歌曲网络流式转发，不做整曲Buffer/Blob、下载器、音频文件或离线曲库。

## 实际处理

- `music-stream.cjs`音频请求明确使用`cache: no-store`和`Cache-Control: no-store`、`Pragma: no-cache`；返回给renderer同样为`no-store, max-age=0`，不转发上游可缓存策略。Range与有界重定向沿用，退出/换曲取消活跃读取，背压逐块转发。
- `music-bridge.cjs`网络session固定为没有`persist:`前缀的内存session，并在首次创建时设置`cache:false`，防止即使上游允许缓存也复用HTTP歌曲字节。图片仍使用独立有界的内存图片缓存；登录凭证保留原Windows加密存储，不与歌曲音频混淆。
- 所有真正实时播放都需要网络、解码器和声卡间的临时RAM缓冲，不能承诺“任何歌曲字节不进入内存”；不保存整首可重播音频和离线曲库是可执行的边界。OS换页/驱动内部细节不由应用保证。
- 用户断网时renderer必须停止并移除当前src释放媒体缓冲；再次播放重新请求网络。具体UI离线事件与测试由`ui/music/player.js`实现，浏览器离线状态依赖系统网络通知，不能把短暂上游断流等同于系统离线。

## 旧测试数据审计与清理

`node scripts/audit-music-storage.cjs --apply`先写`artifacts/v0.3.18-music-storage/before-cleanup.json`再按已确认候选清理；最终`storage-audit.json`记录结果。范围仅本项目`artifacts`与正式`%APPDATA%/Agent Pulse`，不会扫描/删除网易云、MineRadio或其他播放器文件。

本次结果：音乐测试路径音频扩展文件0个；检查49个HTTP/Media Cache文件、读取约6.7MiB受限条目数据，未找到本软件音频scheme与音频类型相符的歌曲缓存，因此删除0个。旧测试的WAV信号由`check-music.cjs`在临时内存构造，脚本没有保存WAV文件；官方匿名测试音频只读取并解码而未另存音频文件。

账号、登录状态、听歌统计、封面、源码、REA证据、原生测试视频保留。混合Chromium缓存不按文件夹整体删除，避免误删不属于歌曲音频的数据。此结果是已识别的本应用音频存储审计，不能把不存在候选写成已删除歌曲。

## 验证

- 音频流/桥11项单元检查通过：官方HTTPS/可信重定向、Range、禁止账号cookie、请求和响应no-store、逐块背压、换曲取消、缓存session首次配置。
- `scripts/check-music-network-storage.cjs`实际Electron7项检查通过：仅本地回环合成4字节音频响应，即使上游声明可缓存，每次仍访问网络；session存储路径为null、HTTP缓存为0、无持久Partitions目录、无窗口。报告`artifacts/v0.3.18-network-storage/network-storage-report.json`。
- 脚本支持`--root`和`--output`，可对最终ASAR重复验证，所有profile都在独立产物目录。

实现依据：[Electron session.fromPartition官方说明](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)：没有`persist:`前缀是内存会话，`cache:false`控制HTTP缓存且必须在session首次创建时设置。

最终0.3.18 ASAR成品再次通过7项实际session检查；播放器断网与迟到响应回归均通过，正式替换已完成。证据`artifacts/v0.3.18-packaged/music-network-storage/network-storage-report.json`。
