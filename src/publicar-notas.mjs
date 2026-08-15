/**
 * Ciclo completo de NotiViral: recolectar, agrupar, redactar y publicar en el sitio.
 *
 *   node src/publicar-notas.mjs 5        produce y publica 5 notas
 *   node src/publicar-notas.mjs 5 --desde-archivo   usa las notas ya redactadas hoy
 *
 * Cada nota se lleva su imagen al bucket propio: las URLs de los feeds caducan o
 * cambian, y una portada rota deja la nota sin cara para siempre.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, esPrincipal } from './config.mjs';
import { publicarNota, subirImagen, claveDelHecho, yaPublicado } from './sitio.mjs';

const flag = (n) => process.argv.includes(`--${n}`);

/** Consigue una imagen decente y la sube al bucket del sitio. */
async function portadaDeLaNota(nota, indice) {
  const { bajarImagen } = await import('./video.mjs');
  const { fondoParaNota } = await import('./imagen.mjs');

  const base = path.join(DIRS.temp, `sitio-${indice}`);
  try {
    const { ruta, generada } = await fondoParaNota(nota, base, bajarImagen);
    const nombre = `${path.basename(ruta)}`;
    return { url: await subirImagen(ruta, nombre), generada };
  } catch (e) {
    console.error(`    ! sin imagen (${e.message})`);
    return { url: null, generada: false };
  }
}

export async function correr({ cantidad = 5, desdeArchivo = false } = {}) {
  let notas;

  if (desdeArchivo) {
    const archivo = path.join(DIRS.salida, 'notas', `notas-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(archivo)) throw new Error(`No hay notas de hoy en ${archivo}`);
    notas = JSON.parse(fs.readFileSync(archivo, 'utf8')).slice(0, cantidad);
    console.log(`${notas.length} notas leídas del archivo de hoy\n`);
  } else {
    const { producir } = await import('./redactar.mjs');
    const r = await producir({ cantidad, minMedios: 2 });
    notas = r.notas;
    console.log(`${r.totalItems} noticias, ${r.totalGrupos} hechos, ${notas.length} notas redactadas\n`);
  }

  const publicadas = [];
  for (const [i, nota] of notas.entries()) {
    console.log(`${i + 1}. ${nota.titular.slice(0, 68)}`);

    if (await yaPublicado(claveDelHecho(nota))) {
      console.log('   ya estaba publicada, la salteo');
      continue;
    }

    const { url, generada } = await portadaDeLaNota(nota, i);
    const res = await publicarNota(nota, { imagenUrl: url, imagenGenerada: generada });

    if (res.salteada) {
      console.log(`   salteada: ${res.motivo}`);
    } else {
      console.log(`   publicada -> ${res.url}`);
      publicadas.push(res);
    }
  }

  return publicadas;
}

if (esPrincipal(import.meta.url)) {
  const cantidad = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
  const hechas = await correr({ cantidad, desdeArchivo: flag('desde-archivo') });
  console.log(`\n${hechas.length} notas publicadas en NotiViral.`);
}
