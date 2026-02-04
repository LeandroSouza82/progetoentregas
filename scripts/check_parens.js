
const fs = require('fs');
const content = fs.readFileSync('c:/progetoentregas/src/App.jsx', 'utf8');
const lines = content.split('\n');

let balance = 0;
let inString = null;
let inComment = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (inComment) {
            if (char === '*' && line[j+1] === '/') { inComment = false; j++; }
            continue;
        }
        if (char === '/' && line[j+1] === '/') break;
        if (char === '/' && line[j+1] === '*') { inComment = true; j++; continue; }
        if (inString) {
            if (char === inString && line[j-1] !== '\\') inString = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') { inString = char; continue; }

        if (char === '(') balance++;
        if (char === ')') {
            balance--;
            if (balance < 0) {
                console.log(`NEGATIVE PAREN BALANCE at Line ${i+1}, Col ${j+1}: ${line}`);
                balance = 0; // Reset to find more
            }
        }
    }
}
