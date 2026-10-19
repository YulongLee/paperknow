// Curated academic equations with original names and applicability notes.
// Reaction classes follow standard chemistry terminology. Atom count and net
// charge are checked for every row in research-formula-chemistry-expanded.test.
// Conceptual references: OpenStax Chemistry 2e, sections 4.2, 14.4 and 17.7.
// https://openstax.org/books/chemistry-2e/pages/4-2-classifying-chemical-reactions
// https://openstax.org/books/chemistry-2e/pages/14-4-hydrolysis-of-salts
// https://openstax.org/books/chemistry-2e/pages/17-7-electrolysis
// These symbolic relationships do not provide laboratory procedures or recipes.
export const expandedChemistryCategoryTaxonomy=[
 "其他方程式",
 "分解反应",
 "化合反应",
 "化学反应",
 "单水解",
 "双水解",
 "含氧酸不稳定性",
 "含氧酸氧化性",
 "含氧酸还原性",
 "含氧酸酸性",
 "复分解反应",
 "氨气的碱性",
 "熔融状态下的电解",
 "熔融电离",
 "电解",
 "电镀",
 "盐与盐的复分解反应",
 "盐与碱性物质的作用",
 "盐与酸性物质的作用",
 "盐的氧化性",
 "盐的电离",
 "盐的还原性",
 "碱的不稳定性",
 "碱的反应",
 "碱的电离",
 "置换反应",
 "酸的电离",
 "金属单质",
 "金属氧化物与水的作用",
 "金属氧化物与酸性物质的作用",
 "金属氧化物低价态的还原性",
 "金属氧化物的氧化性",
 "非金属单质歧化反应",
 "非金属单质氧化性",
 "非金属氢化物不稳定性",
 "非金属氢化物还原性",
 "非金属氢化物酸性",
 "非金属氧化物与水的反应",
 "非金属氧化物与碱性物质的反应",
 "非金属氧化物低价态还原性",
 "非金属氧化物氧化性"
];
const rows=[
 [
  "mg-oxygen",
  "镁与氧的化合",
  "2Mg(s) + O2(g) -> 2MgO(s)",
  "junior",
  "化合反应",
  "表示镁在氧气中反应的主要化学计量关系，实际体系需满足反应条件。",
  "化学反应,金属单质"
 ],
 [
  "c-oxygen",
  "碳的充分氧化",
  "C(s) + O2(g) -> CO2(g)",
  "junior",
  "化合反应",
  "此式对应氧气充足时生成二氧化碳的总反应。",
  "化学反应,非金属单质氧化性"
 ],
 [
  "s-oxygen",
  "硫氧化为二氧化硫",
  "S(s) + O2(g) -> SO2(g)",
  "junior",
  "化合反应",
  "仅表达充分反应后生成二氧化硫的计量关系。",
  "化学反应"
 ],
 [
  "al-oxygen",
  "铝的氧化",
  "4Al(s) + 3O2(g) -> 2Al2O3(s)",
  "high",
  "化合反应",
  "铝表面的氧化膜会影响实际反应速率。",
  "金属单质"
 ],
 [
  "cu-oxygen",
  "铜氧化为氧化铜",
  "2Cu(s) + O2(g) -> 2CuO(s)",
  "junior",
  "化合反应",
  "对应适当加热条件下形成氧化铜的教学总反应。",
  "金属单质"
 ],
 [
  "fe-sulfur",
  "铁与硫的化合",
  "Fe(s) + S(s) -> FeS(s)",
  "junior",
  "化合反应",
  "所列产物为硫化亚铁，反应需要相应能量条件。",
  "金属单质"
 ],
 [
  "kclo3-decomposition",
  "氯酸钾分解",
  "2KClO3(s) -> 2KCl(s) + 3O2(g)",
  "junior",
  "分解反应",
  "表示受热并在适当催化条件下的总体关系，不规定实验步骤。",
  "化学反应"
 ],
 [
  "kmno4-decomposition",
  "高锰酸钾受热分解",
  "2KMnO4(s) -> K2MnO4(s) + MnO2(s) + O2(g)",
  "junior",
  "分解反应",
  "对应常见教学中的受热分解反应。",
  "化学反应"
 ],
 [
  "nahco3-decomposition",
  "碳酸氢钠受热分解",
  "2NaHCO3(s) -> Na2CO3(s) + CO2(g) + H2O(g)",
  "junior",
  "分解反应",
  "此式以分解时的水蒸气表示水产物。",
  "化学反应"
 ],
 [
  "cahco3-decomposition",
  "碳酸氢钙分解",
  "Ca(HCO3)2(aq) -> CaCO3(s) + CO2(g) + H2O(l)",
  "junior",
  "分解反应",
  "受热或二氧化碳逸出可促使该过程发生。",
  "化学反应"
 ],
 [
  "mgco3-decomposition",
  "碳酸镁受热分解",
  "MgCO3(s) -> MgO(s) + CO2(g)",
  "high",
  "分解反应",
  "此式为碳酸镁热分解的主要计量关系。",
  "化学反应"
 ],
 [
  "ag2o-decomposition",
  "氧化银受热分解",
  "2Ag2O(s) -> 4Ag(s) + O2(g)",
  "high",
  "分解反应",
  "表示氧化银受热转变为金属银与氧气。",
  "化学反应"
 ],
 [
  "nano3-decomposition",
  "硝酸钠热分解",
  "2NaNO3(s) -> 2NaNO2(s) + O2(g)",
  "high",
  "分解反应",
  "对应形成亚硝酸钠的热分解阶段。",
  "化学反应"
 ],
 [
  "nh4hco3-decomposition",
  "碳酸氢铵分解",
  "NH4HCO3(s) -> NH3(g) + CO2(g) + H2O(g)",
  "high",
  "分解反应",
  "受热分解的总反应，产物以气态组分表示。",
  "化学反应"
 ],
 [
  "h2co3-decomposition",
  "碳酸的不稳定性",
  "H2CO3(aq) <=> CO2(aq) + H2O(l)",
  "junior",
  "含氧酸不稳定性",
  "溶液中的碳酸与溶解二氧化碳处于平衡；气体逸出会影响平衡。",
  "分解反应"
 ],
 [
  "hno2-decomposition",
  "亚硝酸的歧化分解",
  "2HNO2(aq) -> NO(g) + NO2(g) + H2O(l)",
  "high",
  "含氧酸不稳定性",
  "表示亚硝酸不稳定性的一种总反应，实际产物受体系条件影响。",
  "分解反应"
 ],
 [
  "hno3-decomposition",
  "硝酸的光热分解",
  "4HNO3 -> 4NO2(g) + O2(g) + 2H2O",
  "high",
  "含氧酸不稳定性",
  "硝酸在光或热作用下可发生分解；不代表实验操作方案。",
  "分解反应"
 ],
 [
  "cu-concentrated-hno3",
  "铜与浓硝酸",
  "Cu(s) + 4HNO3(aq) -> Cu(NO3)2(aq) + 2NO2(g) + 2H2O(l)",
  "high",
  "含氧酸氧化性",
  "仅适用于浓硝酸条件下以二氧化氮为主要含氮还原产物的总反应。",
  "金属单质"
 ],
 [
  "cu-dilute-hno3",
  "铜与稀硝酸",
  "3Cu(s) + 8HNO3(aq) -> 3Cu(NO3)2(aq) + 2NO(g) + 4H2O(l)",
  "high",
  "含氧酸氧化性",
  "对应稀硝酸条件，以一氧化氮为主要含氮还原产物。",
  "金属单质"
 ],
 [
  "cu-concentrated-h2so4",
  "铜与浓硫酸",
  "Cu(s) + 2H2SO4 -> CuSO4 + SO2(g) + 2H2O",
  "high",
  "含氧酸氧化性",
  "对应浓硫酸并满足适当热条件的总体关系，不能套用于稀硫酸。",
  "金属单质"
 ],
 [
  "h2so3-bromine",
  "亚硫酸被溴氧化",
  "H2SO3(aq) + Br2(aq) + H2O(l) -> H2SO4(aq) + 2HBr(aq)",
  "high",
  "含氧酸还原性",
  "亚硫酸为还原性含硫物种的简化写法，水溶液组成随酸碱条件变化。",
  "化学反应"
 ],
 [
  "hno2-chlorine",
  "亚硝酸被氯氧化",
  "HNO2(aq) + Cl2(aq) + H2O(l) -> HNO3(aq) + 2HCl(aq)",
  "high",
  "含氧酸还原性",
  "表示氮由较低氧化态转变为较高氧化态的总反应。",
  "化学反应"
 ],
 [
  "oxalate-bromine",
  "草酸被溴氧化",
  "H2C2O4(aq) + Br2(aq) -> 2CO2(g) + 2HBr(aq)",
  "university",
  "含氧酸还原性",
  "此式表达草酸的氧化还原计量关系，速率与具体体系有关。",
  "化学反应"
 ],
 [
  "phosphoric-partial-neutralization",
  "磷酸的一级中和",
  "H3PO4(aq) + NaOH(aq) -> NaH2PO4(aq) + H2O(l)",
  "high",
  "含氧酸酸性",
  "对应酸与碱一比一的计量阶段，继续中和会得到其他磷酸盐。",
  "碱的反应"
 ],
 [
  "sulfuric-neutralization",
  "硫酸的完全中和",
  "H2SO4(aq) + 2KOH(aq) -> K2SO4(aq) + 2H2O(l)",
  "junior",
  "含氧酸酸性",
  "表示硫酸两个可电离氢完全被碱中和时的总反应。",
  "复分解反应,碱的反应"
 ],
 [
  "nitric-neutralization",
  "硝酸与氢氧化钠",
  "HNO3(aq) + NaOH(aq) -> NaNO3(aq) + H2O(l)",
  "junior",
  "含氧酸酸性",
  "稀水溶液中酸与碱的中和反应。",
  "复分解反应,碱的反应"
 ],
 [
  "acetate-hydrolysis",
  "乙酸根的水解",
  "CH3COO-(aq) + H2O(l) <=> CH3COOH(aq) + OH-(aq)",
  "high",
  "单水解",
  "表示弱酸根与水的可逆反应，平衡并不意味着完全水解。",
  "其他方程式"
 ],
 [
  "ammonium-hydrolysis",
  "铵离子的水解",
  "NH4+(aq) + H2O(l) <=> NH3(aq) + H3O+(aq)",
  "high",
  "单水解",
  "以水合氢离子表示水溶液中的酸性，氨仍可参与其他平衡。",
  "其他方程式"
 ],
 [
  "carbonate-hydrolysis",
  "碳酸根的一级水解",
  "CO3^2-(aq) + H2O(l) <=> HCO3-(aq) + OH-(aq)",
  "high",
  "单水解",
  "此式表示碳酸根的第一步水解。",
  "其他方程式"
 ],
 [
  "al-first-hydrolysis",
  "铝离子的一级水解",
  "Al^3+(aq) + H2O(l) <=> AlOH^2+(aq) + H+(aq)",
  "university",
  "单水解",
  "省略配位水的简写；真实水合离子组成取决于酸度与浓度。",
  "其他方程式"
 ],
 [
  "al-bicarbonate-hydrolysis",
  "铝离子与碳酸氢根双水解",
  "Al^3+(aq) + 3HCO3-(aq) -> Al(OH)3(s) + 3CO2(g)",
  "high",
  "双水解",
  "沉淀与气体形成可推动反应；表示满足生成条件时的净离子关系。",
  "盐与盐的复分解反应"
 ],
 [
  "al-carbonate-hydrolysis",
  "铝离子与碳酸根双水解",
  "2Al^3+(aq) + 3CO3^2-(aq) + 3H2O(l) -> 2Al(OH)3(s) + 3CO2(g)",
  "high",
  "双水解",
  "不能将该体系简单写成稳定碳酸铝沉淀的生成。",
  "盐与盐的复分解反应"
 ],
 [
  "fe-bicarbonate-hydrolysis",
  "铁离子与碳酸氢根双水解",
  "Fe^3+(aq) + 3HCO3-(aq) -> Fe(OH)3(s) + 3CO2(g)",
  "high",
  "双水解",
  "在适当水溶液条件下形成氢氧化铁和二氧化碳。",
  "盐与盐的复分解反应"
 ],
 [
  "ammonia-water",
  "氨与水的碱性平衡",
  "NH3(aq) + H2O(l) <=> NH4+(aq) + OH-(aq)",
  "high",
  "氨气的碱性",
  "氨在水中表现为弱碱，电离程度有限。",
  "碱的反应"
 ],
 [
  "ammonia-hcl",
  "氨与氯化氢",
  "NH3(g) + HCl(g) -> NH4Cl(s)",
  "junior",
  "氨气的碱性",
  "此式对应气相接触后形成氯化铵的计量关系。",
  "化合反应"
 ],
 [
  "ammonia-sulfuric",
  "氨与硫酸完全反应",
  "2NH3(aq) + H2SO4(aq) -> (NH4)2SO4(aq)",
  "high",
  "氨气的碱性",
  "对应氨与硫酸二比一的计量关系。",
  "含氧酸酸性"
 ],
 [
  "molten-nacl-electrolysis",
  "熔融氯化钠电解总反应",
  "2NaCl(l) -> 2Na(l) + Cl2(g)",
  "high",
  "熔融状态下的电解",
  "熔融状态并采用相应电极体系，产物不可套用于氯化钠水溶液。",
  "电解"
 ],
 [
  "molten-mgcl2-electrolysis",
  "熔融氯化镁电解总反应",
  "MgCl2(l) -> Mg(l) + Cl2(g)",
  "high",
  "熔融状态下的电解",
  "只表示熔融盐电解的总计量关系。",
  "电解"
 ],
 [
  "molten-cacl2-electrolysis",
  "熔融氯化钙电解总反应",
  "CaCl2(l) -> Ca + Cl2(g)",
  "high",
  "熔融状态下的电解",
  "金属钙的相态随电解条件变化，此处不指定其相态。",
  "电解"
 ],
 [
  "molten-nacl-ionization",
  "氯化钠熔体中的离子",
  "NaCl(l) -> Na+ + Cl-",
  "high",
  "熔融电离",
  "式中钠离子与氯离子表示熔体组分，不能标作水溶液离子。",
  "盐的电离"
 ],
 [
  "molten-mgcl2-ionization",
  "氯化镁熔体中的离子",
  "MgCl2(l) -> Mg^2+ + 2Cl-",
  "high",
  "熔融电离",
  "仅表示熔融氯化镁的离子组成。",
  "盐的电离"
 ],
 [
  "molten-cacl2-ionization",
  "氯化钙熔体中的离子",
  "CaCl2(l) -> Ca^2+ + 2Cl-",
  "high",
  "熔融电离",
  "式中各离子为熔体组分，并非水合离子。",
  "盐的电离"
 ],
 [
  "water-electrolysis",
  "水电解的总反应",
  "2H2O(l) -> 2H2(g) + O2(g)",
  "junior",
  "电解",
  "对应适当电解条件，方程式不说明电极和电解质的具体操作。",
  "分解反应"
 ],
 [
  "water-electrolysis-cathode",
  "水溶液阴极析氢",
  "2H2O(l) + 2e- -> H2(g) + 2OH-(aq)",
  "high",
  "电解",
  "适用于以水还原析氢的阴极过程，实际竞争反应取决于电极与溶液。",
  "其他方程式"
 ],
 [
  "water-electrolysis-anode",
  "碱性介质阳极析氧",
  "4OH-(aq) -> O2(g) + 2H2O(l) + 4e-",
  "high",
  "电解",
  "此式采用碱性介质的半反应写法。",
  "其他方程式"
 ],
 [
  "alumina-carbon-anode",
  "炭阳极制铝的简化总反应",
  "2Al2O3 + 3C(s) -> 4Al(l) + 3CO2(g)",
  "high",
  "熔融状态下的电解",
  "氧化铝溶于熔融电解质且采用炭阳极的简化总反应，实际阳极气体可能更复杂。",
  "电解"
 ],
 [
  "copper-plating-cathode",
  "铜电镀阴极反应",
  "Cu^2+(aq) + 2e- -> Cu(s)",
  "high",
  "电镀",
  "仅表示铜离子在阴极的还原过程，电镀条件需由专业体系确定。",
  "电解"
 ],
 [
  "copper-plating-anode",
  "可溶铜阳极反应",
  "Cu(s) -> Cu^2+(aq) + 2e-",
  "high",
  "电镀",
  "适用于以铜为可溶阳极的对应半反应。",
  "电解"
 ],
 [
  "silver-plating-cathode",
  "银离子沉积半反应",
  "Ag+(aq) + e- -> Ag(s)",
  "high",
  "电镀",
  "表达游离银离子的计量关系；络合电镀液需要采用实际络合物半反应。",
  "电解"
 ],
 [
  "nickel-plating-cathode",
  "镍离子沉积半反应",
  "Ni^2+(aq) + 2e- -> Ni(s)",
  "high",
  "电镀",
  "表示镍离子获得电子的计量关系，不构成电镀配方。",
  "电解"
 ],
 [
  "barium-sulfate-molecular",
  "氯化钡与硫酸钠",
  "BaCl2(aq) + Na2SO4(aq) -> BaSO4(s) + 2NaCl(aq)",
  "junior",
  "盐与盐的复分解反应",
  "离子积满足沉淀条件时，生成难溶硫酸钡。",
  "复分解反应"
 ],
 [
  "silver-chloride-molecular",
  "硝酸银与氯化钠",
  "AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)",
  "junior",
  "盐与盐的复分解反应",
  "此式保留旁观离子，适用于满足沉淀生成条件的水溶液。",
  "复分解反应"
 ],
 [
  "calcium-carbonate-molecular",
  "氯化钙与碳酸钠",
  "CaCl2(aq) + Na2CO3(aq) -> CaCO3(s) + 2NaCl(aq)",
  "junior",
  "盐与盐的复分解反应",
  "水溶液中形成难溶的碳酸钙。",
  "复分解反应"
 ],
 [
  "silver-phosphate",
  "磷酸银沉淀的生成",
  "3AgNO3(aq) + Na3PO4(aq) -> Ag3PO4(s) + 3NaNO3(aq)",
  "high",
  "盐与盐的复分解反应",
  "需要满足磷酸银沉淀生成条件，酸碱度会影响磷酸根组成。",
  "复分解反应"
 ],
 [
  "copper-hydroxide-molecular",
  "硫酸铜与氢氧化钠",
  "CuSO4(aq) + 2NaOH(aq) -> Cu(OH)2(s) + Na2SO4(aq)",
  "junior",
  "盐与碱性物质的作用",
  "适用于生成氢氧化铜沉淀的水溶液条件。",
  "复分解反应,碱的反应"
 ],
 [
  "iron-hydroxide-molecular",
  "氯化铁与氢氧化钠",
  "FeCl3(aq) + 3NaOH(aq) -> Fe(OH)3(s) + 3NaCl(aq)",
  "junior",
  "盐与碱性物质的作用",
  "铁为正三价，生成的氢氧化物通常以水合沉淀存在。",
  "复分解反应,碱的反应"
 ],
 [
  "magnesium-hydroxide-molecular",
  "氯化镁与氢氧化钠",
  "MgCl2(aq) + 2NaOH(aq) -> Mg(OH)2(s) + 2NaCl(aq)",
  "junior",
  "盐与碱性物质的作用",
  "表示难溶氢氧化镁的生成。",
  "复分解反应,碱的反应"
 ],
 [
  "ammonium-base",
  "铵盐与强碱",
  "NH4Cl(aq) + NaOH(aq) -> NH3(g) + NaCl(aq) + H2O(l)",
  "high",
  "盐与碱性物质的作用",
  "在能促使氨逸出的条件下采用该总反应，封闭溶液需考虑氨的溶解平衡。",
  "复分解反应"
 ],
 [
  "carbonate-acid",
  "碳酸钠与盐酸",
  "Na2CO3(aq) + 2HCl(aq) -> 2NaCl(aq) + CO2(g) + H2O(l)",
  "junior",
  "盐与酸性物质的作用",
  "对应酸足量时的总体关系。",
  "复分解反应"
 ],
 [
  "bicarbonate-acid",
  "碳酸氢钠与盐酸",
  "NaHCO3(aq) + HCl(aq) -> NaCl(aq) + CO2(g) + H2O(l)",
  "junior",
  "盐与酸性物质的作用",
  "在可生成并逸出二氧化碳的条件下使用。",
  "复分解反应"
 ],
 [
  "calcium-carbonate-acid",
  "碳酸钙与盐酸",
  "CaCO3(s) + 2HCl(aq) -> CaCl2(aq) + CO2(g) + H2O(l)",
  "junior",
  "盐与酸性物质的作用",
  "固体碳酸钙与酸反应的常见总体关系。",
  "复分解反应"
 ],
 [
  "sulfite-acid",
  "亚硫酸钠与盐酸",
  "Na2SO3(aq) + 2HCl(aq) -> 2NaCl(aq) + SO2(g) + H2O(l)",
  "high",
  "盐与酸性物质的作用",
  "酸化并可逸出二氧化硫时的简化总反应。",
  "复分解反应"
 ],
 [
  "permanganate-iron",
  "酸性高锰酸根氧化亚铁离子",
  "MnO4-(aq) + 5Fe^2+(aq) + 8H+(aq) -> Mn^2+(aq) + 5Fe^3+(aq) + 4H2O(l)",
  "high",
  "盐的氧化性",
  "要求酸性介质；中性和碱性条件下的锰产物不同。",
  "其他方程式"
 ],
 [
  "persulfate-iodide",
  "过二硫酸根氧化碘离子",
  "S2O8^2-(aq) + 2I-(aq) -> 2SO4^2-(aq) + I2",
  "university",
  "盐的氧化性",
  "表示过二硫酸根作为氧化剂的净离子关系。",
  "其他方程式"
 ],
 [
  "copper-iodide-redox",
  "铜离子与碘离子",
  "2Cu^2+(aq) + 4I-(aq) -> 2CuI(s) + I2",
  "university",
  "盐的氧化性",
  "产物为一价铜的碘化物，而不是稳定的碘化铜水溶液。",
  "其他方程式"
 ],
 [
  "sulfite-peroxide",
  "亚硫酸盐被过氧化氢氧化",
  "Na2SO3(aq) + H2O2(aq) -> Na2SO4(aq) + H2O(l)",
  "high",
  "盐的还原性",
  "在相应水溶液条件下，硫由较低氧化态转为硫酸盐。",
  "化学反应"
 ],
 [
  "ferrous-chlorine",
  "氯化亚铁被氯气氧化",
  "2FeCl2(aq) + Cl2 -> 2FeCl3(aq)",
  "high",
  "盐的还原性",
  "此式以分子形式表达亚铁离子被氧化。",
  "化学反应"
 ],
 [
  "thiosulfate-iodine",
  "硫代硫酸根与碘",
  "2S2O3^2-(aq) + I2 -> S4O6^2-(aq) + 2I-(aq)",
  "university",
  "盐的还原性",
  "适用于碘量分析所用的相应溶液条件，不宜套用于强酸分解环境。",
  "其他方程式"
 ],
 [
  "sulfate-ionization",
  "硫酸钠在水中的电离",
  "Na2SO4(aq) -> 2Na+(aq) + SO4^2-(aq)",
  "junior",
  "盐的电离",
  "溶于水的硫酸钠按强电解质表示。",
  "其他方程式"
 ],
 [
  "nitrate-ionization",
  "硝酸钾在水中的电离",
  "KNO3(aq) -> K+(aq) + NO3-(aq)",
  "junior",
  "盐的电离",
  "表示已溶解硝酸钾的主要离子组成。",
  "其他方程式"
 ],
 [
  "ammonium-chloride-ionization",
  "氯化铵在水中的电离",
  "NH4Cl(aq) -> NH4+(aq) + Cl-(aq)",
  "high",
  "盐的电离",
  "电离与随后可能发生的铵离子水解是不同过程。",
  "其他方程式"
 ],
 [
  "cuoh2-decomposition",
  "氢氧化铜受热分解",
  "Cu(OH)2(s) -> CuO(s) + H2O(g)",
  "junior",
  "碱的不稳定性",
  "受热过程的水以气态表示，冷却后可凝结。",
  "分解反应"
 ],
 [
  "feoh3-decomposition",
  "氢氧化铁受热分解",
  "2Fe(OH)3(s) -> Fe2O3(s) + 3H2O(g)",
  "high",
  "碱的不稳定性",
  "为理想化化学式所写的分解关系，实际沉淀水合程度可能不同。",
  "分解反应"
 ],
 [
  "mgoh2-decomposition",
  "氢氧化镁受热分解",
  "Mg(OH)2(s) -> MgO(s) + H2O(g)",
  "high",
  "碱的不稳定性",
  "在满足热分解条件时适用。",
  "分解反应"
 ],
 [
  "calcium-hydroxide-hcl",
  "氢氧化钙与盐酸中和",
  "Ca(OH)2 + 2HCl(aq) -> CaCl2(aq) + 2H2O(l)",
  "junior",
  "碱的反应",
  "氢氧化钙可为悬浊或溶解状态，此处不指定其相态。",
  "复分解反应"
 ],
 [
  "aloh3-acid",
  "氢氧化铝与酸",
  "Al(OH)3(s) + 3HCl(aq) -> AlCl3(aq) + 3H2O(l)",
  "high",
  "碱的反应",
  "展示氢氧化铝的两性，酸性一侧生成铝盐。",
  "复分解反应"
 ],
 [
  "aloh3-base",
  "氢氧化铝与氢氧根",
  "Al(OH)3(s) + OH-(aq) -> Al(OH)4-(aq)",
  "high",
  "碱的反应",
  "采用水溶液中四羟基合铝酸根写法，不能与熔融偏铝酸盐写法混用。",
  "其他方程式"
 ],
 [
  "naoh-ionization",
  "氢氧化钠在水中的电离",
  "NaOH(aq) -> Na+(aq) + OH-(aq)",
  "junior",
  "碱的电离",
  "表示氢氧化钠作为强电解质的电离。",
  "其他方程式"
 ],
 [
  "baoh2-ionization",
  "氢氧化钡在水中的电离",
  "Ba(OH)2(aq) -> Ba^2+(aq) + 2OH-(aq)",
  "high",
  "碱的电离",
  "此式针对已经溶解的氢氧化钡。",
  "其他方程式"
 ],
 [
  "caoh2-ionization",
  "氢氧化钙在水中的电离",
  "Ca(OH)2(aq) -> Ca^2+(aq) + 2OH-(aq)",
  "junior",
  "碱的电离",
  "少量溶解的氢氧化钙按强电解质表示，不代表其溶解度很高。",
  "其他方程式"
 ],
 [
  "zinc-acid",
  "锌与盐酸置换",
  "Zn(s) + 2HCl(aq) -> ZnCl2(aq) + H2(g)",
  "junior",
  "置换反应",
  "适用于非氧化性酸的相应条件。",
  "金属单质"
 ],
 [
  "iron-copper-sulfate",
  "铁置换铜",
  "Fe(s) + CuSO4(aq) -> FeSO4(aq) + Cu(s)",
  "junior",
  "置换反应",
  "铁形成二价铁盐，条件需满足实际置换发生。",
  "金属单质"
 ],
 [
  "zinc-silver",
  "锌置换银",
  "Zn(s) + 2AgNO3(aq) -> Zn(NO3)2(aq) + 2Ag(s)",
  "high",
  "置换反应",
  "由金属活动性及实际溶液条件共同决定能否进行。",
  "金属单质"
 ],
 [
  "hydrogen-copper-oxide",
  "氢气还原氧化铜",
  "H2(g) + CuO(s) -> Cu(s) + H2O(g)",
  "junior",
  "置换反应",
  "对应适当热条件的还原反应，方程式不作为操作流程。",
  "金属氧化物的氧化性"
 ],
 [
  "hcl-water-ionization",
  "氯化氢向水转移质子",
  "HCl(aq) + H2O(l) -> H3O+(aq) + Cl-(aq)",
  "high",
  "酸的电离",
  "以水合氢离子写出强酸在水中的质子转移。",
  "非金属氢化物酸性"
 ],
 [
  "acetic-ionization",
  "乙酸的弱酸电离",
  "CH3COOH(aq) + H2O(l) <=> H3O+(aq) + CH3COO-(aq)",
  "high",
  "酸的电离",
  "双箭头表示乙酸只发生部分电离。",
  "含氧酸酸性"
 ],
 [
  "phosphoric-ionization",
  "磷酸的一级电离",
  "H3PO4(aq) + H2O(l) <=> H3O+(aq) + H2PO4-(aq)",
  "high",
  "酸的电离",
  "仅列第一步电离，后续仍有其他酸碱平衡。",
  "含氧酸酸性"
 ],
 [
  "magnesium-acid",
  "镁与稀硫酸",
  "Mg(s) + H2SO4(aq) -> MgSO4(aq) + H2(g)",
  "junior",
  "金属单质",
  "稀硫酸条件下的主要反应，不套用于浓硫酸。",
  "置换反应"
 ],
 [
  "aluminium-hcl",
  "铝与盐酸",
  "2Al(s) + 6HCl(aq) -> 2AlCl3(aq) + 3H2(g)",
  "high",
  "金属单质",
  "表面氧化膜影响反应起始过程，本式表示金属铝的总反应。",
  "置换反应"
 ],
 [
  "iron-hcl",
  "铁与盐酸",
  "Fe(s) + 2HCl(aq) -> FeCl2(aq) + H2(g)",
  "junior",
  "金属单质",
  "常见非氧化性酸条件下生成二价铁盐。",
  "置换反应"
 ],
 [
  "cao-water",
  "氧化钙与水",
  "CaO(s) + H2O(l) -> Ca(OH)2",
  "junior",
  "金属氧化物与水的作用",
  "产物的溶解与悬浊状态依体系组成而变。",
  "化合反应"
 ],
 [
  "na2o-water",
  "氧化钠与水",
  "Na2O(s) + H2O(l) -> 2NaOH(aq)",
  "high",
  "金属氧化物与水的作用",
  "此式针对氧化钠，不能替代过氧化钠与水的反应。",
  "化合反应"
 ],
 [
  "bao-water",
  "氧化钡与水",
  "BaO(s) + H2O(l) -> Ba(OH)2",
  "high",
  "金属氧化物与水的作用",
  "产物相态取决于水量与溶解条件。",
  "化合反应"
 ],
 [
  "feo-hcl",
  "氧化亚铁与盐酸",
  "FeO(s) + 2HCl(aq) -> FeCl2(aq) + H2O(l)",
  "high",
  "金属氧化物与酸性物质的作用",
  "铁在此反应中保持正二价。",
  "复分解反应"
 ],
 [
  "cuo-sulfuric",
  "氧化铜与硫酸",
  "CuO(s) + H2SO4(aq) -> CuSO4(aq) + H2O(l)",
  "junior",
  "金属氧化物与酸性物质的作用",
  "以碱性氧化物与酸反应生成盐和水为主要特征。",
  "复分解反应"
 ],
 [
  "alumina-hcl",
  "氧化铝与盐酸",
  "Al2O3(s) + 6HCl(aq) -> 2AlCl3(aq) + 3H2O(l)",
  "high",
  "金属氧化物与酸性物质的作用",
  "展示氧化铝两性中的酸反应一侧。",
  "复分解反应"
 ],
 [
  "ferrous-oxide-oxidation",
  "氧化亚铁氧化为氧化铁",
  "4FeO(s) + O2(g) -> 2Fe2O3(s)",
  "high",
  "金属氧化物低价态的还原性",
  "表示氧化亚铁在相应氧化条件下转为高价铁氧化物。",
  "化合反应"
 ],
 [
  "cuprous-oxide-oxidation",
  "氧化亚铜进一步氧化",
  "2Cu2O(s) + O2(g) -> 4CuO(s)",
  "high",
  "金属氧化物低价态的还原性",
  "铜由正一价升为正二价，需满足相应氧化条件。",
  "化合反应"
 ],
 [
  "cuo-carbon-monoxide",
  "一氧化碳还原氧化铜",
  "CuO(s) + CO(g) -> Cu(s) + CO2(g)",
  "junior",
  "金属氧化物的氧化性",
  "需满足相应热条件，氧化铜在反应中被还原。",
  "非金属氧化物低价态还原性"
 ],
 [
  "iron-oxide-hydrogen",
  "氢气还原氧化铁",
  "Fe2O3(s) + 3H2(g) -> 2Fe(s) + 3H2O(g)",
  "high",
  "金属氧化物的氧化性",
  "此式为最终还原至金属铁的总体关系，实际可经历中间氧化物。",
  ""
 ],
 [
  "chlorine-cold-base",
  "氯在冷稀碱中的歧化",
  "Cl2 + 2NaOH(aq) -> NaCl(aq) + NaClO(aq) + H2O(l)",
  "high",
  "非金属单质歧化反应",
  "对应冷、稀碱的常见主要产物；不能套用于热浓碱。",
  "化学反应"
 ],
 [
  "chlorine-hot-base",
  "氯在热浓碱中的歧化",
  "3Cl2 + 6NaOH -> 5NaCl + NaClO3 + 3H2O",
  "high",
  "非金属单质歧化反应",
  "对应热浓碱条件下的简化总反应，不提供任何制备参数。",
  "化学反应"
 ],
 [
  "chlorine-bromide",
  "氯氧化溴离子",
  "Cl2(aq) + 2KBr(aq) -> 2KCl(aq) + Br2(aq)",
  "high",
  "非金属单质氧化性",
  "此反应同时体现溴化物的还原性。",
  "盐的还原性"
 ],
 [
  "bromine-iodide",
  "溴氧化碘离子",
  "Br2(aq) + 2KI(aq) -> 2KBr(aq) + I2",
  "high",
  "非金属单质氧化性",
  "碘的具体相态受溶剂与碘离子含量影响。",
  "盐的还原性"
 ],
 [
  "hi-decomposition",
  "碘化氢分解平衡",
  "2HI(g) <=> H2(g) + I2(g)",
  "high",
  "非金属氢化物不稳定性",
  "此式针对气相平衡，碘的相态需与实际温度一致。",
  "分解反应"
 ],
 [
  "hydrogen-sulfide-so2",
  "硫化氢与二氧化硫",
  "2H2S(g) + SO2(g) -> 3S(s) + 2H2O",
  "high",
  "非金属氢化物还原性",
  "表示硫的不同氧化态归中为单质硫的总反应，水的相态由体系决定。",
  "非金属氧化物氧化性"
 ],
 [
  "ammonia-catalytic-oxidation",
  "氨的催化氧化总反应",
  "4NH3(g) + 5O2(g) -> 4NO(g) + 6H2O(g)",
  "high",
  "非金属氢化物还原性",
  "仅对应适当催化条件下以一氧化氮为目标产物的总反应。",
  "化学反应"
 ],
 [
  "hydrogen-sulfide-base",
  "硫化氢的一级中和",
  "H2S(aq) + OH-(aq) -> HS-(aq) + H2O(l)",
  "high",
  "非金属氢化物酸性",
  "对应一个质子被中和的计量阶段。",
  "碱的反应"
 ],
 [
  "hf-base",
  "氟化氢与氢氧根",
  "HF(aq) + OH-(aq) -> F-(aq) + H2O(l)",
  "high",
  "非金属氢化物酸性",
  "弱酸参与中和，不能将反应前的 HF 视为完全电离。",
  "碱的反应"
 ],
 [
  "so3-water",
  "三氧化硫与水",
  "SO3 + H2O -> H2SO4",
  "high",
  "非金属氧化物与水的反应",
  "方程式只表示计量关系，实际反应强烈且并不构成操作建议。",
  "化合反应"
 ],
 [
  "n2o5-water",
  "五氧化二氮与水",
  "N2O5(s) + H2O(l) -> 2HNO3(aq)",
  "high",
  "非金属氧化物与水的反应",
  "可视为酸酐与水形成相应含氧酸的关系。",
  "化合反应"
 ],
 [
  "no2-water",
  "二氧化氮与水的总反应",
  "3NO2(g) + H2O(l) -> 2HNO3(aq) + NO(g)",
  "high",
  "非金属氧化物与水的反应",
  "表示未额外引入氧气时的常见简化总反应。",
  "化学反应"
 ],
 [
  "co2-base-carbonate",
  "二氧化碳与足量强碱",
  "CO2(g) + 2NaOH(aq) -> Na2CO3(aq) + H2O(l)",
  "junior",
  "非金属氧化物与碱性物质的反应",
  "对应氢氧化钠足量时生成碳酸盐的主要总反应。",
  "化学反应,碱的反应"
 ],
 [
  "co2-base-bicarbonate",
  "二氧化碳与强碱的酸式盐阶段",
  "CO2(g) + NaOH(aq) -> NaHCO3(aq)",
  "high",
  "非金属氧化物与碱性物质的反应",
  "对应二氧化碳较充足时的酸式盐计量关系。",
  "化合反应"
 ],
 [
  "so2-base",
  "二氧化硫与强碱",
  "SO2(g) + 2NaOH(aq) -> Na2SO3(aq) + H2O(l)",
  "high",
  "非金属氧化物与碱性物质的反应",
  "氢氧化钠足量时的总反应；气体比例会影响酸式盐形成。",
  "化学反应,碱的反应"
 ],
 [
  "silica-base",
  "二氧化硅与强碱",
  "SiO2(s) + 2NaOH -> Na2SiO3 + H2O",
  "high",
  "非金属氧化物与碱性物质的反应",
  "需要相应碱性与热条件；此式不指定制备方法。",
  "化学反应"
 ],
 [
  "co-oxidation",
  "一氧化碳氧化为二氧化碳",
  "2CO(g) + O2(g) -> 2CO2(g)",
  "junior",
  "非金属氧化物低价态还原性",
  "碳从正二价升至正四价，氧气作为氧化剂。",
  "化合反应"
 ],
 [
  "so2-oxidation",
  "二氧化硫的催化氧化平衡",
  "2SO2(g) + O2(g) <=> 2SO3(g)",
  "high",
  "非金属氧化物低价态还原性",
  "为可逆反应，适当催化只能改变化学反应速率。",
  "化合反应"
 ],
 [
  "no-oxidation",
  "一氧化氮被氧氧化",
  "2NO(g) + O2(g) -> 2NO2(g)",
  "high",
  "非金属氧化物低价态还原性",
  "氮从正二价升至正四价，氧气作为氧化剂。",
  "化合反应"
 ],
 [
  "co2-carbon",
  "二氧化碳与碳的反应",
  "CO2(g) + C(s) <=> 2CO(g)",
  "high",
  "非金属氧化物氧化性",
  "高温下的气固反应平衡，二氧化碳中的碳被还原。",
  "化学反应"
 ],
 [
  "co2-magnesium",
  "镁在二氧化碳中的反应",
  "2Mg(s) + CO2(g) -> 2MgO(s) + C(s)",
  "high",
  "非金属氧化物氧化性",
  "体现活泼金属可还原二氧化碳，不能据此认为二氧化碳适用于所有金属火情。",
  "金属单质,置换反应"
 ],
 [
  "silica-carbon",
  "碳还原二氧化硅",
  "SiO2(s) + 2C(s) -> Si + 2CO(g)",
  "high",
  "非金属氧化物氧化性",
  "此为相应高温条件下的简化总反应。",
  "化学反应"
 ],
 [
  "ethanol-combustion",
  "乙醇的完全燃烧",
  "C2H5OH(l) + 3O2(g) -> 2CO2(g) + 3H2O",
  "junior",
  "其他方程式",
  "对应氧气充足时的完全氧化，水的相态随反应与冷却条件变化。",
  "化学反应"
 ],
 [
  "ethene-hydrogenation",
  "乙烯加氢",
  "C2H4(g) + H2(g) -> C2H6(g)",
  "high",
  "其他方程式",
  "需要适当催化条件，表示双键加成反应。",
  "化学反应"
 ],
 [
  "ethyl-acetate-saponification",
  "乙酸乙酯的碱性水解",
  "CH3COOC2H5 + NaOH(aq) -> CH3COONa(aq) + C2H5OH",
  "high",
  "其他方程式",
  "碱性水解以羧酸盐为产物，不与酸催化可逆水解混用。",
  "化学反应"
 ]
];
export const expandedChemistryTemplates=rows.map(([id,title,equation,level,category,description,related])=>({
 id:'chem-expanded-'+id,title,formula:'\\ce{'+equation+'}',subject:'chemistry',level,category,description,
 topics:[...new Set([category,...related.split(',').filter(Boolean)])],keywords:['化学方程式','配平',...related.split(',').filter(Boolean)]
}));
