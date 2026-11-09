export const writingAcademicSources = {
  writing: {
    source: {
      name: '浙江大学材料科学与工程学院《本科生毕业论文（设计）模板》',
      url: 'https://mse.zju.edu.cn/2022/0302/c57178a2502456/pagem.htm',
      attachment: 'https://mse.zju.edu.cn/_upload/article/files/ff/29/481e9ab348b5ac2b645c0b76858c/f0970d53-00c6-4f9e-8437-d2026877b9ee.docx',
      sha256: 'cb26fcaf6a2513a958cba5385d04a45f4f0c28a46984f1a49420e58d2ede7cab',
    },
    fields: ['institution', 'college', 'major', 'author', 'studentId', 'supervisor'],
    // Use the actual thesis section and its designated paragraph style. The source
    // also contains separate submission and assessment forms for this college.
    format: {
      titleSize: 32, titleFont: '仿宋', bodySize: 24, bodyFont: '仿宋',
      line: 360, lineRule: 'auto', headingSize: 32, headingFont: '仿宋',
      subheadingSize: 30, subheadingFont: '仿宋',
      thirdHeadingSize: 28, referencesSize: 21, tableSize: 21,
      page: {top: 1440, right: 1800, bottom: 1440, left: 1800, header: 1134, footer: 680},
    },
    guide: [
      ['摘要与关键词', '概括研究问题、方法、主要发现和结论，按要求提供中英文摘要。'],
      ['绪论', '交代选题背景、研究问题和文章结构。'],
      ['正文', '根据学科和题目组织章节，交代研究方法并分析结果。图表须有编号和题注。'],
      ['结论', '概括研究发现及适用范围，并交代关键局限。'],
      ['参考文献', '列出正文实际引用的来源，逐项核对正文标注。'],
      ['附录', '需要时附上支撑正文的材料，并在正文中注明对应位置。'],
    ],
  },
  summary: {
    source: {
      name: '四川轻化工大学经济学院《本科毕业论文文献综述参考模版》',
      url: 'https://webadm.suse.edu.cn/_s54/2022/0316/c2154a86700/page.psp',
      attachment: 'https://webadm.suse.edu.cn/_upload/article/files/1b/95/66dae8a0416c90387225435a932d/f905f5e3-94a0-4c60-9f47-ba39796d6982.docx',
      sha256: 'ddb2a082d0225e6ef64ed9657ac29f389a3970fb00762ccdcb71ce2aaed5087f',
    },
    fields: ['institution', 'college', 'major', 'author', 'studentId', 'supervisor'],
    // Take body metrics from the numbered section, after the standalone cover.
    format: {
      cover: '文献综述', coverEnglish: 'Literature Review', coverSize: 52, titleSize: 44, titleFont: '黑体', bodySize: 24, bodyFont: '宋体',
      line: 440, lineRule: 'exact', headingSize: 32, subheadingSize: 28, thirdHeadingSize: 28, thirdHeadingFont: '楷体', referencesSize: 24,
      page: {top: 1440, right: 1797, bottom: 1440, left: 1797, header: 851, footer: 992},
    },
    guide: [
      ['引言', '界定主题、综述目的和文献范围，说明将讨论的核心问题。'],
      ['正文', '按主题、研究方法或国内外研究脉络归纳证据，比较结论、适用范围和分歧。'],
      ['总结', '归纳已解决和仍待研究的问题，说明对后续研究的启发。'],
      ['参考文献', '只列正文引用过的资料，并逐一对应文中编号。'],
    ],
  },
  taskbook: {
    source: {
      name: '河北师范大学商学院《本科生毕业论文（设计）任务书》',
      url: 'https://sxy.hebtu.edu.cn/a/2025/10/24/4B336DB2EF5849AD917ED149975F1E18.html',
      attachment: 'https://sxy.hebtu.edu.cn/dynamic/download.jsp?id=4e88ab1ca5e642a48b3a67a11b6bcee7',
      sha256: '45b6088b0ed7e2f07736b32dbe3f96011ab8e7e9ba57bb391e378d158cb249b8',
    },
    fields: ['institution', 'college', 'major', 'author', 'supervisor'],
    // The original is a one-page form with its metadata above the task rows.
    format: {
      inlineForm: '毕业论文（设计）任务书', titleSize: 32, titleFont: '黑体', bodySize: 21, bodyFont: '宋体', tableSize: 21,
      page: {top: 1418, right: 1418, bottom: 1418, left: 1418, header: 851, footer: 992},
    },
    guide: [
      ['基本要求', '列明论文或设计的工作内容、各环节要求以及须遵循的学术规范。'],
      ['研究目标', '说明预期完成的工作、交付成果和验收要求。'],
      ['主要参考文献', '列出指导教师指定或已经核对的主要资料。'],
    ],
  },
};
