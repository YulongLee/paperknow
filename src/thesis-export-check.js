// This deterministic preflight reads the exact export text. It neither edits a
// manuscript nor substitutes for research verification or rendered-page review.
const MAX_TEXT = 2_000_000;
const MAX_RANGES = 20_000;
const MAX_DETAILS = 20;
const MAX_RECORDS = 20_000;
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 200_000_000 ? value : null;
const rows = value => Array.isArray(value) ? value.slice(0, MAX_RECORDS) : [];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stripHeading = value => value.trim().replace(/^#{1,6}\s+/, '').replace(/[:：]\s*$/, '').trim();
const referenceHeading = value => /^(?:参考文献|已使用的参考文献|references|bibliography)(?:\s*[（(][^）)\n]{0,100}[）)])?$/i.test(stripHeading(value));
const excludedHeading = value => /^(?:待引用文献|参考文献整理原文|研究材料来源|引用核对提示)(?:\s|$|[（(])/u.test(stripHeading(value));
const closingHeading = value => /^(?:附录(?:\s|$|[一二三四五六七八九十A-Z\d])|致\s*谢(?:\s|$)|appendix(?:\s|$)|acknowledg(?:e)?ments?\s*$)/iu.test(stripHeading(value));

function headingLevel(value) {
 const line = value.trim();
 if (!line || line.length > 120 || /[。！？；;]/u.test(line)) return 0;
 const markdown = line.match(/^(#{1,6})\s+\S/u);
 if (markdown) return markdown[1].length;
 if (/^(?:第[一二三四五六七八九十百\d]{1,8}[章节篇]\s*\S*|[一二三四五六七八九十]{1,6}[、．]\s*\S+)/u.test(line)) return 1;
 if (/^\d{1,2}(?:\.\d{1,2}){1,3}(?:\s|[、．])\S+/u.test(line)) return line.match(/\./g).length + 1;
 if (/^\d{1,2}[、．]\s*\S+/u.test(line)) return 1;
 if (/^(?:绪论|引言|研究背景|研究方法|材料与方法|结果|讨论|结论|总结|结论与展望)$/u.test(line)) return 1;
 return 0;
}

function scanLines(text) {
 const lines = [];
 let offset = 0, section = 'body', fence = '', displayMath = '';
 for (const raw of text.split('\n')) {
  const line = raw.replace(/\r$/, ''), trimmed = line.trim(), start = offset;
  offset += raw.length + 1;
  const boundary = trimmed.match(/^(`{3,}|~{3,})/);
  if (boundary) {
   if (!fence) fence = boundary[1][0];
   else if (boundary[1][0] === fence) fence = '';
   lines.push({text: line, start, section, literal: true, heading: 0});
   continue;
  }
  let mathLine = false;
  if (!fence && (displayMath || /^\s*(?:\$\$|\\\[)/u.test(line))) {
   mathLine = true;
   if (displayMath) { if (displayMath === '$$' ? /\$\$\s*$/u.test(line) : /\\\]\s*$/u.test(line)) displayMath = ''; }
   else if (/^\s*\$\$/u.test(line)) { if (!/^\s*\$\$[\s\S]+\$\$\s*$/u.test(line)) displayMath = '$$'; }
   else if (!/\\\]\s*$/u.test(line)) displayMath = '\\[';
  }
  const literal = Boolean(fence) || mathLine || /^\s*\|.*\|\s*$/u.test(line);
  let heading = literal ? 0 : headingLevel(line);
  if (!literal) {
   if (referenceHeading(line)) { section = 'references'; heading = 1; }
   else if (excludedHeading(line)) { section = 'excluded'; heading = 1; }
   else if (section !== 'body' && (closingHeading(line) || heading)) section = 'body';
  }
  lines.push({text: line, start, section, literal, heading});
 }
 return lines;
}

function plainLine(value) {
 // Inline code and mathematical brackets are never citation evidence.
 return value.replace(/(`+)[\s\S]*?\1/g, '').replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, '').replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '');
}

function actualReferenceNumbers(lines) {
 const numbers = new Set(), duplicates = new Set();
 let entries = 0;
 for (const line of lines) {
  if (line.section !== 'references' || line.literal || line.heading) continue;
  const match = line.text.match(/^\s*\[([1-9]\d{0,3})\]\s*\S/u);
  if (!match) continue;
  const number = Number(match[1]);
  entries++;
  if (numbers.has(number)) duplicates.add(number);
  numbers.add(number);
 }
 return {numbers, duplicates, entries};
}

function possibleCitations(lines) {
 let count = 0;
 for (const line of lines) {
  if (line.section !== 'body' || line.literal || line.heading) continue;
  const plain = plainLine(line.text);
  for (const match of plain.matchAll(/\[([1-9]\d{0,3})\]/g)) {
   // array[1], x[2] and Markdown links are not even counted as candidates.
   const before = plain[match.index - 1] || '', after = plain[match.index + match[0].length] || '';
   if (/[\w$]/u.test(before) || /[([]/u.test(after)) continue;
   count++;
  }
 }
 return count;
}

function citationEvidence(text, lines, metadata) {
 const provided = Array.isArray(metadata.citationRanges);
 if (!provided) return {provided, numbers: new Set(), occurrences: 0, invalid: 0, truncated: false};
 const ranges = metadata.citationRanges, numbers = new Set(), positions = new Set(), literalRanges = new Map();
 let invalid = 0, occurrences = 0;
 // Ranges are small enough to validate separately. Binary search keeps a large
 // manuscript with many legitimate citation ranges from becoming quadratic.
 const findLine = start => {
  let left = 0, right = lines.length - 1;
  while (left <= right) {
   const mid = (left + right) >>> 1;
   if (lines[mid].start <= start) left = mid + 1;
   else right = mid - 1;
  }
  return lines[right];
 };
 for (const range of ranges.slice(0, MAX_RANGES)) {
  const start = range?.start, end = range?.end, number = range?.number;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end > text.length || !Number.isSafeInteger(number) || number < 1 || number > 9999 || end - start !== String(number).length + 2 || text.slice(start, end) !== `[${number}]`) { invalid++; continue; }
  const line = findLine(start);
  if (!line || line.section !== 'body' || line.literal || line.heading || end > line.start + line.text.length) { invalid++; continue; }
  // Provenance authorizes a source marker, but never an inline-code token or
  // formula. This mirrors the document exporter's conservative treatment.
  const local = start - line.start;
  if (!literalRanges.has(line.start)) literalRanges.set(line.start, [...line.text.matchAll(/(`+)[\s\S]*?\1|\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g)].map(match => [match.index, match.index + match[0].length]));
  const excluded = literalRanges.get(line.start).some(([from, to]) => local >= from && local < to);
  if (excluded) { invalid++; continue; }
  if (positions.has(start)) continue;
  positions.add(start); numbers.add(number); occurrences++;
 }
 return {provided, numbers, occurrences, invalid, truncated: ranges.length > MAX_RANGES};
}

function repeatedContent(lines) {
 const seenHeadings = new Set(), seenParagraphs = new Set();
 let headings = 0, paragraphs = 0, buffer = [];
 const flush = () => {
  const normalized = buffer.join(' ').replace(/\s+/gu, ' ').trim(); buffer = [];
  // Short labels, formulae and ordinary repeated terminology are not evidence
  // of a copied paragraph. Only an exact long paragraph is counted here.
  if (normalized.replace(/\s/gu, '').length < 80) return;
  if (seenParagraphs.has(normalized)) paragraphs++;
  else seenParagraphs.add(normalized);
 };
 for (const line of lines) {
  if (line.section !== 'body' || line.literal) { flush(); continue; }
  if (line.heading) {
   flush();
   const label = stripHeading(line.text).replace(/\s+/gu, ' ');
   if (seenHeadings.has(label)) headings++;
   else seenHeadings.add(label);
  } else if (!line.text.trim()) flush();
  else buffer.push(line.text);
 }
 flush();
 return {headings, paragraphs};
}

function unresolvedMarkers(lines) {
 let placeholders = 0, sources = 0;
 for (const line of lines) {
  if (line.literal || line.section !== 'body') continue;
  const value = plainLine(line.text);
  placeholders += [...value.matchAll(/(?:【|〔|\[|\{\{)\s*(?:待补充|待核对|待完善|请补充|待填写|来源待核对|文献信息待补全|草稿说明|To be supplied\b|To be verified\b|Draft note\b|TODO\b|TBD\b)[^\n\]】〕}]{0,500}(?:】|〕|\]|\}\})/giu)].length;
  sources += [...value.matchAll(/\[(?:source|资料|来源):[^\]\n]{1,200}\]/giu)].length;
 }
 return {placeholders, sources};
}

function qualityRecord(quality) {
 if (!isObject(quality)) return {state: 'not_checked', code: 'review_not_run', message: '尚无可用的全文辅助审校记录；本次只执行导出规则检查。', findings: 0, total: null, reviewed: null, complete: false, stale: false};
 const reviews = rows(quality.reviews), consistency = isObject(quality.consistency) ? quality.consistency : {};
 const findings = Math.min(200_000_000, reviews.reduce((sum, review) => sum + (Array.isArray(review?.findings) ? Math.min(review.findings.length, MAX_RECORDS) : 0), 0) + rows(consistency.findings).length);
 const coverage = isObject(quality.coverage) ? quality.coverage : {}, total = safeCount(coverage.totalCharacters), reviewed = safeCount(coverage.reviewedCharacters);
 const stale = quality.stale === true;
 const complete = quality.status === 'completed' && Array.isArray(quality.reviews) && quality.reviews.length <= MAX_RECORDS && reviews.length > 0 && reviews.every(review => review?.status === 'completed') && coverage.complete === true && total !== null && total > 0 && reviewed === total;
 if (stale) return {state: 'review_required', code: 'review_stale', message: '正文修改后尚未重新完成辅助审校；现有记录不代表当前导出版本。', findings, total, reviewed, complete: false, stale};
 if (!reviews.length && quality.status !== 'partial') return {state: 'not_checked', code: 'review_not_run', message: '没有可定位到正文范围的全文辅助审校记录，不能确认全文已检查。', findings, total, reviewed, complete: false, stale};
 if (!complete) return {state: 'review_required', code: 'review_partial', message: total !== null && reviewed !== null && reviewed <= total ? `辅助审校记录覆盖 ${reviewed} / ${total} 个正文字符；尚不能确认全文检查完成。` : '全文辅助审校尚未完整完成，或检查范围未记录；请核对已完成的审校记录。', findings, total, reviewed, complete, stale};
 if (findings || reviews.some(review => review?.outcome === 'review_required') || consistency.status === 'review_required') return {state: 'review_required', code: 'review_findings', message: findings ? `现有审校记录有 ${findings} 项待核对建议，请结合原文确认。` : '现有辅助审校标记为需核对，请查看生成检查记录后确认。', findings, total, reviewed, complete, stale};
 return {state: 'passed', code: 'review_record_complete', message: `现有辅助审校记录覆盖 ${reviewed} / ${total} 个正文字符，未列出待核对建议；不代表研究事实已核实。`, findings, total, reviewed, complete, stale};
}

/**
 * Audit exact thesis export text without changing input or contacting services.
 * `metadata.citationRanges` must be ranges from thesisDocumentPresentation.
 * Bracketed numbers alone never authorize a citation relationship.
 * A passed status is limited to these rules and the existing review record;
 * page layout, citation claim support and research facts are outside its scope.
 */
export function auditThesisExport({text, metadata = {}, templateProfile = null, quality = null} = {}) {
 const actual = typeof text === 'string' ? text : '', limited = actual.length > MAX_TEXT, value = limited ? actual.slice(0, MAX_TEXT) : actual;
 const data = isObject(metadata) ? metadata : {}, lines = scanLines(value), references = actualReferenceNumbers(lines), evidence = citationEvidence(value, lines, data), duplicates = repeatedContent(lines), markers = unresolvedMarkers(lines), review = qualityRecord(quality), checks = [], warnings = [];
 const add = (id, label, status, message, extra = {}) => {
  checks.push({id, label, status, message, ...extra});
  if (status !== 'passed') warnings.push({code: id, message, ...(Number.isSafeInteger(extra.count) ? {count: extra.count} : {})});
 };
 const characters = value.length, nonWhitespaceCharacters = value.replace(/\s/gu, '').length;
 const bodyCharacters = lines.filter(line => line.section === 'body' && !line.heading && line.text.trim() !== String(data.title || '').trim()).map(line => line.text).join('').replace(/\s/gu, '').length;
 add('body_present', '正文内容', bodyCharacters ? 'passed' : 'review_required', bodyCharacters ? `已读取本次导出的 ${characters} 个字符。` : '本次导出没有可检查的正文。', {count: characters});
 if (lines.some(line => !line.literal && line.text.trim() === '部分章节尚未完成')) add('incomplete_manuscript', '论文章节完整性', 'review_required', '当前导出正文标记为部分章节尚未完成；请核对章节后再作为完整论文交付。', {count: 1});
 if (limited) add('audit_scope', '检查范围', 'review_required', `正文超过 ${MAX_TEXT} 个字符，本次仅检查前 ${MAX_TEXT} 个字符，不能据此确认全文。`, {count: MAX_TEXT});
 add('unresolved_placeholders', '待补充标记', markers.placeholders ? 'review_required' : 'passed', markers.placeholders ? `正文有 ${markers.placeholders} 处待补充或待核对标记，请补齐后再交付。` : '未发现明确的待补充或待核对占位标记。', {count: markers.placeholders});
 add('unresolved_sources', '来源标记', markers.sources ? 'review_required' : 'passed', markers.sources ? `正文有 ${markers.sources} 处未编排的来源标记，请核对参考文献后再交付。` : '未发现未编排的来源标记。', {count: markers.sources});
 const missing = [...evidence.numbers].filter(number => !references.numbers.has(number)).sort((a, b) => a - b);
 if (evidence.provided) add('citation_mapping', '正文引用与文献编号', missing.length ? 'review_required' : 'passed', missing.length ? `${missing.length} 个正文引用编号没有对应的已使用参考文献。` : evidence.occurrences ? `已核对 ${evidence.occurrences} 处有来源记录的正文引用，编号均有对应题录；未核实引文是否支持论点。` : '当前没有带来源记录的正文引用，未把普通数字方括号视为文献索引。', {count: missing.length, details: {citationOccurrences: evidence.occurrences, missingReferenceNumbers: missing.slice(0, MAX_DETAILS), truncated: missing.length > MAX_DETAILS}});
 else {
  const possible = possibleCitations(lines);
  add('citation_mapping', '正文引用与文献编号', 'not_checked', possible ? '正文含可能的数字索引，但没有对应来源记录；本次未将数组、公式等方括号内容认定为文献引用。' : '当前没有可核对的正文引用来源记录，未执行引文与题录对应检查。', {count: 0, details: {possibleCitationOccurrences: possible}});
 }
 if (evidence.invalid || evidence.truncated) add('citation_provenance', '引用来源记录范围', 'review_required', evidence.truncated ? '引用来源记录超过本次检查上限，未能完整核对；请检查文献索引。' : `有 ${evidence.invalid} 条引用来源记录与当前正文位置不一致，请核对文献索引。`, {count: evidence.invalid});
 add('reference_number_duplicates', '文献编号唯一性', references.duplicates.size ? 'review_required' : 'passed', references.duplicates.size ? `${references.duplicates.size} 个参考文献编号重复，请核对题录列表。` : '已使用参考文献列表未发现重复编号。', {count: references.duplicates.size, details: {numbers: [...references.duplicates].sort((a, b) => a - b).slice(0, MAX_DETAILS)}});
 if (references.entries && evidence.provided && !evidence.occurrences) add('references_not_cited', '文献使用情况', 'review_required', `参考文献列表有 ${references.entries} 条记录，但当前没有可核对的正文引用；请核对是否实际使用。`, {count: references.entries});
 add('duplicate_paragraphs', '重复段落', duplicates.paragraphs ? 'review_required' : 'passed', duplicates.paragraphs ? `发现 ${duplicates.paragraphs} 处完全相同的较长段落，请核对是否误粘贴；这不是数据库查重。` : '未发现完全相同的较长段落；本检查不代表外部文献查重。', {count: duplicates.paragraphs});
 add('duplicate_headings', '重复标题', duplicates.headings ? 'review_required' : 'passed', duplicates.headings ? `发现 ${duplicates.headings} 处完全相同的章节标题，请核对章节结构。` : '未发现完全相同的章节标题。', {count: duplicates.headings});
 if (isObject(templateProfile)) {
  const unresolved = rows(templateProfile.unresolved).length, notices = rows(templateProfile.warnings).length;
  const usable = templateProfile.version === 1 && isObject(templateProfile.rules);
  add('template_rules', '模板识别记录', !usable ? 'not_checked' : unresolved || notices ? 'review_required' : 'passed', !usable ? '未读取到完整的模板规则识别记录，请核对所选模板。' : unresolved || notices ? `模板识别有 ${unresolved} 项未识别规则、${notices} 项提示，请核对模板识别结果与导出页面。` : '已读取模板识别记录；实际分页与视觉排版仍需检查。', {count: unresolved + notices, details: {unresolved, notices}});
 }
 add('existing_review', '全文辅助审校记录', review.state, review.message, {count: review.findings, details: {complete: review.complete, stale: review.stale, reviewedCharacters: review.reviewed, totalCharacters: review.total}});
 const requiresReview = checks.some(check => check.status !== 'passed'), reviewCount = checks.filter(check => check.status !== 'passed').length;
 return {
  version: 1,
  status: requiresReview ? 'review_required' : 'passed',
  checks,
  warnings,
  summary: requiresReview ? `本次导出规则检查完成，有 ${reviewCount} 项需要核对；正文未被修改。` : '本次导出规则检查未发现上述问题，现有辅助审校记录完整；正文未被修改。',
  checkedCharacters: characters,
  counts: {nonWhitespaceCharacters, bodyCharacters, referenceEntries: references.entries, citationOccurrences: evidence.occurrences, unresolvedPlaceholders: markers.placeholders, unresolvedSources: markers.sources, duplicateParagraphs: duplicates.paragraphs, duplicateHeadings: duplicates.headings, existingReviewFindings: review.findings},
  scope: {completeText: !limited, content: 'deterministic_rules', facts: 'not_verified', citationSupport: 'not_verified', layout: 'not_rendered', modelReview: 'existing_record_only', existingReviewComplete: review.complete, existingReviewStale: review.stale},
 };
}
