import { readFileSync } from 'fs';
const s = readFileSync('src/App.jsx', 'utf8');
function count(ch) { let c = 0; for (let i = 0; i < s.length; i++) { if (s[i] === ch && s[i - 1] !== '\\') c++; } return c }
console.log('single', count("'"), 'double', count('"'), 'back', count('`'));
