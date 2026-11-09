# MineRadio 账号与胶囊定向分析

## 来源与范围

分析用户指定 `D:/Music/Mineradio/resources/app` 的 MineRadio 2.1.0 发布文件。只读程序源码、公开依赖和许可证，不访问该软件用户目录、账号、Cookie、缓存或日志。REA 静态分析不执行应用脚本，公开源文件的 SHA-256 位于 `artifacts/mineradio-login-rea/source-map.json`。

`login-analysis` 是选择登录流程、服务端入口和 NodeAPI 二维码/加密模块生成的证据；`rea-summary.json` 记录选定范围的覆盖和限制，不能把静态图当作所有动态行为的完整证明。`capsule-analysis` / `capsule-summary.json` 单独分析账号胶囊偏好和指针唤出文件。

## 迁移映射

| 原实现 | Agent Pulse 适配 |
| --- | --- |
| `08-account/03-login-modal-flows.js` 平台选择、端口中心测量、SVG Bézier 连线 | `ui/music/account.js`，根据实际 DOM 端口中心计算，不写死不同窗口下的端点位置 |
| server.js QR key/create/check/status | `src/music/index.cjs` + `netease.cjs`，直连官方接口，二维码本地生成，不搭建 Express/API 服务 |
| NodeAPI login QR 与 weapi/eapi 公共协议 | 只适配所需公开协议与请求模板，保留 MIT 归属；不复制匿名 token 文件或反作弊凭据 |
| `00-state/02-preferences-ui-modes.js` 胶囊布尔偏好、右上角指针唤出 | 独立音乐偏好原子保存；保留键盘可访问入口、焦点与浮层打开时保持可见 |
| index.css 3733 附近 `right`/opacity/visibility 动画 | 用 transform/opacity 收起胶囊，避免频繁改布局；减少动态效果时即时完成 |

二维码生命周期：800 过期、801 等待扫码、802 已扫码待确认、803 手机确认。只有取得有效凭证并再次核实公开账号资料后才确认成功。QR 最长三分钟，关闭浮层、切页和退出会取消；异步保存中的取消要等待回滚，避免迟到登录落盘。

凭证由 Electron safeStorage 在当前 Windows 用户下加密，文件只含版本与密文；不可用时只允许内存会话并报告无法持久保存。网络 session 不持久化且 credentials=omit，避免 Chromium 维护第二份登录 Cookie。IPC 只传公开资料和不透明扫码 requestId。

## 材质、布局与性能依据

登录使用原生 dialog 顶层。单个 `::backdrop` 模糊整个一级界面（包括导航），浮层自身保留清晰文字与透明材质；不在全部内容子节点叠加动画 blur。登录入口及浮层沿用实际保存的主题变量。

页面只保留封面卡及三个区域：推荐歌单、推荐歌曲、最近播放。此布局参考音乐软件将探索与最近播放分开的组织方式，而非复制整套应用。[Apple Music 推荐与最近播放](https://support.apple.com/en-asia/guide/iphone/iph2b1748696/ios)。

玻璃只用于控制层与浮层，保持文字层级与可读性，参考 [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)。GPU 使用一个受限卡片画布，静止停止帧调度、隐藏释放，参考 [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。封面作为环境纹理，不调用摄像头/桌面采集；与用户图片中的 `getUserMedia` 示例相区分。

## 验证限制

匿名接口实测只证明官方 QR 创建、等待状态与接口连通，证据不含 key/有效二维码。真实账号扫码须由用户本人完成。803、加密回读、取消竞态、退出等路径使用隔离凭证夹具验证；不把夹具验证称为本人账号登录完成。推荐/播放仍受网易云账号、地区、会员及版权限制。
