// Quoting happens behind the existing action. Cached results and active tasks
// return their original job without reserving another allowance or credit.
export async function submitDocumentTranslation(request,input,{onQuote=()=>{}}={}){
 const {fileId,sourceLanguage,targetLanguage,expectedUserId}=input;
 const quote=await request('/document-translations/quote',{fileId,sourceLanguage,targetLanguage,expectedUserId});
 if(quote.existingJobId)return{id:quote.existingJobId,reused:true};
 onQuote(quote);
 if(typeof quote.token!=='string'||!quote.token)throw Error('文献研读计费信息未取得，请稍后重试');
 return request('/document-translations',{...input,billingToken:quote.token});
}
