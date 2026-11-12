// Quote previews contain only the fields needed to choose a service and price.
export function toolQuotePreview({kind,operation,snapshot={}}){
 const c=snapshot.context||{},materials=Array.isArray(snapshot.materials)?snapshot.materials:[];
 return {kind,operation,mode:String(snapshot.mode||''),characters:Array.from(String(snapshot.text||'').trim()).length,materialCharacters:materials.reduce((n,m)=>n+Array.from(String(m.text||'').trim()).length,0),pages:Number(c.pages||0),documentCharacters:Number(c.documentCharacters||0),plan:String(c.plan||''),revisionProductMode:String(c.revisionProduct?.mode||''),revisionProductKind:String(c.revisionProduct?.kind||'')};
}
