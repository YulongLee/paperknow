import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/precheck/assets',{recursive:true});
await build({entryPoints:['src/precheck/parsers.js'],bundle:true,platform:'browser',format:'esm',minify:true,target:'es2022',outfile:'dist/precheck/assets/parsers.js',legalComments:'eof'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/precheck/assets/pdf.worker.min.mjs');
console.log('PaperKnow document parser built.');
