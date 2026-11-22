# 由 tools-index.json 生成静态分页接口
#
#   api/page-0.json    前 50 条
#   api/page-50.json   第 51-100 条
#   api/meta.json      总数 / 每页条数 / 更新时间
#
# GitHub Pages 是纯静态，查询串（?offset=50）拿不到，所以用 page-<offset>.json。
# 以后接了真后端，客户端改成 /api/list?offset=N&limit=50 就行。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $root 'tools-index.json'
$apiDir = Join-Path $root 'api'

$idx = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pageSize = if ($idx.pageSize) { [int]$idx.pageSize } else { 50 }

# 列表只带必要字段：名字、版本、作者、是否开发者、体积、下载地址，简介压到一行
$items = @()
foreach ($it in $idx.items) {
  $size = 0
  $zip = Join-Path $root ("tools\" + $it.id + ".zip")
  if (Test-Path $zip) { $size = (Get-Item $zip).Length }
  $items += [ordered]@{
    id      = $it.id
    name    = $it.name
    version = $it.version
    author  = $it.author
    dev     = [bool]$it.dev
    size    = $size
    file    = if ($it.file) { $it.file } else { "tools/$($it.id).zip" }
    desc    = $it.desc
  }
}

New-Item -ItemType Directory -Force $apiDir | Out-Null
Get-ChildItem $apiDir -Filter 'page-*.json' | Remove-Item -Force

$total = $items.Count
for ($off = 0; $off -lt $total; $off += $pageSize) {
  $chunk = $items[$off..([Math]::Min($off + $pageSize, $total) - 1)]
  $payload = [ordered]@{
    offset = $off
    limit  = $pageSize
    total  = $total
    items  = $chunk
  }
  $json = $payload | ConvertTo-Json -Depth 5
  $path = Join-Path $apiDir ("page-$off.json")
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
  Write-Host ("  api/page-{0}.json  {1} 条" -f $off, $chunk.Count)
}

$meta = [ordered]@{ total = $total; page_size = $pageSize; updated = $idx.updated } |
        ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $apiDir 'meta.json'), $meta, (New-Object Text.UTF8Encoding($false)))
Write-Host ("api/meta.json  total={0} page={1}" -f $total, $pageSize) -ForegroundColor Green
