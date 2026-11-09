// Writing status belongs to the application. Academic prose must still reflect
// the actual evidence, without turning every design description into a plan.
export const academicWritingStyle='正文、摘要、章节标题、图题和表题使用正式学术表达。标题不要附加“拟开展”“草稿”“建议稿”“待验证”等生成状态标签，不在文稿中反复自称草稿。介绍架构、模型、算法与技术方案时，采用“本文提出的方案”“系统由……组成”“处理流程包括……”等客观表述，不以“拟开展/拟采用/建议”反复起句。使用“系统总体架构”“研究方法”“技术路线”“实验设计”“验证方案”等准确题名。正式表达不改变研究事实：只描述已有材料支持的实施状态、数据和结论；只有设计时描述设计内容与适用边界，不能改写为已实现、已实验或已验证。必要事实缺失仍按原契约保留具体待补充项，不虚构结果。开题报告、任务书和未来研究章节仍按文档用途准确说明计划与预期，不把计划写成完成成果。';
// A source ID proves access to a document, not that it supports a claim. This
// guidance applies equally to outlines and to thesis/short-document prose.
export const academicEvidenceDiscipline='对每一项具体判断分别核对其证据：题目、提纲、改进设想、演示记录和题录不能证明具体问题、现状、用户体验、资源条件、成本、因果关系或实施结果。只有材料明确陈述的事实才能写成已确认事实；由方案推测的问题应写成研究问题或待验证假设，不能写成已发现的问题。演示记录只支持记录中实际描述的步骤，不支持额外观察或效果推断；没有提供硬件、成本、时间、样本、条件或计划安排时，不能自行写成已满足的条件。选择 [source:ID] 前逐句核对该来源实际读取内容是否支持相邻主张，不能因为文档已读取就把其标记附在来源未陈述的事实后；综合分析必须区分文献结论和作者推断。形成完整候选后自行逐句复核，删除或改成有明确边界的假设；无法支撑且当前任务必须陈述的事实，应按当前契约标为缺失，不得虚构。';
export const academicWritingInstructions=academicWritingStyle+academicEvidenceDiscipline;
export const academicFigureStyle='图题和图注只描述图示对象、组成和逻辑关系；实际排版位置由系统计算，生成阶段无法确定，应避免写左侧、右侧、上方、下方、上行、下行、顶部或底部等位置关系，不添加“（拟开展）”“（草稿）”等状态后缀，也不写“本图为拟开展方案”这类生成说明。系统架构和技术路线本身不代表实测效果；涉及尚未验证的性能或结果时移除无依据的主张，并在相邻正文据实交代验证边界，不能通过删去限制性文字把未实施工作冒充完成结果。';
