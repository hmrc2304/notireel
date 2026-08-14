/**
 * Carga de credenciales. Lee .env local y, si falta algo, cae a ~/.env.apihub.
 * Parser propio: los .env de esta máquina vienen con CRLF y \r rompe los valores.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * ¿Este módulo se está ejecutando directamente?
 * Contempla que argv[1] no exista (por ejemplo bajo `node -e`), que si no
 * pathToFileURL revienta.
 */
export function esPrincipal(metaUrl) {
  if (!process.argv[1]) return false;
  return metaUrl === pathToFileURL(process.argv[1]).href;
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parsear(archivo) {
  if (!fs.existsSync(archivo)) return {};
  const out = {};
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 1) continue;
    const clave = l.slice(0, i).trim();
    const valor = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (valor) out[clave] = valor;
  }
  return out;
}

const local = parsear(path.join(RAIZ, '.env'));
const hub = parsear(path.join(os.homedir(), '.env.apihub'));

/**
 * Limpia lo que suele ensuciar un valor de entorno sin que se vea:
 * el BOM que PowerShell mete al escribir por pipe (queda dentro del secret de
 * GitHub y revienta la cabecera HTTP con "character at index 0 has a value of
 * 65279"), el \r de los archivos con CRLF, las comillas y los espacios.
 */
function limpiar(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/^﻿/, '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '');
}

/** El entorno real (GitHub Actions) gana siempre; después el .env local; último el hub. */
export function env(clave, obligatoria = true) {
  const v = limpiar(process.env[clave]) || local[clave] || hub[clave];
  if (!v && obligatoria) throw new Error(`Falta la variable ${clave} (.env del proyecto o ~/.env.apihub)`);
  return v;
}

export const DIRS = {
  raiz: RAIZ,
  assets: path.join(RAIZ, 'assets'),
  salida: path.join(RAIZ, 'salida'),
  temp: path.join(RAIZ, 'salida', '.temp'),
};

for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
