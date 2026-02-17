import { readFileSync } from 'fs';
const s = readFileSync('src/App.jsx', 'utf8');
let inS = false, inD = false, inT = false, inC = false;
let paren = 0, brack = 0, brace = 0;
let line = 1;
let currLine = 1; let firstNeg = null; for (let i = 0; i < s.length; i++) {
    const ch = s[i]; const nxt = s[i + 1] || '';
    if (ch === '\n') currLine++;
    if (!inC && ch === '/' && nxt === '*') { inC = true; i++; continue; }
    if (inC && ch === '*' && nxt === '/') { inC = false; i++; continue; }
    if (!inS && !inD && !inT && ch === "'" && s[i - 1] !== '\\') { inS = true; continue; }
    if (inS && ch === "'" && s[i - 1] !== '\\') { inS = false; continue; }
    if (!inS && !inD && !inT && ch === '"' && s[i - 1] !== '\\') { inD = true; continue; }
    if (inD && ch === '"' && s[i - 1] !== '\\') { inD = false; continue; }
    if (!inS && !inD && !inT && ch === '`' && s[i - 1] !== '\\') { inT = true; continue; }
    if (inT && ch === '`' && s[i - 1] !== '\\') { inT = false; continue; }
    if (inS || inD || inT || inC) continue;
    if (ch === '(') { paren++; }
    if (ch === ')') { paren--; if (paren < 0 && !firstNeg) { firstNeg = { type: ')', line: currLine, i }; } }
    if (ch === '[') { brack++; }
    if (ch === ']') { brack--; if (brack < 0 && !firstNeg) { firstNeg = { type: ']', line: currLine, i }; } }
    if (ch === '{') { brace++; }
    if (ch === '}') { brace--; if (brace < 0 && !firstNeg) { firstNeg = { type: '}', line: currLine, i }; } }
}
if (firstNeg) { console.error('First negative for', firstNeg.type, 'at line', firstNeg.line); process.exit(3); } console.log('paren', paren, 'brack', brack, 'brace', brace); if (paren !== 0 || brack !== 0 || brace !== 0) { console.error('Unbalanced counts at end'); process.exit(2); } console.log('All balanced');
