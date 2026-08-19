/**
 * Cambia el texto de un video ya publicado, sin volver a producirlo.
 *
 * El título y la bajada viven en la franja de abajo, que es una imagen aparte.
 * Repintarla sobre el mp4 existente es una sola pasada de ffmpeg: no toca el
 * audio, no toca los subtítulos de la voz y no pide una locución nueva. Un
 * ajuste de tipografía pasa de costar créditos y minutos a costar segundos.
 *
 * Así tendría que haber sido desde el principio. Iterar el diseño rehaciendo el
 * video entero consumió los 10.034 créditos de voz del plan en un solo día.
 *
 *   node src/repintar.mjs                    dice qué haría
 *   node src/repintar.mjs --hacer            repinta todos
 *   node src/repintar.mjs --hacer --lote 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { env, DIRS, esPrincipal, salirPorError } from './config.mjs';
import { generarFranja } from './franja.mjs';
import { subirVideo } from './sitio.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

async function bajar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`no pude bajar el video (${r.status})`);
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  return destino;
}

/**
 * Pega la franja sobre el video.
 *
 * El video se recodifica pero el audio se copia tal cual: es lo que hace que
 * esto no cueste nada. `-c:a copy` además evita perder calidad en cada pasada.
 */
function pegar(mp4, franja, y, destino) {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', mp4, '-i', franja,
    '-filter_complex', `[0:v][1:v]overlay=0:${y}[v]`,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart',
    destino,
  ], { stdio: 'pipe', timeout: 300000 });
  return destino;
}

const CARTEL = {
  name: 'entregar_cartel',
  input_schema: {
    type: 'object',
    properties: {
      cartel: {
        type: 'string',
        description: 'de 3 a 6 palabras en MAYÚSCULAS, MÁXIMO 34 caracteres contando espacios',
      },
    },
    required: ['cartel'],
  },
};

/**
 * El cartel que va en el video, sacado del titular de la nota.
 *
 * El titular está escrito para leerse en una página; el cartel tiene que
 * entrar grande en dos renglones de mil pixeles. "Estados Unidos sanciona a la
 * presidenta de la Corte Penal Internacional" son sesenta y cinco caracteres:
 * con eso ningún ajuste tipográfico lo salva.
 */
async function cartelDe(titular) {
  const { pedirHerramienta, MODELO_LIVIANO } = await import('./claude.mjs');
  const { cartel } = await pedirHerramienta({
    etapa: 'cartel',
    modelo: MODELO_LIVIANO,
    maxTokens: 120,
    sistema: 'Convertís el titular de una nota en el cartel de arranque de un video vertical.\n'
      + 'Es un cartel, no un titular: 3 a 6 palabras en MAYÚSCULAS, máximo 34 caracteres.\n'
      + 'Tiene que decir el hecho, no insinuarlo. Nada de clickbait ni signos de exclamación.\n'
      + 'Español neutro. Si el titular nombra una institución larga, usá su forma corta.',
    herramienta: CARTEL,
    mensajes: [{ role: 'user', content: titular }],
  });

  const limpio = String(cartel ?? '').trim().toUpperCase();
  return limpio && limpio.length <= 40 ? limpio : titular.toUpperCase();
}

export async function repintarNota(nota) {
  const base = path.join(DIRS.temp, `rep-${nota.slug.slice(0, 12)}`);
  const hecho = {};
  const hook = nota.hook ?? await cartelDe(nota.titular);

  for (const [campo, formato, sufijo] of [
    ['video_url', 'vertical', ''],
    ['video_horizontal_url', 'horizontal', '16x9'],
  ]) {
    if (!nota[campo]) continue;

    const original = await bajar(nota[campo], `${base}-${formato}.mp4`);
    const { ruta, y } = generarFranja({
      hook,
      bajada: nota.bajada,
      formato,
      destino: `${base}-${formato}.png`,
    });

    const salida = `${base}-${formato}-nuevo.mp4`;
    pegar(original, ruta, y, salida);
    hecho[formato] = await subirVideo(salida, nota.slug, { sufijo });
  }

  return hecho;
}

export async function correr({ hacer = false, lote = 50 } = {}) {
  const notas = await fetch(
    `${URL_BASE()}/rest/v1/notas?select=id,slug,titular,bajada,video_url,video_horizontal_url`
    + `&video_url=not.is.null&order=publicada_en.desc&limit=${lote}`,
    { headers: cab() },
  ).then((r) => r.json());

  if (!notas.length) {
    console.log('No hay videos para repintar.');
    return 0;
  }

  console.log(`${notas.length} video(s) para repintar\n`);
  let hechos = 0;

  for (const n of notas) {
    if (!hacer) {
      console.log(`  ${n.titular.slice(0, 62)}`);
      hechos++;
      continue;
    }

    try {
      console.log('▸ ' + n.titular.slice(0, 58));
      const r = await repintarNota(n);

      // El archivo nuevo queda bajo la carpeta del día en que se repinta, no la
      // del día en que se publicó la nota. Sin guardar la URL que devuelve la
      // subida, la nota sigue sirviendo el video viejo y el repintado no se ve.
      await fetch(`${URL_BASE()}/rest/v1/notas?id=eq.${n.id}`, {
        method: 'PATCH',
        headers: { ...cab(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          ...(r.vertical ? { video_url: r.vertical } : {}),
          ...(r.horizontal ? { video_horizontal_url: r.horizontal } : {}),
          actualizada_en: new Date().toISOString(),
        }),
      });
      console.log(`  listo (${Object.keys(r).join(' y ')})`);
      hechos++;
    } catch (e) {
      console.error(`  ! ${e.message.slice(0, 90)}`);
    }
  }

  return hechos;
}

if (esPrincipal(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--lote');
    const hacer = process.argv.includes('--hacer');
    const n = await correr({ hacer, lote: i > 0 ? Number(process.argv[i + 1]) : 50 });
    console.log(hacer ? `\n${n} video(s) repintados.` : `\n${n} para repintar. Corré con --hacer.`);
  } catch (e) {
    process.exit(salirPorError(e, 'el repintado'));
  }
}
