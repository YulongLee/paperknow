// Historical record helper. Membership pages exclusively use the signed-in cloud service.
export function membershipSnapshot({projectRows=[],drafts=[],papers=[],reports=[],reportError=false}={}){
 // Persisted local records are not requests, credits or billable usage.
 return {projects:projectRows.length,assets:reportError?null:drafts.length+reports.length,papers:papers.length,reports:reportError?null:reports.length};
}
