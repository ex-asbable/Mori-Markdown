# Mori Markdown

Mori 是一个面向 Windows 的轻量 Markdown 与 TeX 桌面编辑器。它专注于三件事：写作、阅读和预览。

## 功能

- Markdown 编辑与实时渲染
- 左侧编辑区为 Markdown 与 TeX 提供轻量语法高亮
- `$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]` TeX 公式
- KaTeX 根号、伸缩括号、长箭头等 SVG 数学符号完整显示
- 编辑、分栏预览、沉浸阅读三种模式
- 可持久化的浅色 / 深色界面模式
- 分栏模式使用单一主滚动条，按标题、段落、列表、代码块与公式建立语义锚点，同步左右视口中心
- 打开与保存 `.md`、`.markdown`、`.tex`、`.txt` 文件；`保存`会将未命名文档直接存入应用旁的 `Mori Repository`，`另存为`（`Ctrl+Shift+S`）始终询问位置
- 点击标题栏中的文件名可在锁定扩展名的情况下重命名；默认“未命名”文档首次保存时会先询问文件名
- VS Code 风格热恢复：关闭窗口不再提示保存，未保存内容会在下次普通启动时恢复；通过文件关联或命令行打开文件时以指定文件为准
- 代码块使用 Highlight.js 本地高亮，并支持 Markdown 链接和图片（HTTP(S)、data URI、本地相对路径、Windows 绝对路径及 `file:///` URL）
- 将当前预览导出为独立 HTML 或 A4 PDF；本地图片和 KaTeX 字体会一并嵌入
- 自动换行、字数与光标位置统计
- 未保存内容热恢复
- 所有渲染依赖均为本地资源；启动时会短暂联网检查 GitHub 正式版本，失败不影响使用

## 开发运行

要求：Windows 10/11、Node.js 20 或更高版本。

```powershell
npm.cmd install
npm.cmd start
```

当前机器的 PowerShell 执行策略会拦截 `npm.ps1`，使用 `npm.cmd` 即可，无需更改执行策略。

## 构建 Windows 安装包

```powershell
npm.cmd run dist
```

构建结果会生成在 `release` 目录：

- `Mori-Markdown-Setup-0.3.4-x64.exe`：Windows 安装版
- `Mori-Markdown-Portable-0.3.4-x64.exe`：无需安装的便携版

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+N` | 新建 |
| `Ctrl+O` | 打开 |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+1` | 编辑模式 |
| `Ctrl+2` | 分栏预览 |
| `Ctrl+3` | 阅读模式 |

## TeX 范围

TeX 由 KaTeX 渲染，适合数学公式；它不是完整的 LaTeX 排版引擎，因此不处理完整论文模板、宏包或 PDF 编译。
