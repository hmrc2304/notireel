/**
 * Recupera la foto de las notas que quedaron sin imagen.
 *
 * Antes de generar una con IA, prueba las fotos reales: entra a cada artículo
 * citado y le saca su `og:image`, que es la que el medio arma para que se vea
 * bien al compartir. Una foto del hecho vale más que cualquier recreación, y
 * encima no cuesta nada.
 *
 * Existe porque muchas notas se publicaron sin imagen por dos motivos que ya
 * están arreglados: los medios rechazaban la descarga por no parecer un
 * navegador, y el plan B de generar una fallaba por falta de crédito.
 *
 *   node src/recuperar-fotos.mjs           dice qué haría
 *   node src/recuperar-fotos.mjs --hacer   lo hace
 */

import path from 'node:path';
import { env, DIRS, esPrincipal, salirPorError } from './config.mjs';
import { subirImagen } from './sitio.mjs';
import { bajarImagen } from './video.mjs';
import { imagenDeArticulo, evaluarImagen, generarPortada } from './imagen.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

const ANCHO_MINIMO = 700;

async function sinFoto(limite) {
  return fetch(
    `${URL_BASE()}/rest/v1/notas?select=id,slug,titular,bajada,fuentes(medio,url,orden)`
    + `&imagen_url=is.null&order=publicada_en.desc&limit=${limite}`,
    { headers: cab() },
  ).then((r) => r.json());
}

/** La primera foto de las fuentes de la nota que sirva de verdad. */
async function fotoDeLasFuentes(nota, base) {
  const fuentes = [...(nota.fuentes ?? [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

  for (const f of fuentes.slice(0, 6)) {
    let url;
    try {
      url = await imagenDeArticulo(f.url);
    } catch {
      continue;
    }

    const destino = `${base}-${f.medio.replace(/\W+/g, '').slice(0, 10)}.jpg`;
    try {
      await bajarImagen(url, destino);
    } catch {
      continue;
    }

    const { execFileSync } = await import('node:child_process');
    let ancho = 0;
    try {
      ancho = Number(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width', '-of', 'csv=p=0', destino,
      ], { encoding: 'utf8' }).trim().split(',')[0]);
    } catch {
      continue;
    }
    if (!ancho || ancho < ANCHO_MINIMO) continue;

    // El mismo control que usa el motor: el logo del medio o una placa de texto
    // ampliada a pantalla completa se ve peor que no tener foto.
    try {
      const v = await evaluarImagen(destino);
      if (!v.usable) continue;
    } catch {
      // Si el control no responde, se usa igual: ya pasó el filtro de tamaño.
    }

    return { ruta: destino, medio: f.medio, generada: false };
  }

  return null;
}

export async function recuperar({ hacer = false, limite = 20 } = {}) {
  const notas = await sinFoto(limite);
  if (!notas.length) {
    console.log('Todas las notas tienen foto.');
    return 0;
  }

  console.log(`${notas.length} nota(s) sin foto\n`);
  let listas = 0;

  for (const n of notas) {
    console.log(`▸ ${n.titular.slice(0, 58)}`);
    const base = path.join(DIRS.temp, `foto-${n.slug.slice(0, 18)}`);

    let hallada = await fotoDeLasFuentes(n, base);

    if (!hallada && hacer) {
      console.log('    ninguna fuente dio una foto usable, genero una propia');
      try {
        hallada = { ruta: await generarPortada(n, `${base}-propia.png`), medio: 'IA', generada: true };
      } catch (e) {
        console.error(`    ! ${e.message.slice(0, 70)}`);
        continue;
      }
    }

    if (!hallada) {
      console.log('    ninguna fuente dio una foto usable (con --hacer se genera una)');
      continue;
    }

    console.log(`    foto de ${hallada.medio}`);
    if (!hacer) { listas++; continue; }

    const url = await subirImagen(hallada.ruta, n.slug);
    await fetch(`${URL_BASE()}/rest/v1/notas?id=eq.${n.id}`, {
      method: 'PATCH',
      headers: { ...cab(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        imagen_url: url,
        imagen_generada: hallada.generada,
        actualizada_en: new Date().toISOString(),
      }),
    });
    listas++;
  }

  return listas;
}

if (esPrincipal(import.meta.url)) {
  try {
    const hacer = process.argv.includes('--hacer');
    const n = await recuperar({ hacer });
    console.log(hacer ? `\n${n} nota(s) con foto nueva.` : `\n${n} se pueden recuperar. Corré con --hacer.`);
  } catch (e) {
    process.exit(salirPorError(e, 'la recuperación de fotos'));
  }
}
