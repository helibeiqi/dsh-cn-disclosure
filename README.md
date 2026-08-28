# dsh-cn-disclosure

> 零依赖 · 本地优先的 **A股 公告 / 年报 结构化抽取** MCP server。
> 把一段披露文本（公告正文 / 年报片段 / 复制的文本）抽取成**事件研究可用的结构化字段**：披露类型、日期、金额、比例、股数、方向。无需 API key、无需联网。

---

## 为什么做这个（定位与竞争现实）

- **公告「抓取 + 摘要」已是红海**：GitHub 上已有 `mcp-a-stock-announcements`、`Ashare-announcements-MCP`、`CNEquity`、`yiyan-mcp-server` 等多个做"A股 公告获取+摘要"的 MCP。本插件**不与之正面竞争**（不抓取、不调外部 API）。
- **本地「结构化抽取」= 开放细分（经复核）**：不限 topic 的全 GitHub 检索中，`财报 结构化 MCP` / `年报 PDF 解析 MCP` / `annual report extraction MCP` / `巨潮 公告 MCP` **全部 = 0**；`公告 结构化抽取` 仅 2 个且很窄（一个只做"股份回购事件"、一个是电缆招标系统），均非通用 A股 披露抽取器。因此本插件切入 **"本地优先的 A股 披露结构化抽取"** 这个真正开放的子方向。
- **差异化**：① 本地优先 / 零依赖 / 无 API key（文档与 PII 不出机）；② **格式容忍**——对自由文本做正则扫描，不假设任何公司/版式固定结构（回应"A股 各公司披露格式不一"的现实）；③ 输出面向**事件研究**（类型/方向/日期/量级，可直接喂事件研究流水线）。

## 数据规模（v0.1.0 种子）

| 维度 | 数量 |
|------|------|
| 披露事件类型 | 17（业绩预告/快报、业绩变脸、分红、回购、增/减持、解禁、重组、并购、定增、担保、诉讼、中标、重大合同、停牌复牌、股权激励、高管变动…） |
| 字段抽取规则 | 9（日期 / 金额(亿·万) / 百分比 / 同比 / 每股收益 / 每股分红 / 股数(亿·万)…） |

规则集中在 `data/disclosure-rules.json`，**可扩展**：增删 `event_types` / `field_patterns` 即可覆盖更多披露场景，无需改代码。

---

## 工具清单（5 个）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `extract_disclosure` | **主工具**：对披露文本做全量结构化（分类 + 字段 + 事件） | `text` |
| `classify_disclosure` | 仅做披露类型分类（命中类型 + 方向 + 匹配词） | `text` |
| `extract_events` | 抽取事件研究可用事件列表 | `text` |
| `extract_from_file` | 读本地文件（.txt/.md/.html，html 自动去标签）后抽取 | `path` |
| `disclosure_stats` | 规则集规模概览 | — |

所有工具返回 **UTF-8 JSON 文本**，便于 agent 二次推理或直接呈现。

### 调用示例（dsh 对话）

- "这份减持公告计划减多少股、占比多少、什么时候？"
  → `extract_disclosure({text: "…拟减持不超过1200万股（占总股本3.5%）…"})` → `events[decrease]` 给 `shares=12,000,000 股, pct=3.5%, date`
- "把这段年报摘要里的业绩和分红抽出来"
  → `extract_disclosure` → `events[earnings_pre]`（营收/净利/同比）+ `events[dividend]`（每10股派5元）

---

## 安装 / 接入 dsh

本仓库是一个 **dsh bundle**。`cordis.patch.yml` 合并进你的 dsh profile 即注册为一个 mcp server。

关键路径（部署时改成你本机实际路径）：

```yaml
- insert:
    - path: plugins.mcp-servers
      items:
        - id: mcp-cn-disclosure
          name: A股信息披露结构化抽取
          transport: stdio
          command: !!js process.env.QUANT_MCP_NODE || process.execPath
          args:
            - "C:\\Users\\helib\\dsh-cn-disclosure\\cn-disclosure-mcp-server.mjs"
          cwd: "C:\\Users\\helib\\dsh-cn-disclosure"
          enabled: true
```

`command` 使用 `!!js process.env.QUANT_MCP_NODE || process.execPath` 硬核写法，免疫本机 Node 版本目录漂移。

### 本地独立验证

```bash
python _selftest.py
```

---

## 扩展数据

编辑 `data/disclosure-rules.json`：
- `event_types`：披露事件类型 → `{id, name, direction(pos/neg/neu), category, aliases[]}`
- `field_patterns`：字段抽取正则 → `{id, name, regex, unit}`

改完重启 server 即生效（无需改代码）。后续可导入用户自有的披露语料做规则增强。

---

## 架构要点

- **零依赖**：纯 Node ESM + `fs`，无 `npm install`，免疫 managed-node 漂移。
- **本地优先**：数据来自内置 `data/disclosure-rules.json`，不触网、不调外部 API。
- **标准 MCP stdio**：`initialize → notifications/initialized → tools/list → tools/call`，协议版本 `2024-11-05`，NDJSON 行协议。

## 已知局限（诚实声明）

- 对**扫描版 PDF** 需先转文本（可用本机 pdfplumber / 复制文本），本插件只处理文本。
- 数值为**字面正则识别**，未做会计口径校验（如"扣非 vs 归母"区分、并表范围等需人工/下游复核）。
- 多事件并列时（如"减持 + 诉讼"）均列出，由调用方按类型取舍。

## License

MIT © helibeiqi
