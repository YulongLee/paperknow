import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-export-metadata.mjs';
import {auditThesisSubmission} from '../src/thesis-export-check.js';
import {displayedTableExtremaConflicts} from './manuscript-table-facts.mjs';

// The same content gates used by the DOCX client run before author confirmation.
// Native page layout remains a separate, mandatory step after confirmation.
export function completionContentAudit(snapshot,chapters,quality,row){
 const item={title:snapshot.title,snapshot,chapters,exportMetadata:JSON.parse(row.export_metadata||'{}')};
 const text=presentThesisDocument(snapshot,chapters,{title:snapshot.title,submission:true}),metadata=thesisExportMetadata(item,{submission:true});
 const report=auditThesisSubmission({text,metadata,quality});
 // Re-run the local table gate against current text, including older saved
 // reviews. A previously successful AI review cannot hide a new exact check.
 const numeric=chapters.flatMap(chapter=>displayedTableExtremaConflicts(String(chapter.text||'')).map(issue=>({code:'displayed_table_extrema_conflict',message:(chapter.title||'正文')+'：'+issue.quote+'，与表 '+issue.table+' 的逐列展示值不一致，请核对 '+issue.conflicts.map(c=>c.column).join('、')+'。'})));
 return {ready:report.submission.ready&&!numeric.length,issues:[...report.submission.issues,...numeric]};
}
