// Product artwork identities are fixed. Never derive an image URL from document titles or route text.
const definitions=[
  {
    "key": "reading-library",
    "category": "literature",
    "title": "我的文献",
    "accent": "#4b9d9a",
    "path": "/workspace/assets/feature-art-v1/reading-library.webp"
  },
  {
    "key": "reading-search",
    "category": "literature",
    "title": "文献检索",
    "accent": "#488ca0",
    "path": "/workspace/assets/feature-art-v1/reading-search.webp"
  },
  {
    "key": "reading-reading",
    "category": "literature",
    "title": "文献研读",
    "accent": "#4b9d9a",
    "path": "/workspace/assets/feature-art-v1/reading-reading.webp"
  },
  {
    "key": "reading-answer",
    "category": "literature",
    "title": "原文问答",
    "accent": "#5d82c1",
    "path": "/workspace/assets/feature-art-v1/reading-answer.webp"
  },
  {
    "key": "reading-translation",
    "category": "literature",
    "title": "文献翻译",
    "accent": "#8871cc",
    "path": "/workspace/assets/feature-art-v1/reading-translation.webp"
  },
  {
    "key": "detection-similarity",
    "category": "detection",
    "title": "论文查重率",
    "accent": "#479785",
    "path": "/workspace/assets/feature-art-v1/detection-similarity.webp"
  },
  {
    "key": "detection-aigc",
    "category": "detection",
    "title": "论文AI率检测",
    "accent": "#6b81b7",
    "path": "/workspace/assets/feature-art-v1/detection-aigc.webp"
  },
  {
    "key": "revision-similarity-report",
    "category": "reduce",
    "title": "报告降重",
    "accent": "#8871cc",
    "path": "/workspace/assets/feature-art-v1/revision-similarity-report.webp"
  },
  {
    "key": "revision-similarity-paragraph",
    "category": "reduce",
    "title": "段落降重",
    "accent": "#9a77bd",
    "path": "/workspace/assets/feature-art-v1/revision-similarity-paragraph.webp"
  },
  {
    "key": "revision-aigc-report",
    "category": "aigc",
    "title": "报告降AI率",
    "accent": "#647bbc",
    "path": "/workspace/assets/feature-art-v1/revision-aigc-report.webp"
  },
  {
    "key": "revision-aigc-paragraph",
    "category": "aigc",
    "title": "段落降AI率",
    "accent": "#6988b8",
    "path": "/workspace/assets/feature-art-v1/revision-aigc-paragraph.webp"
  },
  {
    "key": "ppt-ai",
    "category": "ppt",
    "title": "AI创作PPT",
    "accent": "#bf8d71",
    "path": "/workspace/assets/feature-art-v1/ppt-ai.webp"
  },
  {
    "key": "ppt-proposal",
    "category": "ppt",
    "title": "开题汇报PPT",
    "accent": "#8871cc",
    "path": "/workspace/assets/feature-art-v1/ppt-proposal.webp"
  },
  {
    "key": "ppt-thesis",
    "category": "ppt",
    "title": "论文答辩PPT",
    "accent": "#5377dc",
    "path": "/workspace/assets/feature-art-v1/ppt-thesis.webp"
  },
  {
    "key": "research-basic",
    "category": "research",
    "title": "基础科研绘图",
    "accent": "#5d94bf",
    "path": "/workspace/assets/feature-art-v1/research-basic.webp"
  },
  {
    "key": "research-pro",
    "category": "research",
    "title": "专业科研绘图",
    "accent": "#4b9d9a",
    "path": "/workspace/assets/feature-art-v1/research-pro.webp"
  },
  {
    "key": "research-formula",
    "category": "research",
    "title": "公式编辑",
    "accent": "#6484b8",
    "path": "/workspace/assets/feature-art-v1/research-formula.webp"
  },
  {
    "key": "format-layout",
    "category": "format",
    "title": "格式排版",
    "accent": "#b6975b",
    "path": "/workspace/assets/feature-art-v1/format-layout.webp"
  },
  {
    "key": "more-cv",
    "category": "writing",
    "title": "学术简历",
    "accent": "#668cb2",
    "path": "/workspace/assets/feature-art-v1/more-cv.webp"
  },
  {
    "key": "revision-similarity-dual",
    "category": "reduce",
    "title": "全文双降",
    "accent": "#6f8d9e",
    "path": "/workspace/assets/feature-art-v1/revision-dual.webp"
  },
  {
    "key": "revision-aigc-dual",
    "category": "aigc",
    "title": "全文双降",
    "accent": "#6f8d9e",
    "path": "/workspace/assets/feature-art-v1/revision-dual.webp"
  },
  {
    "key": "writing-writing",
    "category": "writing",
    "title": "毕业论文",
    "accent": "#5377dc",
    "path": "/workspace/assets/writing-writing-v1.webp"
  },
  {
    "key": "writing-proposal",
    "category": "writing",
    "title": "开题报告",
    "accent": "#8871cc",
    "path": "/workspace/assets/writing-proposal-v1.webp"
  },
  {
    "key": "writing-summary",
    "category": "writing",
    "title": "文献综述",
    "accent": "#4b9d9a",
    "path": "/workspace/assets/writing-summary-v1.webp"
  },
  {
    "key": "writing-taskbook",
    "category": "writing",
    "title": "任务书",
    "accent": "#b6975b",
    "path": "/workspace/assets/writing-taskbook-v1.webp"
  },
  {
    "key": "writing-article",
    "category": "writing",
    "title": "期刊文章",
    "accent": "#5c94bf",
    "path": "/workspace/assets/writing-article-v1.webp"
  },
  {
    "key": "writing-course",
    "category": "writing",
    "title": "课程作业",
    "accent": "#659f85",
    "path": "/workspace/assets/writing-course-v1.webp"
  },
  {
    "key": "writing-practice",
    "category": "writing",
    "title": "实践报告",
    "accent": "#bf8d71",
    "path": "/workspace/assets/writing-practice-v1.webp"
  },
  {
    "key": "writing-idea",
    "category": "writing",
    "title": "课题思路",
    "accent": "#c69c4c",
    "path": "/workspace/assets/writing-idea-v1.webp"
  },
  {
    "key": "writing-questionnaire",
    "category": "writing",
    "title": "问卷设计",
    "accent": "#9b7eb8",
    "path": "/workspace/assets/writing-questionnaire-v1.webp"
  },
  {
    "key": "writing-analysis",
    "category": "writing",
    "title": "数据分析",
    "accent": "#6484b8",
    "path": "/workspace/assets/writing-analysis-v1.webp"
  },
  {
    "key": "reading-review",
    "category": "literature",
    "title": "文献综述",
    "accent": "#4b9d9a",
    "path": "/workspace/assets/writing-summary-v1.webp"
  },
  {
    "key": "more-journal",
    "category": "writing",
    "title": "期刊投稿",
    "accent": "#5c94bf",
    "path": "/workspace/assets/writing-article-v1.webp"
  },
  {
    "key": "more-translation",
    "category": "literature",
    "title": "学术翻译",
    "accent": "#8871cc",
    "path": "/workspace/assets/feature-art-v1/reading-translation.webp"
  }
];
export const featureIllustrations=Object.freeze(Object.fromEntries(definitions.map(row=>[row.key,Object.freeze(row)])));
const defaults=Object.freeze({writing:'writing-writing',literature:'reading-library',reduce:'revision-similarity-report',aigc:'revision-aigc-report',detection:'detection-similarity',ppt:'ppt-ai',format:'format-layout',research:'research-basic'});
export function resolveFeatureIllustration(category,feature='',classes=''){
 const writing=category==='writing'?String(classes).match(/\bwriting-task-(writing|proposal|summary|taskbook|article|course|practice|idea|questionnaire|analysis)\b/)?.[1]:null;
 const key=feature||(writing?'writing-'+writing:defaults[category]),candidate=Object.hasOwn(featureIllustrations,key||'')?featureIllustrations[key]:null;
 return candidate?.category===category?candidate:featureIllustrations[defaults[category]]||null;
}

