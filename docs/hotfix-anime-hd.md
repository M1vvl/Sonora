# 番剧高分横幅原始大图修复

问题原因：目录规范化此前只保留`images.common`，其优先级高于`images.large`。列表卡片适合400px缩略图，宽幅hero却也使用同一地址，导致400px封面放大到约900px横幅。

## 修改

- `src/anime/catalog.cjs`保留原`cover`作为列表小图，新增独立`coverLarge`，优先采用官方API的`images.large`原URL；缺少large时才回退已有字段。
- `ui/anime/index.js`保留/验证大图字段，只有番剧hero与下一张轮播预读使用`coverLarge`；热门列表、下四卡、分类网格继续使用`cover`。影视模块不受此变化影响。
- 沿用原受控图片协议、ECH策略、6MiB单响应边界，没有生成未知CDN变体或靠CSS锐化伪装分辨率。后续按用户存储要求将压缩字节LRU收紧为8MiB/32项，同时禁用HTTP缓存与磁盘缓存。图像通过原有`object-fit:cover`保持比例，裁切适应横幅，没有非等比拉伸。
- 新增的十个圆点与左右箭头保留，手动切换仍重置5秒。

## 三张真实图的比较

2026-10-30匿名公开目录经现有图片服务读取，两种URL均由官方元数据直接提供：

| 作品 | common自然尺寸/字节 | large自然尺寸/字节 |
| --- | --- | --- |
| 学生会也有洞！(554779) | 400×570 / 58,341 B | 1366×1948 / 441,923 B |
| 飙马野郎JOJO第二&第三赛段(639938) | 400×566 / 61,358 B | 1356×1920 / 481,605 B |
| 尼古喵喵(622206) | 400×560 / 43,302 B | 714×1000 / 115,721 B |

大图增多的是有效源像素，不是改变HTML宽高或过滤器。源本身只有714px宽时仍只有714px真实宽，不能称所有作品都拥有原生1920px横幅；当前优先保留来源提供的最佳现成图。横幅使用海报裁切，也没有虚构额外的横向背景图。

## 验证

- 27项目录、轮播、UI单元通过：模型分离、列表仍小图、hero独立大图、导航和生命周期。
- `node scripts/check-anime-featured.cjs --output artifacts/hotfix-anime-hd`：23项真实目录/Chromium检查全通过，零renderer错误。含三张common/large实际自然尺寸与字节、hero实际请求large且解码自然宽>400、十点/左右箭头、键盘、5秒/后台停止与正确详情等。
- 最终截图在所选大图真正解码并绘制后保存，避免把临时占位截图当作验收：`artifacts/hotfix-anime-hd/anime-featured-navigation.png`。数据报告同目录`featured-report.json`的`imageResolution`。
- 本修复纳入0.3.19统一打包；测试不读取正式账号或更改主题。

## 随机轮播的内存与网络复核（2026-10-31）

- 五秒仅切换已选作品，五分钟才刷新候选集合。热门目录的评分分布每天变化，最多按真实游标读取六页以补齐十个高分候选，停止条件仍为够十部/上游结束/取消；不伪造分数补位。
- 图片请求合并与8MiB/32项LRU只保存压缩字节，不写图片文件。上游使用无`persist:`前缀、`cache:false`会话，协议响应为`no-store`，不让浏览器再建立一份HTTP磁盘缓存。退出程序释放该缓存；重开需要重新联网，不把“下载传输”误称为“永久下载文件”。
- 下一张只预读一张，隐藏/离开主页/进入详情/停用时移除该Image地址与引用，前台恢复只重建下一张。当前显示图片仍需要解码内存；Chromium内部解码和GPU缓存由浏览器管理，因此8MiB不是整个软件或全部图像内存的上限。
- `artifacts/hotfix-anime-memory/featured-report.json`实际十张原始大图共3,942,632字节（约3.76MiB）；含三张普通对照图缓存共4,105,633字节。重复读取同十图新增网络请求为0。28项目录、真实Chromium和释放验证通过。
- 官方说明：[Electron临时session及cache选项](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)。
