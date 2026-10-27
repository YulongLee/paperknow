export const feedbackKey='paperknow-help-feedback';
export const feedbackTypes=['功能问题','使用咨询','体验建议','其他'];
export const helpCategories=[{"id":"start","title":"新手入门","description":"创建项目与管理成果","icon":"book","color":"blue"},{"id":"writing","title":"写作与修改","description":"大纲编辑与内容保存","icon":"pen","color":"purple"},{"id":"literature","title":"AI 研读","description":"原文解读、问答与翻译","icon":"file","color":"mint"},{"id":"detection","title":"论文检测","description":"上传要求与报告解读","icon":"search","color":"orange"},{"id":"files","title":"文件与导出","description":"Word、PDF 与 PPT","icon":"upload","color":"blue"},{"id":"data","title":"账户与数据","description":"账户资料导出与隐私设置","icon":"settings","color":"purple"}];
export const relatedFeatures=['未选择','工作台与项目','文件管理','任务中心','AI 写作','AI 研读','降重复率','降 AI 率','论文检测','PPT 创作','科研工具','格式排版','会员与用量','设置与备份','其他'];
export const articles=[
  {
    "id": "start-project",
    "category": "start",
    "title": "如何创建项目并管理研究成果？",
    "tags": "入门 新建项目 关联 草稿",
    "summary": "按研究课题组织草稿、文献与报告，在同一处管理项目。",
    "steps": [
      "登录后进入「我的项目」，新建项目并填写项目名称、学段与专业。",
      "在 AI 写作等工具中选择「所属项目」，将研究材料和生成成果归入对应课题；已保存的文件可在「文件管理」中整理。",
      "保存后回到项目查看研究材料、任务与成果；在其他设备登录同一账户，可继续管理已保存的项目。"
    ],
    "note": "我的项目统一保存在登录账户中。旧浏览器记录仅在主动确认后导入，不会自动上传；项目仅供当前账户管理，不代表团队共享。",
    "action": "#projects",
    "actionLabel": "前往我的项目"
  },
  {
    "id": "start-task",
    "category": "start",
    "title": "如何开始一项研究任务？",
    "tags": "入门 工具 开始",
    "summary": "从目标选择工具，保存后到文件管理继续处理。",
    "steps": [
      "选择 AI 写作、AI 研读、论文检测或其他相关工具。",
      "按页面提示填写真实研究信息，核对页面标注的当前可用范围。",
      "编辑并保存内容，再到「文件管理」重新打开；任务中心查看已记录的实际操作。"
    ],
    "note": "已提交的在线任务可在任务中心查看进度，生成成果以任务实际完成状态为准。",
    "action": "#home",
    "actionLabel": "前往工作台"
  },
  {
    "id": "writing-outline",
    "category": "writing",
    "title": "如何生成提纲、核对字数并保存正文？",
    "tags": "大纲 写作 保存 草稿 导出",
    "summary": "按对应写作流程准备资料，点击生成即可获得可编辑的提纲或正文。",
    "steps": [
      "选择毕业论文、开题报告等对应工具，填写题目、学段、专业和目标字数。",
      "准备实际材料与参考文献，点击生成即可获得提纲；生成结构会映射到可编辑内容与字数分配，也可导入或自行修改。",
      "核对后继续生成正文，审核采纳并保存；导出前检查研究事实、引用、章节和实际格式。"
    ],
    "note": "各写作工具按对应页面流程处理，在线任务以当前服务状态为准。没有提供的实验、问卷和数据不得补造为研究结论；生成后请保存并核对文件管理中的记录。",
    "action": "#category/writing",
    "actionLabel": "前往 AI 写作"
  },
  {
    "id": "revision-boundary",
    "category": "writing",
    "title": "降重复率与降 AI 率有哪些限制？",
    "tags": "降重 降AI率 AIGC 导师 修改",
    "summary": "整理修改意见，保留事实、证据与个人表达。",
    "steps": [
      "导入实际原文或粘贴正文，说明导师意见、来源位置和表达目标。",
      "选择当前段落或全部原文，每次最多 32,000 字符、单段最多 3,500 字符；核对处理范围后，点击生成即可开始。",
      "生成候选后逐段查看差异，核对数字、术语和引用，采纳后进入导出稿。草稿自动保存，主动保存版本可保留历史。"
    ],
    "note": "AI 候选不直接覆盖原稿；未采纳保留原文。可导出 DOCX、PDF、TXT 与备份。论文检测包含重复率与 AI 率两项。AI 检测展示疑似片段占比、分段标签与置信分；结果不替代学校指定报告。",
    "action": "#category/reduce",
    "actionLabel": "前往降重复率"
  },
  {
    "id": "literature-reading",
    "category": "literature",
    "title": "如何整理文献、研读笔记与译文？",
    "tags": "文献 阅读 翻译 笔记 来源 DOI",
    "summary": "用实际原文进行解读、问答与逐段翻译，保留可定位的来源。",
    "steps": [
      "在我的文献导入有权使用的正文或摘要，也可从已开放的检索来源查找题录后补充原文。检索来源的实际开放状态以页面为准。",
      "进入文献，选择实际段落，使用 AI 研读、原文问答或文献翻译。核对范围与目标语言后，点击生成即可开始。",
      "核对解读的原文摘录或按段对应译文，采纳后保存，可继续修改并导出 TXT、DOCX 或 PDF。"
    ],
    "note": "每次最多 20 段、32,000 字符；翻译每段最多 3,500 字符。只有题录不能开始全文研读；未选择的原文不会声称已读。文献与采纳的研读记录保存在当前浏览器，请及时备份。",
    "action": "#category/literature",
    "actionLabel": "前往 AI 研读"
  },
  {
    "id": "detection-meaning",
    "category": "detection",
    "title": "论文查重结果代表什么？",
    "tags": "重复率 相似度 查重 知网 万方 维普 报告",
    "summary": "提交论文，查看重复率、原文标注与来源对照，定位需要核对的内容。",
    "steps": [
      "登录后上传文档或粘贴正文，核对检测范围与本次费用，点击开始重复率检测。",
      "检测过程中可查看状态栏；完成后查看重复率、章节统计与原文标注，逐段核对来源对照。",
      "可保存检测报告，或根据原文标注继续修改；已有对照材料也可使用材料比对。"
    ],
    "note": "结果基于本次实际纳入的比对资料，未发现匹配不代表不存在重复，不保证覆盖全部文献，不替代学校或机构指定的检测报告。AI 率需单独检测。",
    "action": "#category/detection",
    "actionLabel": "前往论文检测"
  },
  {
    "id": "detection-citation",
    "category": "detection",
    "title": "为什么去除引用后的相似度仍需人工核对？",
    "tags": "引用 排除 相似字数 来源",
    "summary": "先确认报告类型，再核对引用位置和真实来源。",
    "steps": [
      "打开报告，查看本次比对范围、相似来源和正文逐段标记。",
      "本地材料报告使用有限的引用识别规则，需人工核对；公开来源联网报告不自动扣除引用，不把规范引用直接认定为不当使用。",
      "结合报告说明核对分母、章节范围和重复区间，必要时修改正文后重新提交检测。原报告数值保持不变。"
    ],
    "note": "文本相似不直接构成学术不端结论；列出参考文献不表示整段文字可以自动排除，报告仅覆盖实际取得或提供的来源材料。",
    "action": "#assets?category=detection",
    "actionLabel": "查看已保存报告"
  },
  {
    "id": "upload-pdf",
    "category": "files",
    "faq": "upload",
    "title": "扫描版 PDF 应该如何解析？",
    "tags": "上传失败 文件 PDF OCR 扫描 空白 文字层",
    "summary": "支持云解析的入口可识别扫描 PDF；本地材料比对模式仍需要含文字层的 PDF。",
    "steps": [
      "先查看当前入口提示：TXT / DOCX 通常在浏览器本地提取；支持云端 PDF 解析的入口会另外说明文件大小、页数与处理授权。",
      "使用云端解析时，先确认原件将提交云端，再等待任务完成；离开页面不代表任务取消，已提交任务可在任务中心核对。",
      "解析后检查错字、阅读顺序、表格、公式与章节。无法解析的文件可转换为可复制文字的 DOCX / TXT 后重新导入。"
    ],
    "note": "云端解析的实际开放状态与限制以入口为准；本地比对入口不会自动把扫描图片当作已解析正文。解析文件和之后的 AI 处理或联网检索分别确认。"
  },
  {
    "id": "upload-retry",
    "category": "files",
    "faq": "upload",
    "title": "上传失败或正文解析不完整怎么办？",
    "tags": "上传失败 DOCX TXT PDF 格式 文件大小",
    "summary": "先核对工具支持的格式，再检查实际解析内容。",
    "steps": [
      "查看当前工具的文件格式和大小限制；不同工具的限制不同。",
      "确认文件未加密且可正常打开。旧版 .doc 请先另存为 .docx，再在支持 DOCX 的页面导入。",
      "导入后核对正文，特别检查表格、公式、参考文献和乱码；错误内容修正后再处理。"
    ],
    "note": "格式排版当前只处理 DOCX；浏览器文本预览不等同于 Word 原样版式。"
  },
  {
    "id": "export-files",
    "category": "files",
    "title": "导出的 Word、PPT 与页面预览有什么区别？",
    "tags": "导出 下载 Word PPT DOCX 排版 字体",
    "summary": "按各工具实际导出格式核对文件，不把预览当作最终文件。",
    "steps": [
      "使用对应工具提供的导出按钮，并确认浏览器已下载文件。",
      "在 Word 或 PowerPoint 中检查字体、分页、图表、公式与版式。",
      "修改后重新导出并保留原件；本地排版预览不模拟完整 Word 分页。"
    ],
    "note": "各页面的导出能力以实际按钮为准；文本导出不会自动变成排版后的 Word 文档。",
    "action": "#assets",
    "actionLabel": "前往文件管理"
  },
  {
    "id": "data-location",
    "category": "data",
    "faq": "data",
    "title": "保存的内容在哪里？",
    "tags": "保存 丢失 浏览器 换电脑 云端 隐私 账户",
    "summary": "项目与云端文件统一在登录账户中管理，未保存的编辑内容请及时保存。",
    "steps": [
      "登录后，在「我的项目」管理研究课题，在「文件管理」查看已上传或生成并保存的云端文件。",
      "在其他功能中使用「从文件管理选择」，可继续处理已有文件；更换设备后登录同一账户查看已保存的内容。",
      "确认编辑内容已经保存后再离开页面。账户资料可在设置中心导出资料包，原件与生成文件可在文件管理中下载；未保存输入不包含在资料包中。"
    ],
    "note": "未保存的临时编辑内容不包含在账户资料包中。需要处理历史资料时可联系支持核对；反馈提交后可在帮助与反馈中查看处理状态。",
    "action": "#settings/data",
    "actionLabel": "前往数据与隐私"
  },
  {
    "id": "data-backup",
    "category": "data",
    "faq": "data",
    "title": "如何导出与管理账户资料？",
    "tags": "账户资料 导出 JSON 下载 备份 云端 隐私 删除",
    "summary": "研究资料统一在登录账户中管理，可导出资料包，或在文件管理中下载、整理文件。",
    "steps": [
      "在设置中心「数据与隐私」点击「导出账户资料包」，下载当前账户的项目、已保存稿件、成果、任务及文件清单。",
      "需要原件或生成文件的实际内容时，进入「文件管理」下载，也可以按项目整理或批量删除。",
      "更换设备后登录同一账户继续管理已保存的资料；需要更正个人信息或处理隐私问题时，可进入账户与安全或帮助与反馈。"
    ],
    "note": "账户资料包为 JSON 格式，供查阅与保管，不支持导入覆盖账户数据；原件与生成文件需在文件管理中另外下载。",
    "action": "#settings/data",
    "actionLabel": "管理账户资料"
  },
  {
    "id": "account-service",
    "category": "data",
    "title": "账户、会员、在线 AI 与云同步现在可以使用吗？",
    "tags": "会员 支付 订单 账户 AI 服务 云同步",
    "summary": "登录后统一管理项目、文件和任务；付费和在线 AI 以实际开放范围为准。",
    "steps": [
      "邮箱和中国大陆手机号账户已开放，支持密码与验证码登录；研究课题在「我的项目」管理，已保存文件在「文件管理」查看，生成进度在「任务中心」查看。",
      "编辑中的内容需按工具提示保存。历史浏览器草稿不会因为登录自动上传；在线 AI 是否可用请查看当前服务状态，学术检索以对应工具说明为准。",
      "使用工具时查看对应页面的当前状态；真实 AI 服务用量在账户用量页核对，缺失 Token 显示未知，记录数量不代表会员额度。"
    ],
    "note": "支付渠道及可购服务以付款页的实时开放状态为准。创建订单不代表已付款，服务器确认付款后才发放积分或权益；本地模板不等于AI 生成结果。",
    "action": "/status/",
    "actionLabel": "查看功能开放范围"
  },
  {
    "id": "presentation-creation",
    "category": "files",
    "title": "如何用 AI 制作通用、开题或毕业 PPT？",
    "tags": "PPT AI 答辩 开题 毕业 演示 PPTX 备注",
    "summary": "准备主题或真实报告，点击生成即可获得草稿，审核并编辑每页。",
    "steps": [
      "选择 AI PPT、开题 PPT 或毕业 PPT；开题与毕业需要实际报告或论文正文。",
      "核对题目、页数、版式与材料，可先修改大纲，再点击生成以获得页面和演讲备注。",
      "预览采纳后逐页编辑、保存并导出可编辑 PPTX，正式汇报前在 PowerPoint 或 WPS 中试播。"
    ],
    "note": "不编造原文中没有的研究数据或结论，不提供已经完成的人工答辩稿、资料包或问答包交付。",
    "action": "#category/ppt",
    "actionLabel": "前往 PPT 创作"
  },
  {
    "id": "research-drawing",
    "category": "files",
    "title": "科研图表、结构示意和公式分别能做什么？",
    "tags": "科研工具 绘图 图表 公式 LaTeX 结构 示意 SVG",
    "summary": "图表依赖实际数值，结构示意表达关系，公式支持数学排版。",
    "steps": [
      "基础绘图导入实际 CSV/TSV 或手动数据，选择图形并核对坐标、单位与数值。",
      "专业绘图可点击生成以获得节点关系结构示意，采纳后编辑并保存导出；不将其当作专业仿真或 CAD。",
      "公式可输入 LaTeX 进行数学排版，或点击生成获取辅助建议；核对变量、适用条件与符号后导出。"
    ],
    "note": "不伪造数值、显著性或实验结论。结构示意不能作为电路仿真、精确分子建模、CAD 工程图或医学诊断。",
    "action": "#category/research",
    "actionLabel": "前往科研工具"
  },
  {
    "id": "format-fine-review",
    "category": "files",
    "title": "格式检测与智能排版有什么区别？",
    "tags": "格式 检测 智能排版 DOCX 字体 行距 页边距",
    "summary": "格式检测列出规则差异，智能排版按所选规则生成副本。",
    "steps": [
      "导入 2MB 以内 DOCX，选择通用或自定义规则，核对学校或期刊要求。",
      "只查看段落问题时选择格式检测；需要应用可修正项时选择智能排版，并核对修改清单。可另行确认 AI 格式建议。",
      "保留原文件并导出副本，再在 Word 或 WPS 中检查目录、页码、复杂表格、公式及图片。"
    ],
    "note": "通用规则并非高校官方模板，需对照实际要求调整。规则检查覆盖有限项目，不表示论文全部格式已经合格。",
    "action": "#category/format",
    "actionLabel": "前往格式排版"
  }
];
export function searchHelp(query='',category='all'){const tokens=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return articles.filter(a=>(category==='all'||a.category===category)&&tokens.every(t=>[a.title,helpCategories.find(c=>c.id===a.category)?.title||'',a.tags,a.summary,...a.steps,a.note].join(' ').toLocaleLowerCase().includes(t)));}
export function normalizeFeedback(raw={}){if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};const oldFeatures={'文献与研读':'AI 研读','修改与润色':'降重复率','免费查重':'论文检测'};return {type:feedbackTypes.includes(raw.type)?raw.type:feedbackTypes[0],feature:relatedFeatures.includes(raw.feature)?raw.feature:(Object.hasOwn(oldFeatures,raw.feature)?oldFeatures[raw.feature]:relatedFeatures[0]),content:typeof raw.content==='string'?raw.content.slice(0,3000):'',savedAt:typeof raw.savedAt==='string'?raw.savedAt:''};}
export function feedbackText(value){const v=normalizeFeedback(value);if(!v.content.trim())throw Error('请先填写问题描述。');return `PaperKnow 反馈草稿（本地，尚未发送）\n反馈类型：${v.type}\n相关功能：${v.feature}\n\n问题描述：\n${v.content.trim()}\n\n此文本由用户本地导出，不代表已向 PaperKnow 提交。`;} 

export function parseFeedbackDraft(raw){if(raw===null||raw===undefined||raw==='')return normalizeFeedback();const value=typeof raw==='string'?JSON.parse(raw):raw;if(!value||typeof value!=='object'||Array.isArray(value)||['type','feature','content','savedAt'].some(key=>value[key]!==undefined&&typeof value[key]!=='string')||typeof value.content==='string'&&value.content.length>3000)throw Error('反馈草稿结构异常，已停止覆盖。');return normalizeFeedback(value);}
