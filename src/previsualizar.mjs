/**
 * Rehace el video de una noticia ya procesada usando los temporales que quedaron
 * en salida/.temp (foto, mp3 y ass). Sirve para iterar el diseño sin volver a
 * gastar créditos de locución en cada prueba.
 *
 *   node src/previsualizar.mjs 7dd39a92 [avatar]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DIRS } from './config.mjs';
import { componer } from './video.mjs';

const id = process.argv[2];
const avatar = process.argv[3] ?? 'ana';
if (!id) throw new Error('Falta el id corto. Ej: node src/previsualizar.mjs 7dd39a92');

const base = path.join(DIRS.temp, id);
for (const ext of ['.mp3', '.ass']) {
  if (!fs.existsSync(base + ext)) throw new Error(`Falta ${base + ext}`);
}

// Si en la corrida original la imagen de la nota se descartó y se generó una
// propia, hay que reusar esa: la .jpg original es justamente la que no servía.
const foto = fs.existsSync(`${base}-propia.png`) ? `${base}-propia.png` : `${base}.jpg`;
if (!fs.existsSync(foto)) throw new Error(`Falta la imagen de fondo (${foto})`);

const dur = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${base}.mp3`])
    .toString().trim(),
);

const destino = path.join(DIRS.salida, `${id}.mp4`);
componer({
  foto,
  marco: path.join(DIRS.assets, `marco-${avatar}.png`),
  mp3: `${base}.mp3`,
  ass: `${base}.ass`,
  destino,
  duracion: dur,
});

console.log(`Listo: ${destino} (${(fs.statSync(destino).size / 1024 / 1024).toFixed(1)} MB)`);
export {};
