// Original chemical insertion tokens and audited mappings to observed UI terms.
// Chemical particles and isotope notation follow IUPAC/NIST conventions:
// https://goldbook.iupac.org/terms/view/N04116
// https://physics.nist.gov/PhysRefData/Handbook/Tables/thoriumtable1_a.htm
// https://pubchem.ncbi.nlm.nih.gov/compound/Hydrogen-tritium-oxide
// Corrections preserve chemistry rather than reproducing erroneous labels.
export const chemicalSymbolAdditions={
 "chem-compounds": [
  [
   "氢气",
   "\\ce{H2}"
  ],
  [
   "二氧化硫",
   "\\ce{SO2}"
  ],
  [
   "氧化铜",
   "\\ce{CuO}"
  ],
  [
   "氯酸钾",
   "\\ce{KClO3}"
  ],
  [
   "硫酸铜",
   "\\ce{CuSO4}"
  ],
  [
   "碳酸氢钠",
   "\\ce{NaHCO3}"
  ],
  [
   "氧气",
   "\\ce{O2}"
  ],
  [
   "硫化氢",
   "\\ce{H2S}"
  ],
  [
   "二氧化锰",
   "\\ce{MnO2}"
  ],
  [
   "氢氧化铜",
   "\\ce{Cu(OH)2}"
  ],
  [
   "高锰酸钾",
   "\\ce{KMnO4}"
  ],
  [
   "氧化钙",
   "\\ce{CaO}"
  ],
  [
   "氢氧化铁",
   "\\ce{Fe(OH)3}"
  ],
  [
   "碳酸钠",
   "\\ce{Na2CO3}"
  ],
  [
   "氮气",
   "\\ce{N2}"
  ],
  [
   "氯气",
   "\\ce{Cl2}"
  ]
 ],
 "chem-ions": [
  [
   "锂离子",
   "\\ce{Li+}"
  ],
  [
   "锌离子",
   "\\ce{Zn^2+}"
  ],
  [
   "氟离子",
   "\\ce{F-}"
  ],
  [
   "碘离子",
   "\\ce{I-}"
  ],
  [
   "次氯酸根离子",
   "\\ce{ClO-}"
  ],
  [
   "亚硫酸根离子",
   "\\ce{SO3^2-}"
  ],
  [
   "乙酸根离子",
   "\\ce{CH3COO-}"
  ],
  [
   "银氨络离子",
   "\\ce{[Ag(NH3)2]+}"
  ],
  [
   "氧离子",
   "\\ce{O^2-}"
  ],
  [
   "铬酸根离子",
   "\\ce{CrO4^2-}"
  ],
  [
   "硫酸氢根离子",
   "\\ce{HSO4-}"
  ],
  [
   "氰根离子",
   "\\ce{CN-}"
  ],
  [
   "溴离子",
   "\\ce{Br-}"
  ],
  [
   "硫离子",
   "\\ce{S^2-}"
  ],
  [
   "硅酸根离子",
   "\\ce{SiO3^2-}"
  ],
  [
   "硫代硫酸根离子",
   "\\ce{S2O3^2-}"
  ],
  [
   "硫氰根离子",
   "\\ce{SCN-}"
  ]
 ],
 "chemistry": [
  [
   "反应左箭头",
   "\\longleftarrow"
  ],
  [
   "双向反应箭头",
   "\\leftrightarrow"
  ],
  [
   "加热符号 Δ",
   "\\Delta"
  ],
  [
   "映射示意 x↦xᵢ",
   "x\\mapsto x_i"
  ],
  [
   "水分子与反应箭头",
   "\\mathrm{H}_2\\mathrm{O}\\longrightarrow"
  ],
  [
   "长双向反应箭头",
   "\\longleftrightarrow"
  ],
  [
   "带上下说明的反应箭头",
   "\\xrightarrow[\\text{下方说明}]{\\text{上方说明}}"
  ],
  [
   "加号",
   "+"
  ],
  [
   "正负号",
   "\\pm"
  ],
  [
   "三线等号",
   "\\equiv"
  ],
  [
   "省略号（三点）",
   "\\cdots"
  ],
  [
   "减号",
   "-"
  ],
  [
   "等于号",
   "="
  ],
  [
   "三短横排版",
   "\\text{---}"
  ],
  [
   "并列等号（排版）",
   "\\mathrel{===}"
  ],
  [
   "虚线等号（近似排版）",
   "\\mathrel{\\substack{\\text{- - -}\\\\\\text{- - -}}}"
  ],
  [
   "省略号（四点）",
   "\\mathinner{\\cdotp\\cdotp\\cdotp\\cdotp}"
  ],
  [
   "钍-227（未指定电荷）",
   "{}^{227}_{90}\\mathrm{Th}"
  ],
  [
   "中子（中性）",
   "{}^{1}_{0}\\mathrm{n}"
  ],
  [
   "氚化水 HTO",
   "{}^{3}_{1}\\mathrm{H}\\mathrm{H}\\mathrm{O}"
  ]
 ]
};
export const chemicalSymbolReferenceMappings=[
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 0,
  "referenceLabel": "氢气",
  "groupId": "chem-compounds",
  "label": "氢气",
  "token": "\\ce{H2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 1,
  "referenceLabel": "二氧化碳",
  "groupId": "chem-compounds",
  "label": "二氧化碳",
  "token": "\\mathrm{CO}_2",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 2,
  "referenceLabel": "氯化氢",
  "groupId": "chem-compounds",
  "label": "盐酸中的氯化氢",
  "token": "\\mathrm{HCl}",
  "correctionNote": "HCl 表示氯化氢的组成；盐酸是其水溶液，是否标为气态或水溶液须由具体式子决定。"
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 3,
  "referenceLabel": "二氧化硫",
  "groupId": "chem-compounds",
  "label": "二氧化硫",
  "token": "\\ce{SO2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 4,
  "referenceLabel": "水",
  "groupId": "chem-compounds",
  "label": "水",
  "token": "\\mathrm{H}_2\\mathrm{O}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 5,
  "referenceLabel": "硝酸",
  "groupId": "chem-compounds",
  "label": "硝酸",
  "token": "\\mathrm{HNO}_3",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 6,
  "referenceLabel": "过氧化氢",
  "groupId": "chem-compounds",
  "label": "过氧化氢",
  "token": "\\mathrm{H}_2\\mathrm{O}_2",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 7,
  "referenceLabel": "氧化铜",
  "groupId": "chem-compounds",
  "label": "氧化铜",
  "token": "\\ce{CuO}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 8,
  "referenceLabel": "氯酸钾",
  "groupId": "chem-compounds",
  "label": "氯酸钾",
  "token": "\\ce{KClO3}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 9,
  "referenceLabel": "硫酸铜",
  "groupId": "chem-compounds",
  "label": "硫酸铜",
  "token": "\\ce{CuSO4}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 10,
  "referenceLabel": "氢氧化钙",
  "groupId": "chem-compounds",
  "label": "氢氧化钙",
  "token": "\\mathrm{Ca}(\\mathrm{OH})_2",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 11,
  "referenceLabel": "碳酸氢钠",
  "groupId": "chem-compounds",
  "label": "碳酸氢钠",
  "token": "\\ce{NaHCO3}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 12,
  "referenceLabel": "氧气",
  "groupId": "chem-compounds",
  "label": "氧气",
  "token": "\\ce{O2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 13,
  "referenceLabel": "一氧化碳",
  "groupId": "chem-compounds",
  "label": "一氧化碳",
  "token": "\\mathrm{CO}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 14,
  "referenceLabel": "氨气",
  "groupId": "chem-compounds",
  "label": "氨",
  "token": "\\mathrm{NH}_3",
  "correctionNote": "此处为氮与氢组成的氨分子；其物态需在具体化学式中注明。"
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 15,
  "referenceLabel": "硫化氢",
  "groupId": "chem-compounds",
  "label": "硫化氢",
  "token": "\\ce{H2S}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 16,
  "referenceLabel": "硫酸",
  "groupId": "chem-compounds",
  "label": "硫酸",
  "token": "\\mathrm{H}_2\\mathrm{SO}_4",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 17,
  "referenceLabel": "乙酸",
  "groupId": "chem-compounds",
  "label": "乙酸",
  "token": "\\mathrm{CH}_3\\mathrm{COOH}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 18,
  "referenceLabel": "氢氧化钙",
  "groupId": "chem-compounds",
  "label": "氢氧化钙",
  "token": "\\mathrm{Ca}(\\mathrm{OH})_2",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 19,
  "referenceLabel": "氯化氢",
  "groupId": "chem-compounds",
  "label": "盐酸中的氯化氢",
  "token": "\\mathrm{HCl}",
  "correctionNote": "HCl 表示氯化氢的组成；盐酸是其水溶液，是否标为气态或水溶液须由具体式子决定。"
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 20,
  "referenceLabel": "乙醇",
  "groupId": "chem-compounds",
  "label": "乙醇",
  "token": "\\mathrm{C}_2\\mathrm{H}_5\\mathrm{OH}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 21,
  "referenceLabel": "氢氧化钠",
  "groupId": "chem-compounds",
  "label": "氢氧化钠",
  "token": "\\mathrm{NaOH}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 22,
  "referenceLabel": "二氧化锰",
  "groupId": "chem-compounds",
  "label": "二氧化锰",
  "token": "\\ce{MnO2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 23,
  "referenceLabel": "碳酸钙",
  "groupId": "chem-compounds",
  "label": "碳酸钙",
  "token": "\\mathrm{CaCO}_3",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 24,
  "referenceLabel": "氢氧化铜",
  "groupId": "chem-compounds",
  "label": "氢氧化铜",
  "token": "\\ce{Cu(OH)2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 25,
  "referenceLabel": "氯化钠",
  "groupId": "chem-compounds",
  "label": "氯化钠",
  "token": "\\mathrm{NaCl}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 26,
  "referenceLabel": "高锰酸钾",
  "groupId": "chem-compounds",
  "label": "高锰酸钾",
  "token": "\\ce{KMnO4}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 27,
  "referenceLabel": "氧化钙",
  "groupId": "chem-compounds",
  "label": "氧化钙",
  "token": "\\ce{CaO}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 28,
  "referenceLabel": "氢氧化铁",
  "groupId": "chem-compounds",
  "label": "氢氧化铁",
  "token": "\\ce{Fe(OH)3}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 29,
  "referenceLabel": "碳酸钠",
  "groupId": "chem-compounds",
  "label": "碳酸钠",
  "token": "\\ce{Na2CO3}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 30,
  "referenceLabel": "氮气",
  "groupId": "chem-compounds",
  "label": "氮气",
  "token": "\\ce{N2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 31,
  "referenceLabel": "氯气",
  "groupId": "chem-compounds",
  "label": "氯气",
  "token": "\\ce{Cl2}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "CO化学物质",
  "referenceIndex": 32,
  "referenceLabel": "甲烷",
  "groupId": "chem-compounds",
  "label": "甲烷",
  "token": "\\mathrm{CH}_4",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 0,
  "referenceLabel": "锂离子",
  "groupId": "chem-ions",
  "label": "锂离子",
  "token": "\\ce{Li+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 1,
  "referenceLabel": "铵根离子",
  "groupId": "chem-ions",
  "label": "铵根离子",
  "token": "\\mathrm{NH}_4^{+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 2,
  "referenceLabel": "亚铁离子",
  "groupId": "chem-ions",
  "label": "亚铁离子",
  "token": "\\mathrm{Fe}^{2+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 3,
  "referenceLabel": "锌离子",
  "groupId": "chem-ions",
  "label": "锌离子",
  "token": "\\ce{Zn^2+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 4,
  "referenceLabel": "氢离子",
  "groupId": "chem-ions",
  "label": "氢离子",
  "token": "\\mathrm{H}^{+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 5,
  "referenceLabel": "氟离子",
  "groupId": "chem-ions",
  "label": "氟离子",
  "token": "\\ce{F-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 6,
  "referenceLabel": "碘离子",
  "groupId": "chem-ions",
  "label": "碘离子",
  "token": "\\ce{I-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 7,
  "referenceLabel": "氢氧根离子",
  "groupId": "chem-ions",
  "label": "氢氧根离子",
  "token": "\\mathrm{OH}^{-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 8,
  "referenceLabel": "次氯酸根离子",
  "groupId": "chem-ions",
  "label": "次氯酸根离子",
  "token": "\\ce{ClO-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 9,
  "referenceLabel": "亚硫酸根离子",
  "groupId": "chem-ions",
  "label": "亚硫酸根离子",
  "token": "\\ce{SO3^2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 10,
  "referenceLabel": "碳酸氢根离子",
  "groupId": "chem-ions",
  "label": "碳酸氢根离子",
  "token": "\\mathrm{HCO}_3^{-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 11,
  "referenceLabel": "乙酸根离子",
  "groupId": "chem-ions",
  "label": "乙酸根离子",
  "token": "\\ce{CH3COO-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 12,
  "referenceLabel": "银氨络离子",
  "groupId": "chem-ions",
  "label": "银氨络离子",
  "token": "\\ce{[Ag(NH3)2]+}",
  "correctionNote": "采用二氨合银(I)配离子，整体电荷为正一价。"
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 13,
  "referenceLabel": "钠离子",
  "groupId": "chem-ions",
  "label": "钠离子",
  "token": "\\mathrm{Na}^{+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 14,
  "referenceLabel": "钙离子",
  "groupId": "chem-ions",
  "label": "钙离子",
  "token": "\\mathrm{Ca}^{2+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 15,
  "referenceLabel": "铁离子",
  "groupId": "chem-ions",
  "label": "铁离子",
  "token": "\\mathrm{Fe}^{3+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 16,
  "referenceLabel": "银离子",
  "groupId": "chem-ions",
  "label": "银离子",
  "token": "\\mathrm{Ag}^{+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 17,
  "referenceLabel": "氯离子",
  "groupId": "chem-ions",
  "label": "氯离子",
  "token": "\\mathrm{Cl}^{-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 18,
  "referenceLabel": "氧离子",
  "groupId": "chem-ions",
  "label": "氧离子",
  "token": "\\ce{O^2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 19,
  "referenceLabel": "硝酸根离子",
  "groupId": "chem-ions",
  "label": "硝酸根离子",
  "token": "\\mathrm{NO}_3^{-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 20,
  "referenceLabel": "硫酸根离子",
  "groupId": "chem-ions",
  "label": "硫酸根离子",
  "token": "\\mathrm{SO}_4^{2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 21,
  "referenceLabel": "铬酸根离子",
  "groupId": "chem-ions",
  "label": "铬酸根离子",
  "token": "\\ce{CrO4^2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 22,
  "referenceLabel": "硫酸氢根离子",
  "groupId": "chem-ions",
  "label": "硫酸氢根离子",
  "token": "\\ce{HSO4-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 23,
  "referenceLabel": "氰根离子",
  "groupId": "chem-ions",
  "label": "氰根离子",
  "token": "\\ce{CN-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 24,
  "referenceLabel": "钾离子",
  "groupId": "chem-ions",
  "label": "钾离子",
  "token": "\\mathrm{K}^{+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 25,
  "referenceLabel": "镁离子",
  "groupId": "chem-ions",
  "label": "镁离子",
  "token": "\\mathrm{Mg}^{2+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 26,
  "referenceLabel": "铜离子",
  "groupId": "chem-ions",
  "label": "铜离子",
  "token": "\\mathrm{Cu}^{2+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 27,
  "referenceLabel": "铝离子",
  "groupId": "chem-ions",
  "label": "铝离子",
  "token": "\\mathrm{Al}^{3+}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 28,
  "referenceLabel": "溴离子",
  "groupId": "chem-ions",
  "label": "溴离子",
  "token": "\\ce{Br-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 29,
  "referenceLabel": "硫离子",
  "groupId": "chem-ions",
  "label": "硫离子",
  "token": "\\ce{S^2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 30,
  "referenceLabel": "高锰酸根离子",
  "groupId": "chem-ions",
  "label": "高锰酸根离子",
  "token": "\\mathrm{MnO}_4^{-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 31,
  "referenceLabel": "碳酸根离子",
  "groupId": "chem-ions",
  "label": "碳酸根离子",
  "token": "\\mathrm{CO}_3^{2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 32,
  "referenceLabel": "硅酸根离子",
  "groupId": "chem-ions",
  "label": "硅酸根离子",
  "token": "\\ce{SiO3^2-}",
  "correctionNote": "采用常见教学中的偏硅酸根 SiO₃²⁻；具体溶液的硅酸根物种仍与酸碱条件有关。"
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 33,
  "referenceLabel": "硫代硫酸根离子",
  "groupId": "chem-ions",
  "label": "硫代硫酸根离子",
  "token": "\\ce{S2O3^2-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "Na⁺化学离子",
  "referenceIndex": 34,
  "referenceLabel": "硫氰根离子",
  "groupId": "chem-ions",
  "label": "硫氰根离子",
  "token": "\\ce{SCN-}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 0,
  "referenceLabel": "氢",
  "groupId": "chem-elements",
  "label": "氢 H",
  "token": "\\mathrm{H}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 1,
  "referenceLabel": "铍",
  "groupId": "chem-elements",
  "label": "铍 Be",
  "token": "\\mathrm{Be}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 2,
  "referenceLabel": "氮",
  "groupId": "chem-elements",
  "label": "氮 N",
  "token": "\\mathrm{N}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 3,
  "referenceLabel": "氖",
  "groupId": "chem-elements",
  "label": "氖 Ne",
  "token": "\\mathrm{Ne}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 4,
  "referenceLabel": "铝",
  "groupId": "chem-elements",
  "label": "铝 Al",
  "token": "\\mathrm{Al}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 5,
  "referenceLabel": "硫",
  "groupId": "chem-elements",
  "label": "硫 S",
  "token": "\\mathrm{S}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 6,
  "referenceLabel": "钾",
  "groupId": "chem-elements",
  "label": "钾 K",
  "token": "\\mathrm{K}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 7,
  "referenceLabel": "钛",
  "groupId": "chem-elements",
  "label": "钛 Ti",
  "token": "\\mathrm{Ti}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 8,
  "referenceLabel": "锰",
  "groupId": "chem-elements",
  "label": "锰 Mn",
  "token": "\\mathrm{Mn}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 9,
  "referenceLabel": "镍",
  "groupId": "chem-elements",
  "label": "镍 Ni",
  "token": "\\mathrm{Ni}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 10,
  "referenceLabel": "镓",
  "groupId": "chem-elements",
  "label": "镓 Ga",
  "token": "\\mathrm{Ga}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 11,
  "referenceLabel": "硒",
  "groupId": "chem-elements",
  "label": "硒 Se",
  "token": "\\mathrm{Se}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 12,
  "referenceLabel": "铷",
  "groupId": "chem-elements",
  "label": "铷 Rb",
  "token": "\\mathrm{Rb}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 13,
  "referenceLabel": "锆",
  "groupId": "chem-elements",
  "label": "锆 Zr",
  "token": "\\mathrm{Zr}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 14,
  "referenceLabel": "锝",
  "groupId": "chem-elements",
  "label": "锝 Tc",
  "token": "\\mathrm{Tc}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 15,
  "referenceLabel": "钯",
  "groupId": "chem-elements",
  "label": "钯 Pd",
  "token": "\\mathrm{Pd}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 16,
  "referenceLabel": "铟",
  "groupId": "chem-elements",
  "label": "铟 In",
  "token": "\\mathrm{In}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 17,
  "referenceLabel": "碲",
  "groupId": "chem-elements",
  "label": "碲 Te",
  "token": "\\mathrm{Te}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 18,
  "referenceLabel": "铯",
  "groupId": "chem-elements",
  "label": "铯 Cs",
  "token": "\\mathrm{Cs}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 19,
  "referenceLabel": "铈",
  "groupId": "chem-elements",
  "label": "铈 Ce",
  "token": "\\mathrm{Ce}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 20,
  "referenceLabel": "钷",
  "groupId": "chem-elements",
  "label": "钷 Pm",
  "token": "\\mathrm{Pm}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 21,
  "referenceLabel": "钆",
  "groupId": "chem-elements",
  "label": "钆 Gd",
  "token": "\\mathrm{Gd}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 22,
  "referenceLabel": "钬",
  "groupId": "chem-elements",
  "label": "钬 Ho",
  "token": "\\mathrm{Ho}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 23,
  "referenceLabel": "镱",
  "groupId": "chem-elements",
  "label": "镱 Yb",
  "token": "\\mathrm{Yb}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 24,
  "referenceLabel": "钽",
  "groupId": "chem-elements",
  "label": "钽 Ta",
  "token": "\\mathrm{Ta}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 25,
  "referenceLabel": "锇",
  "groupId": "chem-elements",
  "label": "锇 Os",
  "token": "\\mathrm{Os}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 26,
  "referenceLabel": "金",
  "groupId": "chem-elements",
  "label": "金 Au",
  "token": "\\mathrm{Au}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 27,
  "referenceLabel": "氦",
  "groupId": "chem-elements",
  "label": "氦 He",
  "token": "\\mathrm{He}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 28,
  "referenceLabel": "硼",
  "groupId": "chem-elements",
  "label": "硼 B",
  "token": "\\mathrm{B}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 29,
  "referenceLabel": "氧",
  "groupId": "chem-elements",
  "label": "氧 O",
  "token": "\\mathrm{O}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 30,
  "referenceLabel": "钠",
  "groupId": "chem-elements",
  "label": "钠 Na",
  "token": "\\mathrm{Na}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 31,
  "referenceLabel": "硅",
  "groupId": "chem-elements",
  "label": "硅 Si",
  "token": "\\mathrm{Si}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 32,
  "referenceLabel": "氯",
  "groupId": "chem-elements",
  "label": "氯 Cl",
  "token": "\\mathrm{Cl}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 33,
  "referenceLabel": "钙",
  "groupId": "chem-elements",
  "label": "钙 Ca",
  "token": "\\mathrm{Ca}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 34,
  "referenceLabel": "钒",
  "groupId": "chem-elements",
  "label": "钒 V",
  "token": "\\mathrm{V}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 35,
  "referenceLabel": "铁",
  "groupId": "chem-elements",
  "label": "铁 Fe",
  "token": "\\mathrm{Fe}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 36,
  "referenceLabel": "铜",
  "groupId": "chem-elements",
  "label": "铜 Cu",
  "token": "\\mathrm{Cu}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 37,
  "referenceLabel": "锗",
  "groupId": "chem-elements",
  "label": "锗 Ge",
  "token": "\\mathrm{Ge}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 38,
  "referenceLabel": "溴",
  "groupId": "chem-elements",
  "label": "溴 Br",
  "token": "\\mathrm{Br}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 39,
  "referenceLabel": "锶",
  "groupId": "chem-elements",
  "label": "锶 Sr",
  "token": "\\mathrm{Sr}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 40,
  "referenceLabel": "铌",
  "groupId": "chem-elements",
  "label": "铌 Nb",
  "token": "\\mathrm{Nb}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 41,
  "referenceLabel": "钌",
  "groupId": "chem-elements",
  "label": "钌 Ru",
  "token": "\\mathrm{Ru}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 42,
  "referenceLabel": "银",
  "groupId": "chem-elements",
  "label": "银 Ag",
  "token": "\\mathrm{Ag}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 43,
  "referenceLabel": "锡",
  "groupId": "chem-elements",
  "label": "锡 Sn",
  "token": "\\mathrm{Sn}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 44,
  "referenceLabel": "碘",
  "groupId": "chem-elements",
  "label": "碘 I",
  "token": "\\mathrm{I}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 45,
  "referenceLabel": "钡",
  "groupId": "chem-elements",
  "label": "钡 Ba",
  "token": "\\mathrm{Ba}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 46,
  "referenceLabel": "镨",
  "groupId": "chem-elements",
  "label": "镨 Pr",
  "token": "\\mathrm{Pr}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 47,
  "referenceLabel": "钐",
  "groupId": "chem-elements",
  "label": "钐 Sm",
  "token": "\\mathrm{Sm}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 48,
  "referenceLabel": "铽",
  "groupId": "chem-elements",
  "label": "铽 Tb",
  "token": "\\mathrm{Tb}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 49,
  "referenceLabel": "铒",
  "groupId": "chem-elements",
  "label": "铒 Er",
  "token": "\\mathrm{Er}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 50,
  "referenceLabel": "镥",
  "groupId": "chem-elements",
  "label": "镥 Lu",
  "token": "\\mathrm{Lu}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 51,
  "referenceLabel": "钨",
  "groupId": "chem-elements",
  "label": "钨 W",
  "token": "\\mathrm{W}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 52,
  "referenceLabel": "铱",
  "groupId": "chem-elements",
  "label": "铱 Ir",
  "token": "\\mathrm{Ir}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 53,
  "referenceLabel": "汞",
  "groupId": "chem-elements",
  "label": "汞 Hg",
  "token": "\\mathrm{Hg}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 54,
  "referenceLabel": "锂",
  "groupId": "chem-elements",
  "label": "锂 Li",
  "token": "\\mathrm{Li}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 55,
  "referenceLabel": "碳",
  "groupId": "chem-elements",
  "label": "碳 C",
  "token": "\\mathrm{C}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 56,
  "referenceLabel": "氟",
  "groupId": "chem-elements",
  "label": "氟 F",
  "token": "\\mathrm{F}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 57,
  "referenceLabel": "镁",
  "groupId": "chem-elements",
  "label": "镁 Mg",
  "token": "\\mathrm{Mg}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 58,
  "referenceLabel": "磷",
  "groupId": "chem-elements",
  "label": "磷 P",
  "token": "\\mathrm{P}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 59,
  "referenceLabel": "氩",
  "groupId": "chem-elements",
  "label": "氩 Ar",
  "token": "\\mathrm{Ar}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 60,
  "referenceLabel": "钪",
  "groupId": "chem-elements",
  "label": "钪 Sc",
  "token": "\\mathrm{Sc}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 61,
  "referenceLabel": "铬",
  "groupId": "chem-elements",
  "label": "铬 Cr",
  "token": "\\mathrm{Cr}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 62,
  "referenceLabel": "钴",
  "groupId": "chem-elements",
  "label": "钴 Co",
  "token": "\\mathrm{Co}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 63,
  "referenceLabel": "锌",
  "groupId": "chem-elements",
  "label": "锌 Zn",
  "token": "\\mathrm{Zn}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 64,
  "referenceLabel": "砷",
  "groupId": "chem-elements",
  "label": "砷 As",
  "token": "\\mathrm{As}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 65,
  "referenceLabel": "氪",
  "groupId": "chem-elements",
  "label": "氪 Kr",
  "token": "\\mathrm{Kr}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 66,
  "referenceLabel": "钇",
  "groupId": "chem-elements",
  "label": "钇 Y",
  "token": "\\mathrm{Y}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 67,
  "referenceLabel": "钼",
  "groupId": "chem-elements",
  "label": "钼 Mo",
  "token": "\\mathrm{Mo}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 68,
  "referenceLabel": "铑",
  "groupId": "chem-elements",
  "label": "铑 Rh",
  "token": "\\mathrm{Rh}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 69,
  "referenceLabel": "镉",
  "groupId": "chem-elements",
  "label": "镉 Cd",
  "token": "\\mathrm{Cd}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 70,
  "referenceLabel": "锑",
  "groupId": "chem-elements",
  "label": "锑 Sb",
  "token": "\\mathrm{Sb}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 71,
  "referenceLabel": "氙",
  "groupId": "chem-elements",
  "label": "氙 Xe",
  "token": "\\mathrm{Xe}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 72,
  "referenceLabel": "镧",
  "groupId": "chem-elements",
  "label": "镧 La",
  "token": "\\mathrm{La}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 73,
  "referenceLabel": "钕",
  "groupId": "chem-elements",
  "label": "钕 Nd",
  "token": "\\mathrm{Nd}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 74,
  "referenceLabel": "铕",
  "groupId": "chem-elements",
  "label": "铕 Eu",
  "token": "\\mathrm{Eu}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 75,
  "referenceLabel": "镝",
  "groupId": "chem-elements",
  "label": "镝 Dy",
  "token": "\\mathrm{Dy}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 76,
  "referenceLabel": "铥",
  "groupId": "chem-elements",
  "label": "铥 Tm",
  "token": "\\mathrm{Tm}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 77,
  "referenceLabel": "铪",
  "groupId": "chem-elements",
  "label": "铪 Hf",
  "token": "\\mathrm{Hf}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 78,
  "referenceLabel": "铼",
  "groupId": "chem-elements",
  "label": "铼 Re",
  "token": "\\mathrm{Re}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "H化学元素",
  "referenceIndex": 79,
  "referenceLabel": "铂",
  "groupId": "chem-elements",
  "label": "铂 Pt",
  "token": "\\mathrm{Pt}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 0,
  "referenceLabel": "左箭头",
  "groupId": "chemistry",
  "label": "反应左箭头",
  "token": "\\longleftarrow",
  "correctionNote": "标准左向反应箭头，方向须与实际化学过程相符。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 1,
  "referenceLabel": "左右双向箭头",
  "groupId": "chemistry",
  "label": "双向反应箭头",
  "token": "\\leftrightarrow",
  "correctionNote": "双向箭头用于表达双向关系；平衡反应宜选用专门的可逆反应箭头。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 2,
  "referenceLabel": "可逆反应箭头",
  "groupId": "chemistry",
  "label": "可逆反应",
  "token": "\\rightleftharpoons",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 3,
  "referenceLabel": "三角形（用于化学反应）",
  "groupId": "chemistry",
  "label": "加热符号 Δ",
  "token": "\\Delta",
  "correctionNote": "此符号只标示加热条件，不提供实验温度或操作步骤。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 4,
  "referenceLabel": "向量映射（x → xi）",
  "groupId": "chemistry",
  "label": "映射示意 x↦xᵢ",
  "token": "x\\mapsto x_i",
  "correctionNote": "按数学映射排版，不额外赋予化学机理含义。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 5,
  "referenceLabel": "右箭头",
  "groupId": "chemistry",
  "label": "反应箭头",
  "token": "\\longrightarrow",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 6,
  "referenceLabel": "可逆箭头（右）",
  "groupId": "chemistry",
  "label": "可逆反应",
  "token": "\\rightleftharpoons",
  "correctionNote": "参考未指定偏向比例，此处采用标准可逆反应箭头，不表示平衡位置。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 7,
  "referenceLabel": "向下箭头",
  "groupId": "chemistry",
  "label": "沉淀生成",
  "token": "\\downarrow",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 8,
  "referenceLabel": "水分子箭头（H₂O →）",
  "groupId": "chemistry",
  "label": "水分子与反应箭头",
  "token": "\\mathrm{H}_2\\mathrm{O}\\longrightarrow",
  "correctionNote": "这是可继续编辑的化学式片段，不能单独视作完整或配平的化学反应。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 9,
  "referenceLabel": "左右双向箭头（长）",
  "groupId": "chemistry",
  "label": "长双向反应箭头",
  "token": "\\longleftrightarrow",
  "correctionNote": "双向箭头的加长排版，不额外表达平衡常数或反应速率。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 10,
  "referenceLabel": "可逆箭头（短）",
  "groupId": "chemistry",
  "label": "可逆反应",
  "token": "\\rightleftharpoons",
  "correctionNote": "使用同一标准可逆箭头，实际长度由排版器决定；不重复制造同义功能。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 11,
  "referenceLabel": "向上箭头",
  "groupId": "chemistry",
  "label": "气体生成",
  "token": "\\uparrow",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 12,
  "referenceLabel": "文本上下箭头",
  "groupId": "chemistry",
  "label": "带上下说明的反应箭头",
  "token": "\\xrightarrow[\\text{下方说明}]{\\text{上方说明}}",
  "correctionNote": "上下说明为可替换占位文字，请填写适用的反应条件。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 13,
  "referenceLabel": "加号",
  "groupId": "chemistry",
  "label": "加号",
  "token": "+",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 14,
  "referenceLabel": "正负号",
  "groupId": "chemistry",
  "label": "正负号",
  "token": "\\pm",
  "correctionNote": "数学正负选择符号；不能据此假定某种离子的实际电荷。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 15,
  "referenceLabel": "三线等号（≡）",
  "groupId": "chemistry",
  "label": "三线等号",
  "token": "\\equiv",
  "correctionNote": "仅提供三线符号排版；是否表示恒等、等价或三键应由上下文确定。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 16,
  "referenceLabel": "三线等号（反向）",
  "groupId": "chemistry",
  "label": "三线等号",
  "token": "\\equiv",
  "correctionNote": "三线等号在水平方向对称，没有单独的反向版本；沿用标准符号而不虚构化学含义。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 17,
  "referenceLabel": "省略号（三个点）",
  "groupId": "chemistry",
  "label": "省略号（三点）",
  "token": "\\cdots",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 18,
  "referenceLabel": "减号",
  "groupId": "chemistry",
  "label": "减号",
  "token": "-",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 19,
  "referenceLabel": "等于号",
  "groupId": "chemistry",
  "label": "等于号",
  "token": "=",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 20,
  "referenceLabel": "破折号（---）",
  "groupId": "chemistry",
  "label": "三短横排版",
  "token": "\\text{---}",
  "correctionNote": "按三个短横线排版，不自动解释为化学键或新的反应算符。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 21,
  "referenceLabel": "双横线（===）",
  "groupId": "chemistry",
  "label": "并列等号（排版）",
  "token": "\\mathrel{===}",
  "correctionNote": "按参考括号中的三个等号排版，并非新的化学反应算符。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 22,
  "referenceLabel": "虚线等号",
  "groupId": "chemistry",
  "label": "虚线等号（近似排版）",
  "token": "\\mathrel{\\substack{\\text{- - -}\\\\\\text{- - -}}}",
  "correctionNote": "用两排短线近似虚线等号，仅用于排版，不赋予额外化学意义。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 23,
  "referenceLabel": "省略号（四个点）",
  "groupId": "chemistry",
  "label": "省略号（四点）",
  "token": "\\mathinner{\\cdotp\\cdotp\\cdotp\\cdotp}",
  "correctionNote": ""
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 24,
  "referenceLabel": "钍-227 离子",
  "groupId": "chemistry",
  "label": "钍-227（未指定电荷）",
  "token": "{}^{227}_{90}\\mathrm{Th}",
  "correctionNote": "钍原子序数为90。参考虽称离子却未指定电荷，此处只给核素记法，不擅自附加正负电荷。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 25,
  "referenceLabel": "中子（n⁻）",
  "groupId": "chemistry",
  "label": "中子（中性）",
  "token": "{}^{1}_{0}\\mathrm{n}",
  "correctionNote": "中子不带电，不能写成 n⁻；左上1和左下0分别表示质量数与电荷数。"
 },
 {
  "referenceGroup": "化学符号",
  "referenceIndex": 26,
  "referenceLabel": "氚化水（H³HO）",
  "groupId": "chemistry",
  "label": "氚化水 HTO",
  "token": "{}^{3}_{1}\\mathrm{H}\\mathrm{H}\\mathrm{O}",
  "correctionNote": "表示一个氚原子、一个普通氢原子与一个氧原子的氚化水，而不是把氢的个数误写成3。"
 }
];
