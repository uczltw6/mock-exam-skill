# Mock Exam Skill · 模拟笔试

把知识点、岗位要求或往年考题变成**能在浏览器里真正作答的模拟卷**：先分析值得练习的考点，再出题，最后生成带计时、保存、判分和解析的本地考场。

适用于支持 `SKILL.md` 的编码代理。考点分析和出题由代理完成，运行模板不需要 API Key。预测有材料依据，并明确区分原题、改编题、预测模拟题；不承诺押中真题。

## 考场体验

- 多套试卷选择；单选、多选、仅选择题、仅编程题和混合卷。
- 倒计时、到时锁卷、刷新恢复、题目标记、100 题答题卡滚动。
- 交卷后计分、逐题解析、失分题筛选、Markdown 答卷导出。
- **CodeMirror 6 代码编辑器**：Python/C++ 语法高亮、行号、括号配对、补全、自动缩进、Tab 缩进、长行软换行。
- ACM 标准输入输出，Python 3 / C++17，运行样例、自定义输入、交卷运行隐藏测试。不是 LeetCode 函数签名评测。
- 代码和答卷保存在本机；编辑器资源已打包，无需 CDN。Python 是判题后端，浏览器提供编辑界面。

## 安装 skill

将仓库中的 **`mock-exam` 文件夹**放入代理的 skills 目录。Codex 默认可放在 `~/.codex/skills/mock-exam`；若设置了 CODEX_HOME，则使用其 `skills` 子目录。仓库根目录还包含构建源码和测试，不要把整个仓库当作单个 skill 文件夹。

```bash
git clone https://github.com/tianyiwei-lang/mock-exam-skill.git
```

安装后重新开启支持发现新 skill 的会话，然后可以这样说：

```text
使用 $mock-exam，参考这些往年 AI 岗笔试截图，先整理考点，
再出一套 100 道选择题，120 分钟，保存为第三套。
原题和新编题分开标注，交卷前不要显示答案。
```

```text
使用 $mock-exam，根据链式法则、模型评估、注意力和量化知识点，
出 20 道选择题与 2 道 ACM 编程题，并生成本地考场。
```

## 直接试用演示考场

要求 Python **3.10+** 与现代浏览器；C++ 判题另需 PATH 中可找到 `g++`。只使用 Python 或只做选择题不需要 C++ 编译器。

```bash
python mock-exam/scripts/create_exam.py ./generated/exam
python generated/exam/launch.py --port 18764
```

浏览器打开 `http://127.0.0.1:18764/`。如果端口已被其他考场占用，改为 `--port 18766`。终端 Ctrl+C 停止服务。供代理后台启动时可用 `python generated/exam/server.py --port 18766`，再通过代理的浏览器工具打开页面。

演示卷包含 3 道单选、1 道多选和 1 道原创“对称窗口求和”编程题。不会携带任何人的历史答卷或题源截图。

## 新增或更新试卷

先按 [JSON 格式](mock-exam/references/paper-format.md)编写试卷，再装入考场：

```bash
python mock-exam/scripts/add_paper.py ./generated/exam ./my-paper.json
python generated/exam/validate_bank.py --run-references
```

同编号默认拒绝覆盖；用户明确要更新同一卷时用 `--replace`。已开始的考试保留题库和测试快照。出题质量要求见 [出题指南](mock-exam/references/authoring.md)。完整入口为 [SKILL.md](mock-exam/SKILL.md)。

## 开发与验证

运行考场不需要 Node.js。只有修改代码编辑器源码时才需要安装 npm 依赖并构建：

```bash
npm ci
npm run build
python -m unittest discover -s tests -v
```

编辑器入口在 `editor-src/editor.js`，预构建 bundle 和第三方许可证在 `mock-exam/assets/exam-app`。依赖通过 lockfile 固定，CodeMirror/Lezer 等许可保留于 `THIRD_PARTY_NOTICES.txt`。

测试使用临时目录，覆盖题库校验、考前答案隐藏、来源校验、答卷快照、保存恢复、单选/多选计分、仅编程卷、Python/C++ 运行、超时/输出限制、浮点判题、脚手架和同编号覆盖保护。

## 使用边界

这是运行学习者本人代码的本地工具。子进程有限时和输出上限，但**不是操作系统隔离沙箱**，没有文件系统、网络或子进程树的强隔离；不要接收陌生人的代码或暴露执行接口到公网。服务器仅监听 `127.0.0.1`。GitHub 保存 skill 和模板，不托管可公开提交代码的判题服务。

MIT License；第三方依赖按各自许可证分发。
