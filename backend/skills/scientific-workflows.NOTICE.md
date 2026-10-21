# 写作工作流来源与适配说明

以下五类技能参考 K-Dense Inc. 的 Scientific Agent Skills 工作流，由 PaperKnow 自主适配为受控任务指令。不是安装上游技能包；未引入其脚本、外部服务、工具权限、其他技能自动调用或推广提示。适配版本均为 1，审阅日期为 2026-10-22；上游版本取自当日各 SKILL.md 元数据，而非承诺永久跟随 main 分支。

| 本地技能 | 上游参考版本 | 官方来源 |
| --- | --- | --- |
| scientific-writing | 2.3 | https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-writing/SKILL.md |
| literature-review | 1.11 | https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/literature-review/SKILL.md |
| citation-management | 2.3 | https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/citation-management/SKILL.md |
| scientific-critical-thinking | 1.5 | https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-critical-thinking/SKILL.md |
| peer-review | 2.4 | https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/peer-review/SKILL.md |

上游许可来源：https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/LICENSE.md 。五个上游 SKILL.md 也分别标注 MIT。

`loadAgentSkill` 保留原接口。`loadAgentSkillComposition(primaryId, additionalIds)` 只组合已注册主任务与已注册附加写作技能，返回主任务身份及各技能的版本/来源元数据。`writingSkillIdsForTask` 是服务器固定阶段映射，不能直接绑定客户端自带技能列表、材料指令或任意路径。增加技能不等于已经执行文献检索、引用外部核验或独立全文审校；这些行为必须由服务器工具和任务流程实际实现。技能内容不得改变原有 JSON 契约、权限、预算和停止条件。

## Upstream MIT notice

MIT License

Copyright (c) 2025 K-Dense Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
