import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/precheck/assets',{recursive:true});
await build({entryPoints:['src/precheck/parsers.js'],bundle:true,platform:'browser',format:'esm',minify:true,target:'es2022',outfile:'dist/precheck/assets/parsers.js',legalComments:'eof'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/precheck/assets/pdf.worker.min.mjs');
console.log('PaperKnow document parser built.');
await mkdir('dist/workspace/assets',{recursive:true});
await build({entryPoints:['src/presentation-export.js'],bundle:true,platform:'browser',format:'esm',minify:true,target:'es2022',outfile:'dist/workspace/assets/presentation-export.js',legalComments:'eof'});
await build({entryPoints:['src/format-document.js'],bundle:true,platform:'browser',format:'esm',minify:true,target:'es2022',outfile:'dist/workspace/assets/format-document.js',legalComments:'eof'});
