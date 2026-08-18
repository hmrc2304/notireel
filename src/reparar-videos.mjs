/**
 * Repara las notas cuyo video vertical fue sobrescrito por el 16:9.
 *
 * El nombre del archivo se recortaba a 60 caracteres DESPUÉS de pegarle el
 * sufijo "-16x9", así que con un slug largo los dos videos terminaban con el
 * mismo nombre y el horizontal pisaba al vertical. En el feed se veía una franja
 * apaisada en el medio de la pantalla en vez de un reel.
 *
 * El arreglo de fondo está en sitio.mjs; esto repone lo que ya se había pisado,
 * usando los archivos que quedaron en salida/. No regenera nada: no gasta ni voz
 * ni modelo.
 *
 *   node src/reparar-videos.mjs           dice qué haría
 *   node src/reparar-videos.mjs --hacer   lo hace
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS, esPrincipal, salirPorError } from './config.mjs';
import { subirVideo } from './sitio.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

/** Las notas donde el vertical y el 16:9 apuntan al mismo archivo. */
async function pisadas() {
  const notas = await fetch(
    `${URL_BASE()}/rest/v1/notas?select=slug,video_url,video_horizontal_url&video_url=not.is.null`,
    { headers: cab() },
  ).then((r) => r.json());

  return notas.filter((n) => n.video_horizontal_url && n.video_url === n.video_horizontal_url);
}

/** El archivo local se nombró con los primeros ocho caracteres del slug. */
function localesDe(slug) {
  const id = slug.slice(0, 8);
  const vertical = path.join(DIRS.salida, `${id}.mp4`);
  const horizontal = path.join(DIRS.salida, `${id}-horizontal.mp4`);
  return {
    vertical: fs.existsSync(vertical) ? vertical : null,
    horizontal: fs.existsSync(horizontal) ? horizontal : null,
  };
}

export async function reparar({ hacer = false } = {}) {
  const rotas = await pisadas();
  if (!rotas.length) {
    console.log('No hay videos pisados.');
    return 0;
  }

  console.log(`${rotas.length} nota(s) con el vertical pisado por el 16:9\n`);
  let arregladas = 0;

  for (const n of rotas) {
    const { vertical, horizontal } = localesDe(n.slug);

    if (!vertical) {
      console.log(`  ✖ ${n.slug.slice(0, 52)}\n      falta el archivo local: hay que rehacerlo`);
      continue;
    }

    if (!hacer) {
      console.log(`  · ${n.slug.slice(0, 52)}\n      repondría ${path.basename(vertical)}`);
      arregladas++;
      continue;
    }

    const urlVertical = await subirVideo(vertical, n.slug);
    const urlHorizontal = horizontal
      ? await subirVideo(horizontal, n.slug, { sufijo: '16x9' })
      : null;

    await fetch(`${URL_BASE()}/rest/v1/notas?slug=eq.${encodeURIComponent(n.slug)}`, {
      method: 'PATCH',
      headers: { ...cab(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        video_url: urlVertical,
        // Sin el horizontal local, se limpia: la nota vuelve a mostrar el
        // vertical contenido, que es correcto, en vez de apuntar al archivo que
        // pisó al reel.
        video_horizontal_url: urlHorizontal,
      }),
    });

    console.log(`  ✓ ${n.slug.slice(0, 52)}${urlHorizontal ? '' : ' (sin 16:9)'}`);
    arregladas++;
  }

  return arregladas;
}

if (esPrincipal(import.meta.url)) {
  try {
    const hacer = process.argv.includes('--hacer');
    const n = await reparar({ hacer });
    console.log(hacer ? `\n${n} reparada(s).` : `\n${n} se pueden reparar. Corré con --hacer.`);
  } catch (e) {
    process.exit(salirPorError(e, 'la reparación de los videos'));
  }
}
