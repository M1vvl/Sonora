# 音乐推荐播放与平台音质核对

## 已实现

- 点击每日推荐、私人雷达、私人漫游、心动模式、相似歌曲后，成功获取的第一首立即交给现有播放器，队列使用本次返回歌曲。推荐歌单采用同一路径。结果列表保留单曲点击。
- 用户直接选择歌曲、重新选择其他发现入口或离开页面后，较早的歌单请求失效，迟到的结果不能抢走播放。空歌单只显示短时提示。
- 网易云提供七个请求档位，分别使用 `sky`、`jymaster`、`jyeffect`、`hires`、`lossless`、`exhigh`、`standard`。菜单接收当前播放响应的 `source` 与 `qualityOptions`，来源不同则按其能力渲染。未知来源缺少能力时暂停音质选择。
- 当前音质标记采用服务端实际返回的 `level`，请求高档但平台返回较低档时显示实际档位。选择失败继续保持当前播放源和秒数。码率不能证明无损、空间音频或母带，界面不通过码率补造这些标记。

七项是请求选项，歌曲、账号和可用播放格式决定实际返回。当前软件的完整在线账号与主播放器链路仍为网易云。QQ 与 Apple Music 另有下文的官方网页登录入口。

## QQ 与 Apple Music 的本机和源码核查

本机 QQ 音乐位于 `D:/Music/QQMusic`，`QQMusic.exe`、`QQMusic_Login.dll` 和 `QQMusic_Protocol.dll` 标明版本 22.76，同时存在 `SMTCFeature.dll`。Apple 安装包为 `AppleInc.AppleMusicWin_1.1792.39682.0_x64__nzyj5cx40ttqa`，其清单注册 `App`、`AppleMusic.exe` 及媒体链接协议。以上核查读取安装目录与清单。

MineRadio 的 `desktop/main.js` 从 2633 行开始通过独立 Electron session 与官方网页窗口完成 QQ 登录，随后还核验播放授权。`server.js` 从 3165 行处理个人歌单，从 3624 行通过 `vkey.GetVkeyServer/CgiGetVkey` 获取账号权限内链接，并包含会话、文件格式、权益及链接探测处理。

本轮据此实现 `src/music/platform-login.cjs`。QQ 和 Apple 分别使用本软件自己的持久化 Chromium session 打开官方网页，并在音乐账号面板提供入口。QQ 提供 QQ、微信、QQ 音乐三种选择，跳转后点击官网对应的可见控件。页面水合后仅做一次有限重试。找不到控件或控件位于跨域 iframe 时，返回 `methodApplied:false`，界面提示在官方窗口选择扫码方式。跨域 QR 由官网呈现，软件没有伪造通用二维码。

官方窗口关闭后自己的网页会话仍保存。退出登录只清除此平台在本软件中的 session。公开状态仅含窗口状态、网页会话是否保存和 QQ 播放票据是否存在等布尔信息。匿名网页也会产生 cookie，因此会话已保存与账号已验证分别表达。主播放器目录和音源接口的 `apiConnected` 当前仍为 false，QQ 本人歌单与主播放器播放迁移尚未完成。

源码依据的 SHA-256

- `desktop/main.js` 为 `26F6C78FA3A005998D6C7F7B201032BEC7244388BE1E448585BC771A0EC8C446`
- `server.js` 为 `536D569470BF7A9782577F3BA910A1B87272862D8D7E43DEFA5B8466B81B9FD9`

Apple Music 的官方网页登录窗口已经接通。将订阅者曲库和歌曲接入本应用主播放器还需要 MusicKit developer token 与用户授权，当前项目缺少对应开发者配置。[Apple developer token](https://developer.apple.com/documentation/AppleMusicAPI/generating-developer-tokens)、[MusicKit JS 授权示例](https://js-cdn.music.apple.com/musickit/v1/index.html)

权限绕过项按用户提供的跳过方案处理。检索到的官方空间音频说明要求符合订阅与设备条件，不能承诺通过安装播放器自动取得额外播放权限。[网易云音乐与 Dolby 的体验说明](https://www.dolby.com/zh-cn/experience/163-music/)、[Apple Music Windows 订阅与音质说明](https://support.apple.com/en-gb/guide/music-windows/mus89c4e3d1a/windows)

## 代码验证

`node --test tests/music-platform-login.test.cjs tests/music-direct-play.test.cjs tests/music-playback-options.test.cjs tests/music-ui.test.cjs` 共 40 项通过，覆盖推荐直接播放、精确队列、迟到请求、离页、七档传递、服务端降档标记、跨来源菜单、音质失败保留当前播放、官方窗口与会话分区、QQ 三方式、真实叶节点点击与失败回执、退出作用域和入口调用。测试使用隔离页面、模拟媒体和模拟平台回复。官方网页实际登录由用户操作验证。
