/**
 * Busca notas con la imagen rota y les genera una propia.
 *
 * "Rota" es cualquiera de estas: sin imagen, o apuntando a un servidor ajeno que
 * no la entrega (varios medios bloquean el enlace directo). Una imagen rota en la
 * portada es lo primero que ve el visitante.
 *
 *   node src/reparar-imagenes.mjs           lista las rotas
 *   node src/reparar-imagenes.mjs --aplicar las repara
 */

import path from 'node:path';
import { env, DIRS, esPrincipal } from './config.mjs';
import { subirImagen } from './sitio.mjs';
import { generarPortada } from './imagen.mjs';

const aplicar = process.argv.includes('--aplicar');
const URL_BASE = env('SUPABASE_NOTIREEL_URL');
const CLAVE = env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, { ...opciones, headers: { ...cab, ...opciones.headers } });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** ¿La imagen carga de verdad? Una URL guardada no garantiza que responda. */
async function cargable(url) {
  if (!url) return false;
  // Lo que vive en nuestro bucket siempre carga; el resto hay que probarlo.
  if (url.startsWith(URL_BASE)) return true;
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'user-agent': 'notireel/1.0' } });
    return res.ok;
  } catch {
    return false;
  }
}

const notas = await pedir('notas?select=id,slug,titular,bajada,imagen_url&order=publicada_en.desc');
const rotas = [];

for (const n of notas) {
  if (!(await cargable(n.imagen_url))) rotas.push(n);
}

console.log(`${notas.length} notas · ${rotas.length} con la imagen rota\n`);
for (const n of rotas) {
  console.log(`  ${n.titular.slice(0, 62)}`);
  console.log(`    ${n.imagen_url ? n.imagen_url.slice(0, 70) : '(sin imagen)'}\n`);
}

if (!rotas.length) {
  console.log('Nada que reparar.');
} else if (!aplicar) {
  console.log('Corré con --aplicar para generarles una imagen propia.');
} else {
  for (const n of rotas) {
    console.log(`Reparando: ${n.titular.slice(0, 54)}`);
    const propia = await generarPortada(n, path.join(DIRS.temp, `reparar-${n.slug.slice(0, 20)}.png`));
    const url = await subirImagen(propia, n.slug);
    await pedir(`notas?id=eq.${n.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ imagen_url: url, imagen_generada: true, actualizada_en: new Date().toISOString() }),
    });
    console.log(`  lista\n`);
  }
  console.log(`${rotas.length} notas reparadas.`);
}

export {};
