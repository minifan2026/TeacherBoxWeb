// TeacherBox 工具市场 —— 静态分页
//
// 端点：api/page-<offset>.json     offset = 0, 50, 100 …
// 一页 50 条，只带列表要用的字段；说明、图标之类点开卡片再取。
// 以后有真后端了，把这个函数换成 /api/list?offset=N&limit=50 即可，其余不用动。

var PAGE = 50;

var state = {
  offset: 0,       // 下一次要取的 offset
  total: 0,
  items: [],       // 已经取到的（含缓存的 50 条一页）
  pages: {},       // offset -> 已取过的页，避免重复请求
  keyword: "",
  busy: false
};

var elList = document.getElementById("list");
var elMore = document.getElementById("more");
var elStat = document.getElementById("stat");
var elEmpty = document.getElementById("empty");
var elErr = document.getElementById("err");
var elQ = document.getElementById("q");

function pageUrl(offset) {
  return "api/page-" + offset + ".json";
}

function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function matches(it) {
  if (!state.keyword) return true;
  var k = state.keyword.toLowerCase();
  return (it.name || "").toLowerCase().indexOf(k) >= 0 ||
         (it.author || "").toLowerCase().indexOf(k) >= 0 ||
         (it.id || "").toLowerCase().indexOf(k) >= 0;
}

function render() {
  var rows = state.items.filter(matches);
  elList.innerHTML = "";
  rows.forEach(function (it) {
    var li = document.createElement("li");
    li.className = "row";

    var name = document.createElement("span");
    name.className = "name";
    name.textContent = it.name || it.id;

    li.appendChild(name);

    if (it.dev) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "开发者";
      li.appendChild(chip);
    }

    var ver = document.createElement("span");
    ver.className = "ver";
    ver.textContent = "v" + (it.version || "1.0");
    li.appendChild(ver);

    var desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = it.desc || "";
    li.appendChild(desc);

    var author = document.createElement("span");
    author.className = "author";
    author.textContent = it.author ? "@" + it.author : "";
    li.appendChild(author);

    var size = document.createElement("span");
    size.className = "size";
    size.textContent = fmtSize(it.size);
    li.appendChild(size);

    var dl = document.createElement("a");
    dl.className = "dl";
    dl.href = it.file || ("tools/" + it.id + ".zip");
    dl.textContent = "下载";
    li.appendChild(dl);

    elList.appendChild(li);
  });

  elEmpty.classList.toggle("hidden", rows.length > 0 || state.busy);
  elStat.textContent = state.total
    ? "已显示 " + rows.length + " / 共 " + state.total + " 个"
    : "";

  var canMore = state.offset < state.total;
  elMore.classList.toggle("hidden", !canMore);
}

function showError(msg) {
  elErr.textContent = msg;
  elErr.classList.remove("hidden");
}

function loadPage() {
  if (state.busy) return;
  var offset = state.offset;

  if (state.pages[offset]) {          // 这一页取过了，直接用缓存
    state.offset = offset + state.pages[offset].length;
    render();
    return;
  }

  state.busy = true;
  elMore.textContent = "拉取中…";
  fetch(pageUrl(offset), { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      var items = data.items || [];
      state.pages[offset] = items;
      state.total = data.total || (state.items.length + items.length);
      items.forEach(function (it) { state.items.push(it); });
      state.offset = offset + items.length;
      elErr.classList.add("hidden");
    })
    .catch(function (e) {
      showError("清单拉不动：" + e.message);
    })
    .then(function () {
      state.busy = false;
      elMore.textContent = "加载更多";
      render();
    });
}

elMore.addEventListener("click", loadPage);

elQ.addEventListener("input", function () {
  state.keyword = elQ.value.trim();
  render();
});

loadPage();   // 首屏永远是第 0 页，50 条
