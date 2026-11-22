# TeacherBoxWeb

TeacherBox 工具市场的静态站，跑在 GitHub Pages 上（纯静态，没有后端）。

## 结构

```
index.html              市场主界面：列表 + 搜索 + 加载更多
assets/style.css|app.js 页面样式与分页逻辑
tools-index.json        唯一真相：工具清单（id / 名字 / 版本 / 作者 / 是否开发者 / 简介）
tools/<id>.zip          工具包本体，一个工具一个 zip，几十 KB
api/page-<offset>.json  由 tools-index.json 生成的分页清单（一页 50 条）
api/meta.json           总数 / 每页条数 / 更新时间
scripts/build-api.ps1   生成 api/ 下的分页文件
```

## 加一个工具

1. 把工具包放进 `tools/<id>.zip`（`<id>` 只能 `A-Za-z0-9._-+`）
2. 在 `tools-index.json` 里加一条：

```json
{ "id": "x", "name": "显示名", "version": "1.0", "author": "你的 GitHub 名",
  "dev": true, "desc": "一句话", "file": "tools/x.zip" }
```

3. 跑 `pwsh -File scripts\build-api.ps1`，提交 `api/page-*.json` 与 `tools/x.zip`
4. `dev: true` 才会在列表里挂「开发者」角标

## 分页

列表一页 50 条，页面只渲染名称 / 版本 / 作者 / 体积 / 体积，取过的页缓存在内存里不重复请求，点「加载更多」才取下一页。

GitHub Pages 是纯静态，URL 里的查询串（`?offset=50`）服务端拿不到，所以落成 `api/page-<offset>.json`（0、50、100…）。
以后有真后端，客户端改成 `GET /api/list?offset=<n>&limit=50` 即可，页面不用动。

## 本地预览

```
pwsh -File scripts\build-api.ps1
# 直接开 index.html 会因为 fetch 被 file:// 拦掉，用任意静态服务器：
python -m http.server 8080
```
