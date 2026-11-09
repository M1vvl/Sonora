# Kazumi 搜索与翻页对照：0.3.9

核对日期：2026-10-29，北京时间。目标是用户提供的 Windows Kazumi 2.4.2 配套源码；该部分源码完整，因此使用源码检索和有界真实 API 请求核对，没有把普通源码阅读称为二进制反编译。

## 搜索为什么返回空

Agent Pulse 搜索框调用 `catalog({category:'搜索',query:'钢之炼金术士'})`。旧版 `catalog.cjs` 把除“主页”“热门”以外的所有分类文字都作为 Bangumi 标签发送。因此实际请求既要求关键词匹配，又要求标签等于“搜索”，与主页是否显示过该番剧无关。

实际对照请求记录在 `artifacts/kazumi-rea/v0.3.9/search-before.json`：

- 关键词“钢之炼金术士”且 `filter.tag:['搜索']`：HTTP 200，total 0，空列表。
- 同一关键词且 `filter.tag:[]`：HTTP 200，total 50；返回 id 1428“钢之炼金术师 FULLMETAL ALCHEMIST”和 id 315“钢之炼金术师”。两次请求都实际验证了 ECH。

对照源码：`lib/pages/search/search_controller.dart` 的 `searchBangumi` 使用搜索解析器产生的明确筛选标签；`lib/request/apis/bangumi_api.dart` 的 `buildBangumiSearchParams` 默认 tags 为空，`bangumiSearch` 请求完整 Bangumi 条目搜索接口。它没有把界面标签“搜索”混进筛选条件。

修复后普通关键词搜索独立于当前导航分类，始终使用空标签。分类浏览只接受本应用列出的真实分类。搜索范围是完整条目接口，未限制为主页缓存或热门候选集。中文别名“钢之炼金术士”由上游搜索匹配到正式标题“钢之炼金术师”，无需硬编码该作品。

## 为什么翻一段就停止

旧镜像目录响应只有 `data`，没有总数；旧界面把未知总数替换为已经显示的条目数量，随后 `displayCount < total` 为假，于是误判到达末尾。同时旧翻页位置使用去重后的显示条目数；动态热门榜相邻页存在重叠，会导致偏移推进不准确。

Kazumi 对照：

- `lib/pages/popular/popular_page.dart`：接近底部 200px 时请求下一批，且有加载锁。
- `lib/pages/popular/popular_controller.dart`：热门页使用 24 条批次与独立 `_trendOffset`，显示时去重。
- `lib/pages/search/search_page.dart`：剩余滚动距离不超过 360px 时继续请求。
- `lib/pages/search/search_controller.dart`：搜索每页 20 条；游标按 `page.rawCount` 前进，显示去重不改变游标。

修复后的后端统一返回：

```text
items       当前页可展示条目
total       上游声明的总数；未声明时为 null，已知零保留为 0
offset      本次请求的原始偏移
rawCount    上游该页原始条目数，包含后来被跳过/去重的条目
nextOffset  offset + rawCount
limit       上游实际分页大小，缺省才使用请求大小
hasMore     是否可以继续请求
```

已知总数时按游标和总数判断；未知总数时满页允许继续，空页/不足一页才结束。错误请求不前进游标，可在同一位置重试。不会为了“无限”效果循环重复已加载条目，也不承诺上游有限目录永远有下一页。

官方条目接口实测即使请求 24 也可能返回 `limit:20`，因此搜索改为与 Kazumi 相同的 20；解析仍尊重上游声明的分页大小。

## 生命周期与回归

清空目录缓存会递增请求代次，旧请求完成后不能重新填入缓存；旧请求的清理也不能删除同键的新请求。导航取消使用 `cancelPending()` 只分离旧的在途请求，保留成功页缓存，避免返回主页时复用刚被取消的 Promise。有效页缓存仍保持最多 64 项、五分钟 TTL。没有新增后台轮询或一次性抓取全站。

验证：

- 6 项新增目录语义单元检查，连同 13 项既有番剧核心检查，共 19 项通过。
- `artifacts/kazumi-rea/v0.3.9/catalog-after.json`：热门和日常各连续三个真实页面（0、24、48），均返回有效后续条目；“钢之炼金术士”第一页与第二页（0、20）成功，游标继续到 40。
- `catalog-before.json` 记录旧镜像的目录结构及动态榜单重叠，不将网络偶发错误视为正常目录结束。一次 ECH 连接超时后，重新执行有界请求成功；不据此声称网络永远稳定。
