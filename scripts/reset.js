// Borra la base y las fotos; al próximo `npm start` se regeneran los datos de ejemplo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.rmSync(dir, { recursive: true, force: true });
console.log('Datos borrados:', dir);
