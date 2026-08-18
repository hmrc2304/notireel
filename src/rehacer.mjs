/**
 * Rehace los videos de notas YA publicadas.
 *
 * Cada mejora del motor (el marco, la posición de los subtítulos, las fotos que
 * se van sucediendo, la velocidad de lectura, el 16:9) solo se aplica a lo que se
 * produce de ahí en adelante: lo ya publicado queda con el render viejo. Con
 * doce videos arriba, eso significa que el sitio muestra sobre todo la versión
 * anterior y los cambios parecen no haberse hecho.
 *
 * La nota no se toca: se reusa su texto tal cual está publicado y se regeneran
 * el guion, la locución y los dos videos.
 *
 *   node src/rehacer.mjs --uno            rehace el video más viejo sin rehacer
 *   node src/rehacer.mjs --slug xxx       rehace uno puntual
 *   node src/rehacer.mjs --lote 5         rehace los cinco más viejos
 */

import path from 'node:path';
import { env, DIRS, esPrincipal, salirPorError } from './config.mjs';
import { subirVideo, marcarVideo } from './sitio.mjs';
import { VERSION_RENDER } from './video.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

async function pedir(ruta) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${ruta}`, { headers: cab() });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Las que quedaron con un render anterior al actual.
 *
 * El criterio es el número de versión y no un síntoma. Antes se buscaban las que
 * no tuvieran la versión 16:9, y eso sirvió una sola vez: el cambio siguiente
 * (sacar el presentador) no agregaba ninguna columna, así que ninguna nota
 * "parecía" vieja y el rehacedor no encontraba nada que hacer.
 */
function porRehacer({ slug = null, lote = 1 }) {
  if (slug) return pedir(`notas?select=*,fuentes(medio,titulo,url,fecha)&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  // Se toman también las que quedaron sin vertical y solo con el 16:9: son las
  // que perdieron su reel cuando el horizontal le pisó el archivo.
  return pedir(
    'notas?select=*,fuentes(medio,titulo,url,fecha)'
    + '&or=(video_url.not.is.null,video_horizontal_url.not.is.null)'
    + `&render_version=lt.${VERSION_RENDER}&order=publicada_en.desc&limit=${lote}`,
  );
}

export async function rehacer(nota, { voz = 'langa' } = {}) {
  const { escribirGuion } = await import('./guion.mjs');
  const { locutar, creditos } = await import('./voz.mjs');
  const { armarVideo, bajarImagen } = await import('./video.mjs');
  const { fotosDeCoberturas } = await import('./imagen.mjs');

  console.log(`\n▸ ${nota.titular.slice(0, 62)}`);

  // Un libreto entero salió 82 créditos, medido: el modelo flash cobra bastante
  // menos de un crédito por carácter. Con el mínimo puesto en los ~450 caracteres
  // del texto se frenaba con crédito de sobra para cinco videos más.
  const c = await creditos();
  if (c.restantes < Number(env("VOZ_MINIMO", false) ?? 150)) {
    console.log(`  sin voz: quedan ${c.restantes} créditos y un libreto gasta unos 90`);
    return null;
  }

  const base = path.join(DIRS.temp, `rehacer-${nota.slug.slice(0, 10)}`);

  // La foto de la nota ya está subida y evaluada: se reusa en vez de volver a
  // pasar el control de visión y, si hace falta, generar una nueva con Kie.
  const fondo = nota.imagen_url ? await bajarImagen(nota.imagen_url, `${base}.jpg`) : null;
  if (!fondo) {
    console.log('  la nota no tiene imagen, la salteo');
    return null;
  }

  /*
   * Rehacer la maqueta no compra audio nuevo.
   *
   * Cambiar una tipografía no cambia cómo suena la voz, pero el rehacedor
   * volvía a pedir guion y locución en cada pasada. Cinco pasadas de maqueta en
   * un día sobre dieciséis notas se comieron los 10.034 créditos del plan de
   * ElevenLabs, y la sexta murió a mitad de camino con seis créditos en la
   * cuenta. Con el guion y los timestamps guardados, una pasada de diseño no
   * cuesta nada.
   */
  const { guardar, recuperar } = await import('./locucion-guardada.mjs');
  const guardada = await recuperar(nota.slug, { voz });

  let guion;
  let locucion;
  if (guardada) {
    ({ guion, locucion } = guardada);
    console.log('  reuso la locución guardada, no gasto voz');
  } else {
    guion = await escribirGuion({ ...nota, titulo: nota.titular });
    locucion = await locutar(guion.libreto, `${base}.mp3`, { voz });
    await guardar(nota.slug, { guion, voz, locucion });
  }

  const extras = await fotosDeCoberturas(nota.fuentes, base, bajarImagen, { evitar: [nota.imagen_url] });
  console.log(`  ${extras.length + 1} fotos · locución de ${locucion.duracion.toFixed(0)}s`);

  const piezas = await armarVideo({
    nota: { ...nota, id: nota.slug },
    guion, locucion, fondo, fondoGenerado: Boolean(nota.imagen_generada), extras,
  });

  // Mismo nombre de archivo que la vez anterior: el bucket lo sobrescribe y la
  // URL publicada sigue sirviendo, ahora con el video nuevo.
  const videoUrl = await subirVideo(piezas.vertical, nota.slug);
  const horizontalUrl = piezas.horizontal ? await subirVideo(piezas.horizontal, nota.slug, { sufijo: '16x9' }) : null;

  await marcarVideo(nota.slug, {
    videoUrl, horizontalUrl, duracion: locucion.duracion, version: VERSION_RENDER,
  });
  console.log(`  listo${horizontalUrl ? ' (vertical y 16:9)' : ''}`);

  return { slug: nota.slug, videoUrl, horizontalUrl };
}

if (esPrincipal(import.meta.url)) {
  try {
    const arg = (n) => {
      const i = process.argv.indexOf(`--${n}`);
      return i > 0 ? process.argv[i + 1] : null;
    };

    const slug = arg('slug');
    const lote = Number(arg('lote') ?? 1);
    const voz = arg('voz') ?? 'langa';

    const notas = await porRehacer({ slug, lote });
    if (!notas.length) {
      console.log('No hay videos con el render viejo.');
    } else {
      console.log(`${notas.length} video(s) por rehacer con la voz ${voz}`);
      let hechos = 0;
      for (const n of notas) {
        const r = await rehacer(n, { voz });
        if (r) hechos++;
      }
      console.log(`\n${hechos} de ${notas.length} rehechos.`);
    }
  } catch (e) {
    process.exit(salirPorError(e, 'el rehacer de los videos'));
  }
}
