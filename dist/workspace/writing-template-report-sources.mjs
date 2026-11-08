export const writingReportSources = {
  course: {
    source: {
      name: '淮北师范大学研究生院《研究生课程论文模板》',
      url: 'https://yjsc.chnu.edu.cn/xz/xzzq/content_118091',
      attachment: 'https://yjsc.chnu.edu.cn/upload/yjsc/contentmanage/article/file/2025/12/22/%E7%A0%94%E7%A9%B6%E7%94%9F%E8%AF%BE%E7%A8%8B%E8%AE%BA%E6%96%87%E6%A8%A1%E6%9D%BF.docx',
      sha256: '6259a467f6f99540ef11d4d5e3d0970effdabcfe2a6979f0cd2efeefd481664e',
    },
    fields: ['college', 'author', 'studentId'],
    // Use the manuscript title and the body instructions following the cover and assessment sheet.
    format: {
      cover: '课程作业', coverEnglish: 'Course Paper', titleSize: 36, titleFont: '宋体', bodySize: 24, bodyFont: '宋体',
      line: 360, lineRule: 'auto', headingSize: 24, referencesSize: 21,
      page: {top: 1440, right: 1418, bottom: 1191, left: 1418, header: 851, footer: 992},
    },
    guide: [
      ['摘要与关键词', '概括课程作业讨论的问题和主要观点，列出主题关键词。'],
      ['正文', '围绕作业要求组织论证，按实际内容分节，并交代所用材料与依据。'],
      ['参考文献', '列出正文引用的来源，核对文中标注。'],
    ],
  },
  practice: {
    source: {
      name: '西昌学院土木与水利工程学院《校外实践实习报告模板》',
      url: 'https://xcc.edu.cn/tmgc/696842/696844/797252/index.html',
      attachment: 'https://xcc.edu.cn/tmgc/696842/696844/797252/%E9%99%84%E4%BB%B62%20%20%E5%9C%9F%E6%9C%A8%E4%B8%8E%E6%B0%B4%E5%88%A9%E5%B7%A5%E7%A8%8B%E5%AD%A6%E9%99%A2%E6%A0%A1%E5%A4%96%E5%AE%9E%E8%B7%B5%E5%AE%9E%E4%B9%A0%E6%8A%A5%E5%91%8A%E6%A8%A1%E6%9D%BF.docx',
      sha256: '4b9a5010c0e5b9ee59499ab05dd6cf66d51903c620f728fa94b8dc36d3b73c1e',
    },
    fields: ['major', 'author', 'studentId', 'supervisor'],
    // The cover and the practice record are separate Word sections with matching margins.
    format: {
      cover: '实践报告', coverEnglish: 'Practice Report', titleSize: 52, titleFont: '黑体', bodySize: 24, bodyFont: '宋体',
      headingSize: 32, subheadingSize: 28, tableSize: 24,
      page: {top: 1440, right: 1800, bottom: 1440, left: 1800, header: 851, footer: 992},
    },
    guide: [
      ['实践概况', '填写实际实践时间、地点与项目。'],
      ['实践目的', '说明实践任务和预期达成的学习目标。'],
      ['实践主要内容', '按照任务或阶段记录实际过程、参与工作和形成的成果。'],
      ['实践总结', '结合记录归纳收获、遇到的问题和改进思路。'],
    ],
  },
  idea: {
    source: {
      name: '南京航空航天大学教务处公布的江苏省高校专项课题申报书',
      url: 'https://aao.nuaa.edu.cn/_t753/2025/0817/c11066a381311/page.htm',
      attachment: 'https://aao.nuaa.edu.cn/_upload/article/files/62/35/815199544958aba3cac7782d08fc/f71dc973-b98a-4dc1-bbb9-ea7cb0f1d4e7.docx',
      sha256: 'c4b5839b60e43ad1fb27ec114b52a55a34485b2e79c6a56cdd9a0d4aa9bba174',
    },
    fields: ['author', 'institution'],
    // Use the project-description section, with the stated fill-in size and its exact line spacing.
    format: {
      cover: '课题思路', coverEnglish: 'Research Proposal', titleSize: 48, titleFont: '黑体', bodySize: 24, bodyFont: '仿宋',
      line: 400, lineRule: 'exact', headingSize: 28, subheadingSize: 28, tableSize: 24,
      page: {top: 1440, right: 1474, bottom: 1440, left: 1474, header: 851, footer: 992},
    },
    guide: [
      ['研究背景与价值', '交代问题背景、已有工作及仍需解决的问题。'],
      ['研究对象与目标', '明确研究对象、目标和拟解决的重点难点。'],
      ['研究方法与实施路线', '说明计划采用的方法、材料以及开展顺序。'],
      ['课题特色与研究基础', '概括拟验证的创新点，并交代已有基础与可行条件。'],
      ['研究进度与预期成果', '列出实施阶段、里程碑和预计交付的成果。'],
    ],
  },
};
