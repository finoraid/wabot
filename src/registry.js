import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');

/** name/alias -> command */
const byName = new Map();
/** daftar unik command (untuk menu) */
const list = [];

export async function loadCommands() {
  byName.clear();
  list.length = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const exported = mod.default;
    for (const cmd of Array.isArray(exported) ? exported : [exported]) {
      if (!cmd?.name || typeof cmd.run !== 'function') {
        throw new Error(`Command tidak valid di ${file}`);
      }
      for (const n of [cmd.name, ...(cmd.aliases || [])]) {
        const key = n.toLowerCase();
        if (byName.has(key)) throw new Error(`Nama command ganda: "${key}" (${file})`);
        byName.set(key, cmd);
      }
      list.push(cmd);
    }
  }
  return list.length;
}

export const findCommand = (name) => byName.get(String(name).toLowerCase());
export const allCommands = () => list;
