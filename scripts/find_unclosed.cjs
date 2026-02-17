const fs = require('fs');
const s = fs.readFileSync('src/App.jsx', 'utf8');
const open_map = { '{': '}', '(': ')', '[': ']' };
let stack = [];
let inSingle=false, inDouble=false, inBack=false, inLine=false, inBlock=false;
for (let i=0;i<s.length;i++){
  const ch = s[i];
  const prev = s[i-1]||'';
  if (!inLine && !inBlock && ch=='"' && !inSingle && !inBack && prev!='\\') inDouble=!inDouble;
  if (!inLine && !inBlock && ch=="'" && !inDouble && !inBack && prev!='\\') inSingle=!inSingle;
  if (!inLine && !inBlock && ch=='`' && !inSingle && !inDouble && prev!='\\') inBack=!inBack;
  if (!inSingle && !inDouble && !inBack && ch=='/' && s[i+1]=='/') inLine=true;
  if (!inSingle && !inDouble && !inBack && ch=='/' && s[i+1]=='*') inBlock=true;
  if (inLine && ch=='\n') inLine=false;
  if (inBlock && ch=='*' && s[i+1]=='/') { inBlock=false; i++; continue; }
  if (inSingle || inDouble || inBack || inLine || inBlock) continue;
  if (open_map[ch]) stack.push({ch, i});
  else if (ch==='}'||ch===')'||ch===']'){
    const last = stack[stack.length-1];
    if (!last) { console.log('Unmatched closing', ch, 'at', i); process.exit(2); }
    const expected = open_map[last.ch];
    if (expected !== ch) { console.log('Mismatched at', i, 'found', ch, 'expected', expected); process.exit(3); }
    stack.pop();
  }
}
console.log('Stack length:', stack.length);
console.log(stack.slice(-10).map(x => `${x.ch}@${x.i}`).join('\n'));
if (stack.length>0){
  const last = stack[stack.length-1];
  const snippet = s.slice(Math.max(0,last.i-120), Math.min(s.length, last.i+120));
  console.log('Last open at', last.i, 'char', last.ch, 'context:\n', snippet);
}
