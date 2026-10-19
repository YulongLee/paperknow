import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';

// The client and admission/dispatch boundaries share one catalog. Work names
// and client-supplied labels never choose the scientific figure instructions.
const catalogs=new Map(['basic','professional'].map(mode=>[mode,new Map(researchFigureChoices(mode).map(item=>[item.categoryId+'\0'+item.id,Object.freeze({...item})]))]));
export function researchFigureSelection(snapshot){
 const mode=snapshot?.mode,context=snapshot?.context;
 if(!catalogs.has(mode)||!context||typeof context!=='object'||Array.isArray(context)||typeof context.categoryId!=='string'||typeof context.figureType!=='string')return null;
 return catalogs.get(mode).get(context.categoryId+'\0'+context.figureType)||null;
}
