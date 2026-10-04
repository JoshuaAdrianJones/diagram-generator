import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = existsSync(path.resolve(here, '../package.json')) ? path.resolve(here, '..') : path.resolve(here, '../..');
export const dataRoot = () => {
  let installed:string|undefined;
  try{installed=JSON.parse(readFileSync(path.join(appRoot,'.installation.json'),'utf8')).dataPath}catch{}
  return path.resolve(process.env.SKETCH_DIAGRAM_DATA || installed || path.join(homedir(), 'Library/Application Support/sketch-diagram'));
};
export const browserPath = () => process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(appRoot, '.local/browsers');
export async function readJson<T = any>(filename: string): Promise<T> { return JSON.parse(await readFile(filename, 'utf8')); }
export async function atomicJson(filename: string, value: unknown) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, filename);
}
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
