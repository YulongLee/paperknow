import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-export-metadata.mjs';
import {auditThesisSubmission} from '../src/thesis-export-check.js';

// The same content gates used by the DOCX client run before author confirmation.
// Native page layout remains a separate, mandatory step after confirmation.
export function completionContentAudit(snapshot,chapters,quality,row){
 const item={title:snapshot.title,snapshot,chapters,exportMetadata:JSON.parse(row.export_metadata||'{}')};
 const text=presentThesisDocument(snapshot,chapters,{title:snapshot.title,submission:true}),metadata=thesisExportMetadata(item,{submission:true});
 const report=auditThesisSubmission({text,metadata,quality});
 return {ready:report.submission.ready,issues:report.submission.issues};
}
