# 0.3.25 网易云取流与音质核对

## 原因与改动

原播放器只请求一次`hires`，该档位无完整音源时立即结束。MineRadio的`server.js`会在单次预算内逐档回退，再尝试旧版URL接口和严格匹配的站内条目。本轮将这一有界流程迁入独立`netease-playback.cjs`，取流阶段预算12秒，最多10个元数据请求，基础曲目详情另受客户端单次超时约束。高档位失败时尝试无损、极高、标准与旧版授权接口，返回实际交付档位。

原界面将`hires`标为高清臻音、`jyeffect`标为臻音全景声。当前上游模块分别使用`jyeffect`表示高清臻音、`vivid`表示臻音全景声。七档可选值改为`sky / jymaster / vivid / jyeffect / lossless / exhigh / standard`，旧`hires`用户偏好读取时迁移到`jyeffect`。服务器真实返回`hires`时仍独立显示为Hi-Res。vivid遵循上游Android客户端字段和MP3编码映射，sky带`immerseType=c51`。

取流继续拒绝试听、明确拒绝码、错误歌曲ID和非网易云地址。旧接口缺少单曲code字段但外层成功、ID吻合且URL有效时可以使用，明确403等拒绝码仍拒绝。标准元数据仅用于寻找同名、完整艺人集合相同、时长差小于两秒的最多两个备选。备选同样须返回完整授权音源，原始歌曲历史ID保留，返回`matchedFromId/resolvedSongId/matchKind`供核对。

## 来源

本机MineRadio 2.2.0公开安装资源`server.js`中的`resolveNeteaseDirectSongUrl`与`resolveNeteaseSameTrackPlayback`，及随包NeteaseCloudMusicApi 4.32.0两个MIT模块。

- `song_url.js` SHA-256 `2fe652fccf3d69c1faec41ea8b0a68377eacaa2bfff33f97d77264f2a1c25269`
- `song_url_v1.js` SHA-256 `54a3d8cb82297e3a8a3361e70c430c5b9c3b278b641535786fb74a173fe25334`

现代档位与vivid映射参考维护者上游实现。只适配官方授权请求分支。[song_url_v1.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/master/module/song_url_v1.js) [song_url.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/master/module/song_url.js)

## 验证

57项取流、七档映射、旧偏好迁移、精确备选、取消、预算、认证、直接播放和实际返回标签专项测试全部通过，日志`artifacts/v025-netease-tests.log`。

匿名真实网络探测查找“Canon in D”的两个免费条目1067598和37720645，都收到完整授权URL、exhigh、320000bps、无试听标记。随后通过完整PlayerService对1067598请求jyeffect，实际交付exhigh，接口如实返回降档及“极高HQ”。没有下载音频字节，报告`artifacts/v025-netease-public-probe.json`。

经允许尝试只读本应用加密账号验证。独立Electron profile在safeStorage解密阶段失败，没有向网易云发账号请求，也没有修改正式数据或读取其他播放器凭据。因此真实账号的高清臻音、会员权限和用户提及的具体不可播歌曲尚未取得样本，不将其标为实际验收通过。该限制报告在`artifacts/v025-netease-readonly-result.json`。
