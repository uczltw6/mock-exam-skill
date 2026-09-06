# JSON 试卷格式

实际可运行例子：`assets/exam-app/papers/demo.json`。文件名必须等于 `id + '.json'`。题号在同一卷中唯一，不同卷可以重复。只要 questions/problems 至少一个非空即可；所有内容用纯文本，前端转义后显示，不使用 HTML 题干。

顶层必填：`id`（小写英文/数字/连字符）、`name`、`title`、`description`、`sourceNote`、`questions`、`problems`、`sources`。可选 `choiceMinutes`（默认30）、`fullMinutes`（默认120），均1–240。sources 为 `{title, url?}`，url 只支持 http(s)；原材料可只放描述，不必发布本地路径。

选择题：

```json
{"id":"1","source":"预测模拟","multi":false,"points":2,
 "topic":"概率","text":"公平硬币正面朝上的概率是多少？",
 "options":["0","0.25","0.5","1"],"answer":["C"],
 "explanation":"两个等可能结果中有一个是正面，概率为 1/2。"}
```

每题四个不同的非空选项；answer 为字母数组。multi=true 允许多个答案，模板多选按集合完全一致得满分。`originalNumber` 可记录原题号。`source` 用原题收录、同考点改编或预测模拟。

编程题字段：

- `id,title,points,source,sourceType`，可选 `shortTitle`。
- `description,rules`（文本数组）、`input,output`。
- `sampleIn,sampleOut,sampleNote,convention`。说明可留空文本，但字段需存在。
- `explanation,reference`：考后解析与可直接 stdin/stdout 运行的完整 Python 参考代码。
- `tests`：非空 `{label,input,expected}` 数组；第一项与公开样例一致。
- `checker`：默认 `tokens`，忽略空白差异，逐 token 完全相同。浮点题可选 `float`，要求 token 数相同且每项有限，使用 `absTol`、`relTol`（默认均1e-6）。需要严格两位小数文本时使用 tokens 并说明舍入约定。

答案、解析、完整参考实现和 tests 不会随考前公开题库发送。计时开始时服务端保存题库快照，后续替换 JSON 不改变已开始考试的答案或测试。

仅做选择题时 `problems: []`；仅编程题时 `questions: []`，页面自动只提供含编程模式。题目源 JSON 不提供下载路由。编程代码在临时目录执行 Python 3 或 PATH 中的 g++（C++17），每测试4秒、输出上限1MiB；编译25秒。它不是系统沙箱。

运行 `python validate_bank.py` 验证数据结构与题库；加 `--run-references` 在读完并信任自己编写的参考代码后验证所有编程测试。结构验证不证明题意或答案正确，仍需独立复算。
