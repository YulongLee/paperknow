export const writingToolSources = Object.freeze({
  article: {
    source: {
      name: '《青岛科技大学学报（自然科学版）》Word 格式范文',
      url: 'https://xbzr.qust.edu.cn/info/1101/1056.htm',
      attachment: 'https://xbzr.qust.edu.cn/system/_content/download.jsp?owner=2117677579&urltype=news.DownloadAttachUrl&wbfileid=17676574',
      sha256: 'bbe27e5195b70fae93468c5c038703cf3c47ead3f824885599e55dd347299bc8'
    },
    fields: ['author', 'institution'],
    format: {
      titleSize: 44, titleFont: '黑体', bodySize: 21, bodyFont: '宋体',
      line: 240, lineRule: 'auto', headingSize: 28, headingFont: '宋体',
      subheadingSize: 21, subheadingFont: '黑体', referencesSize: 18, tableSize: 15,
      page: {top: 1440, right: 1797, bottom: 1440, left: 1797, header: 964, footer: 567}
    },
    guide: [
      ['题名、作者及单位', '填写文章题名、真实作者及所属单位，依目标期刊要求提供英文信息。'],
      ['摘要与关键词', '概括研究目的、方法、主要结果和结论，列出关键词，按要求补充英文摘要。'],
      ['引言', '说明研究背景、相关进展与待解决的问题。'],
      ['正文', '结合研究设计呈现方法、结果与讨论，按层级组织标题。'],
      ['图表与公式', '按出现顺序编号并在正文引用，标注图表名称与单位，按要求提供英文图表题。'],
      ['结论与参考文献', '归纳结果支持的结论，按正文引文顺序核对实际引用的文献。']
    ]
  },
  analysis: {
    source: {
      name: '中经数（北京）数据应用技术研究院《数据分析报告模板》',
      url: 'https://www.n-bda.cn/newsnr.php?fl=zcdd&id=1050',
      attachment: 'https://www.n-bda.cn/baogaofm.docx',
      sha256: 'b58fbec884aaa448eda662ac43601a5ab55e3e49fded1b91e21d62a0bbd9e319'
    },
    fields: ['author', 'institution'],
    format: {
      cover: '数据分析报告', coverEnglish: 'Data Analysis Report',
      titleSize: 36, titleFont: '黑体', bodySize: 28, bodyFont: '宋体',
      line: 300, lineRule: 'auto', headingSize: 36, headingFont: '黑体',
      page: {top: 1418, right: 1800, bottom: 1134, left: 1800, header: 851, footer: 992}
    },
    guide: [
      ['执行摘要与引言', '概括分析目标、方法、主要发现与建议，再交代问题背景及分析范围。'],
      ['数据来源与预处理', '记录数据来源、样本范围、指标口径，以及缺失值、重复值和异常值的处理方法。'],
      ['分析方法与结果', '说明所用方法及依据，结合标明单位的图表呈现结果。'],
      ['结论、建议与局限', '把建议与可核对的结果对应，说明数据或方法限制。'],
      ['附录与来源', '按需列出可复核的统计表、计算说明和引用来源。']
    ]
  }
});
