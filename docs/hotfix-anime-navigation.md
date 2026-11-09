# 番剧横幅导航热修复

本次遵从用户最新要求，修改当前0.3.18，不生成便携压缩包或新增历史版本；部署由主代理统一执行。

## 已实现

- 宽幅高分轮播画面的底部水平正中加入与真实候选一一对应的导航点，正常十个候选即十个点，当前项高亮并带标题提示。
- 左/右侧箭头在画面垂直中线对称定位，距边12px，40×44px点击区域；两侧SVG镜像、固定stroke及圆角。
- 圆点与箭头是hero详情按钮的兄弟节点，不嵌套按钮；点击只切换当前推荐，不触发详情。
- 手动跳转、上一部、下一部均重置完整5秒停留；保持单一计时器，原5分钟更新集合与隐藏/离页释放规则继续生效。
- 点支持Tab、Enter/Space及左右/Home/End键，键盘切换保持焦点与aria-current同步。原下四张卡片节点、历史和主题不受影响。
- 控件只使用小面积半透明背景、边框和SVG；没有新图片、额外渲染器或持续动画循环。遵循Apple Design的触点反馈、对称锚点和减少动态效果原则。

## 模块与集成

`ui/anime/featured-rotation.js`新增goTo/next/previous方法及回调中的当前索引/完整候选信息；`ui/anime/index.js`负责现有hero内的独立控件与事件；`ui/anime/featured-rotation.css`集中导航几何/外观。dashboard.html需在anime.css后引入新CSS，由主代理集成。

## 验证

- `node --test tests/anime-featured-rotation.test.cjs tests/anime-ui.test.cjs`：17项通过，含手动跳转、环绕、重置5秒、单一timer、键盘焦点与不误开详情。
- `node scripts/check-anime-featured.cjs --output artifacts/hotfix-anime-navigation`：19项实际目录/Chromium检查通过。真实十部评分≥7.5，1260/960宽度下圆点水平居中、两箭头垂直居中与边距对称、点与箭头跳转、键盘End、五秒自动切换、后台停止与正确详情等均通过；renderer错误零。
- 证据：`artifacts/hotfix-anime-navigation/featured-report.json`、`anime-featured-navigation.png`。独立profile、匿名公开目录，没有读取或修改正式账号、主题或个人历史。
