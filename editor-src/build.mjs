import {build} from 'esbuild';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
await build({entryPoints:['editor-src/editor.js'],bundle:true,minify:true,format:'iife',
  outfile:'mock-exam/assets/exam-app/editor.bundle.js',legalComments:'inline'});
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const sections=[];
for(const [path,pkg] of Object.entries(lock.packages)){
  if(!path||pkg.dev||pkg.optional)continue;
  const name=path.split('node_modules/').pop();
  const license=['LICENSE','LICENSE.txt','LICENSE.md','license'].map(n=>`${path}/${n}`).find(existsSync);
  if(!license)throw Error(`Missing license: ${name}`);
  sections.push(`${name} ${pkg.version}\n${readFileSync(license,'utf8')}`);
}
writeFileSync('mock-exam/assets/exam-app/THIRD_PARTY_NOTICES.txt',sections.join('\n\n---\n\n'));
