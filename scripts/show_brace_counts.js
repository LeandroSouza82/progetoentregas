import { readFileSync } from 'fs';
const s = readFileSync('src/App.jsx', 'utf8');
let inS = false, inD = false, inT = false, inC = false;
let brace = 0;
const lines = s.split('\n');
for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]; const nxt = line[i + 1] || '';
        if (!inC && ch === '/' && nxt === '*') { inC = true; i++; continue; }
        if (inC && ch === '*' && nxt === '/') { inC = false; i++; continue; }
        if (!inS && !inD && !inT && ch === "'" && line[i - 1] !== '\\') { inS = true; continue; }
        if (inS && ch === "'" && line[i - 1] !== '\\') { inS = false; continue; }
        if (!inS && !inD && !inT && ch === '"' && line[i - 1] !== '\\') { inD = true; continue; }
        if (inD && ch === '"' && line[i - 1] !== '\\') { inD = false; continue; }
        if (!inS && !inD && !inT && ch === '`' && line[i - 1] !== '\\') { inT = true; continue; }
        if (inT && ch === '`' && line[i - 1] !== '\\') { inT = false; continue; }
        if (inS || inD || inT || inC) continue;
        if (ch === '{') brace++;
        if (ch === '}') brace--;
    }
    if (brace < 0) { console.log('NEGATIVE at line', li + 1, ' =>', line); break; }
}
console.log('final brace count', brace);
