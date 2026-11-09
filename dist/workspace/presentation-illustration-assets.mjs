// The same allowlist is used for server packaging and both browser export paths.
const topics = [
  ['network', /图像|识别|深度学习|人工智能|神经网络|机器学习|算法|模型|软件|计算机|信息系统|transformer|machine learning|neural|algorithm|computer|image recognition|software/i],
  ['lab', /化学|生物|细胞|分子|医药|医学|药物|材料科学|反应|实验室|chemistry|molecule|cellular|medicine|medical|laboratory|biolog/i],
  ['field', /遥感|生态|气候|地理|环境|空间分布|区域|土壤|农业|野外|城市|ecology|climate|geography|environment|agriculture|remote sensing|urban/i],
  ['analysis', /数据|统计|结果|验证|评估|指标|性能|误差|样本|定量|metrics|results|statistics|data|evaluation|benchmark/i],
  ['literature', /文献|理论|综述|研究现状|引用|档案|literature|bibliography|theor|prior work|citation/i],
  ['strategy', /背景|目标|方案|计划|管理|教育|应用|建设|需求|展望|strategy|context|background|education|application|objective|roadmap|plan/i],
];

export function selectPresentationIllustration(slide, deck) {
  const title = slide?.title || '';
  const deckTitle = deck?.title || '';
  const find = text => topics.find(([, pattern]) => pattern.test(text))?.[0];
  return find(title) || find(deckTitle) || find(slide?.body?.slice(0, 300) || '') || 'literature';
}

const descriptions = {
  network: ['计算与网络主题插图', 'Computing and network illustration'],
  lab: ['实验科学主题插图', 'Laboratory science illustration'],
  field: ['环境与空间研究主题插图', 'Environmental and spatial research illustration'],
  analysis: ['数据分析主题插图', 'Data analysis illustration'],
  literature: ['文献与理论研究主题插图', 'Literature and theory illustration'],
  strategy: ['研究规划主题插图', 'Research planning illustration'],
};

export function presentationIllustrationAlt(asset, language) {
  return Object.hasOwn(descriptions, asset) ? descriptions[asset][/^(?:en|english|英文|英语)/i.test(language || '') ? 1 : 0] : '';
}

export function presentationIllustrationAssetPath(asset) {
  return topics.some(([key]) => key === asset) ? '/workspace/assets/ppt-illustrations/' + asset + '.png' : null;
}

export const presentationIllustrationUrl = presentationIllustrationAssetPath;

export function validPresentationIllustrationPlacement({x, y, w, h} = {}) {
  return [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1280 && y + h <= 720;
}
