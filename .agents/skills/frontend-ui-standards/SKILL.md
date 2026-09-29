---
name: frontend-ui-standards
description: Enforces frontend UI layout rules, design token scales, responsive constraints, and browser regression standards for GamesMcp web application to ensure visual uniformity and prevent UI collapse.
---

# GamesMcp 前端开发与视觉规范准则 (Frontend UI Standards)

本项目是一套高性能、超轻量（Web Bundle < 260KB / Gzip < 80KB）的原神与星穹铁道知识档案库。
为了杜绝**“界面大小不一、排列不整齐、列表高度坍塌”**等恶性视觉问题，所有参与前端开发的代码编写与审查必须严格遵守本准则。

---

## 一、三栏主从架构铁律 (Layout Architecture)

全站核心采用三栏工作台架构（`ArchiveLayout`）：

```
+----------------+--------------------------+---------------------------------+
|  GlobalNav     |   Catalog (目录中栏)      |   Main Detail (主详情/看板)     |
|  宽 200px      |   宽 250px ~ 290px       |   宽 >= 560px                   |
|  全局模块切换  |   紧凑 Master List 导航  |   详细属性、技能、立绘、图鉴    |
+----------------+--------------------------+---------------------------------+
```

### 1. 目录中栏（Catalog）职责隔离
- **定位**：中栏是“导航目录（Directory）”，不是“陈列画廊（Gallery）”。其首要任务是**高密度、高对齐度、清晰易寻**。
- **禁止项**：
  - **严禁**在中栏塞入多列卡片网格（如 `.data-item-grid`）。
  - **严禁**在中栏随意增加打乱布局的视图切换器。
  - **严禁**在中栏子元素上允许不确定换行导致各行高度参差不齐。
- **强制项**：
  - 必须使用标准 Master List 列表项（`.data-item-row`）。
  - 每行固定高度 `50px`，必须声明 `min-height: 50px; max-height: 50px; flex-shrink: 0; box-sizing: border-box;`。
  - 头像统一使用 36px，左侧边框根据稀有度进行 3px 色条标识。

---

## 二、设计标尺与统一 Token (Design Token Scales)

杜绝任何随手编写的“奇数像素”或随意内边距，全站必须遵守以下 4 级尺寸阶梯：

### 1. 头像与图标阶梯 (Avatar Scale)
| 级别 | 尺寸 | 使用场景 |
| :--- | :--- | :--- |
| **Micro** | `24px` | 极紧凑内联小标、作者/发言者角标 |
| **Small** | `32px` | 顶栏品牌 Logo、二级列表项、材料列表 |
| **Medium**| `36px` | 目录主列表项（角色、武器、遗器、敌人等 Master List） |
| **Large** | `56px` | 详情面板主展示头像、大图预览徽标 |

### 2. 交互控件高度统一 (Control Heights)
| 控件类型 | 固定高度 | 规格与圆角 | 规范说明 |
| :--- | :--- | :--- | :--- |
| **顶栏控件** | `32px` | `border-radius: 8px; box-sizing: border-box;` | 快速搜索、游戏选择下拉框、深浅主题切换全部严格对齐 32px 基准线 |
| **搜索输入框** | `36px` | `border-radius: 8px; padding: 0 12px; font-size: 12px;` | 目录栏统一搜索框，`width: 100%;` 充满容器，不可留出多余留白 |
| **分类/筛选胶囊** | `28px` | `border-radius: 6px` (Tabs) / `14px` (Pills) | 高度统一 28px，字号统一 12px，垂直完全居中对齐 |
| **目录列表行** | `50px` | `padding: 0 10px; border-radius: 8px; gap: 10px;` | 头尾边距严格统一，禁止高度动态伸缩 |

### 3. 字体与排印标尺 (Typography)
- **Micro (`11px`)**: 星级星星字符、分类副标签、元数据辅助计数。
- **Caption (`12px`)**: 标签文字、搜索提示、表单项描述。
- **Body (`13px`)**: 列表标题、正文、表格内容、按钮文本。
- **Base (`14px`)**: 中等正文、提示框、导航项。
- **Subtitle (`16px`)**: 详情卡片小节标题。
- **Title (`20px ~ 24px`)**: 页面主标题、详情大标题。

### 4. 单行文本截断铁律 (Text Truncation Rule)
- 列表项中的标题、名称、标签凡是容器可能受限处，必须添加：
  ```css
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  ```
- 父级 flex 容器必须具有 `min-width: 0;`，否则 flex-item 在溢出时会撑大父容器导致横向错位。

---

## 三、Flexbox 与高度坍塌防范 (Anti-Collapse Layout Engineering)

此前出现的“2px 极细线条卡片”是由于 CSS flex 与 overflow 计算死锁导致。为彻底免疫该问题：

1. **容器高度继承准则**：
   - 具有垂直滚动的容器链条中，父级必须有确定的边界（如 `height: 100%; min-height: 0;`）。
   - 滚动子容器必须显式声明：
     ```css
     flex: 1;
     min-height: 0;
     overflow-y: auto;
     ```
2. **列表项抗压缩声明**：
   - 所有列表项必须声明 `flex-shrink: 0;`，防止在极端窄屏或高度受限时被压缩成线条。
   - 所有独立卡片组件（即便在宽看板中）也必须有保底高度，例如 `.data-grid-card { min-height: 140px; box-sizing: border-box; }`。

---

## 四、前端视觉回归验收流程 (Verification Flow)

任何涉及 UI 改动的 PR 或交付，必须经过以下四层金标准验证：

1. **类型与构建检查**：
   ```powershell
   pnpm -r --filter @gip/web build
   pnpm test
   ```
2. **无头浏览器自动化截图回归**：
   运行真实无头 Chrome 自动化截屏脚本，覆盖全站 11 个核心页面：
   - `#home`（首页）
   - `#story`（剧情档案）
   - `#archive/characters`（角色资料）
   - `#archive/weapons`（武器资料）
   - `#archive/artifacts`（圣遗物资料）
   - `#archive/enemies`（敌人资料）
   - `#archive/achievements`（成就资料）
   - `#archive/materials`（材料百科）
   - `#text/books`（文献文本）
   - `#search`（全局搜索）
   - `#ask`（智能问答）
3. **视觉人工审查 (Agent & Human)**：
   - 使用 `view_file` 打开生成的截图，逐页检查：
     - 中栏列表项是否高度均匀、星级与头像对齐；
     - 顶栏控件基准线是否平齐；
     - 胶囊按钮与搜索框是否贴合标尺；
     - 深色与浅色两套主题是否无对比度硬伤。
4. **轻量化包体积守门**：
   - Web 产物 gzip 必须保持在 80KB 以内，严禁重新引入 antd 或其他重型组件库。
