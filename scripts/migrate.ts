import { readFileSync } from 'node:fs';
import { sql } from '../src/db.js';

const statements = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) await sql().query(statement);
console.log(`✅ applied ${statements.length} statements`);
