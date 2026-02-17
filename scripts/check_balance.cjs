const fs = require('fs');
const s = fs.readFileSync('src/App.jsx', 'utf8');
let brace = 0, paren = 0, bracket = 0;
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
  if (ch=='{') brace++; if (ch=='}') brace--; if (ch=='(') paren++; if (ch==')') paren--; if (ch=='[') bracket++; if (ch==']') bracket--;
  if (brace<0||paren<0||bracket<0){
    console.log('Negative balance at index', i, 'char', ch, 'line', s.slice(0,i).split('\n').length);
    console.log('context:\n', s.slice(Math.max(0,i-120), i+120));
    process.exit(0);
  }
}
console.log('End balances: brace=', brace, 'paren=', paren, 'bracket=', bracket);
const lines = s.split('\n');
const lineno = 2688;
console.log('line', lineno, ':', lines[lineno-1]||'');
console.log('prev 12 lines:'); for(let j=Math.max(0,lineno-13); j<lineno-1; j++) console.log((j+1)+':', lines[j]);
