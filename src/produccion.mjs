/**
 * Producción de NotiViral, de punta a punta. Es lo que corre el cron.
 *
 *   recolectar → agrupar → rankear → redactar → publicar la nota
 *                                             → video (solo las mejores)
 *                                             → carrusel y placa (el resto)
 *
 * El mix no es caprichoso: el video es la única pieza que lleva locución y cuesta
 * diez veces más que un carrusel. Las noticias con más cobertura se llevan el
 * video; las demás salen igual, en formatos que no consumen voz.
 *
 *   node src/produccion.mjs              una corrida (1 nota, según el reparto horario)
 *   node src/produccion.mjs --lote 6     produce 6 piezas de una
 *   node src/produccion.mjs --solo-nota  publica la nota sin generar piezas
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, env, esPrincipal, salirPorError } from './config.mjs';
import { publicarNota, subirImagen, subirVideo, marcarVideo, claveDelHecho, yaPublicado } from './sitio.mjs';

/** A 24 piezas por día, 8 llevan video: una de cada tres. */
const UNA_DE_CADA = Number(env('VIDEOS_UNA_DE_CADA', false) ?? 3);
const MINIMO_CREDITOS_VOZ = 700;

const flag = (n) => process.argv.includes(`--${n}`);
function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/**
 * ¿Esta pieza lleva video? Se decide por la posición en el ranking del día, no al
 * azar: así el video siempre va a las noticias con más cobertura cruzada.
 */
const llevaVideo = (indice) => indice % UNA_DE_CADA === 0;

async function conseguirFondo(nota, indice) {
  const { bajarImagen } = await import('./video.mjs');
  const { fondoParaNota } = await import('./imagen.mjs');
  const base = path.join(DIRS.temp, `prod-${indice}`);
  try {
    return await fondoParaNota(nota, base, bajarImagen);
  } catch (e) {
    console.error(`    ! sin imagen (${e.message})`);
    return { ruta: null, generada: false };
  }
}

/** Video de una nota ya publicada: guion, locución, composición y subida. */
async function producirVideo(nota, publicada, fondo, avatar, voz, fondoGenerado) {
  const { escribirGuion } = await import('./guion.mjs');
  const { locutar, creditos } = await import('./voz.mjs');
  const { armarVideo } = await import('./video.mjs');

  const c = await creditos();
  if (c.restantes < MINIMO_CREDITOS_VOZ) {
    console.log(`    sin voz suficiente (${c.restantes} créditos): queda como pieza estática`);
    return null;
  }

  const { fotosDeCoberturas } = await import('./imagen.mjs');
  const { bajarImagen } = await import('./video.mjs');

  const guion = await escribirGuion({ ...nota, titulo: nota.titular });
  console.log(`    guion: "${guion.hook}" (${guion.palabras} palabras)`);

  const base = path.join(DIRS.temp, publicada.slug.slice(0, 8));
  const locucion = await locutar(guion.libreto, `${base}.mp3`, { voz });

  // Las fotos que mandaron los otros medios del mismo hecho: el video va
  // cambiando de imagen mientras la voz lee, en vez de quedarse en una sola.
  const extras = await fotosDeCoberturas(nota.fuentes, base, bajarImagen, { evitar: [nota.imagen] });
  if (extras.length) console.log(`    ${extras.length} fotos más de otras coberturas`);

  const piezas = await armarVideo({
    nota: { ...nota, id: publicada.slug, slug: publicada.slug },
    guion,
    locucion,
    avatar,
    fondo,
    fondoGenerado,
    extras,
  });

  const mp4 = piezas.vertical;
  const url = await subirVideo(mp4, publicada.slug);

  // El 16:9 es para el reproductor de la nota; si su render falló, la nota se
  // queda con el vertical antes que sin video.
  const horizontalUrl = piezas.horizontal
    ? await subirVideo(piezas.horizontal, `${publicada.slug}-16x9`)
    : null;

  await marcarVideo(publicada.slug, { videoUrl: url, horizontalUrl, duracion: locucion.duracion });
  const total = locucion.duracion + 9.1; // los 8s de intro más la cola del cierre
  console.log(`    video: ${(fs.statSync(mp4).size / 1024 / 1024).toFixed(1)} MB, ${total.toFixed(0)}s en total (${locucion.duracion.toFixed(0)}s de locución)${horizontalUrl ? ' + 16:9' : ''}`);

  return { mp4, url, guion, duracion: locucion.duracion };
}

/** Carrusel y placa: sin locución, cuestan centavos. */
async function producirEstaticas(nota, publicada, fondo, avatar, generada) {
  const { armarCarrusel, armarPlaca } = await import('./tarjetas.mjs');
  const id = publicada.slug.slice(0, 24);

  const placa = armarPlaca({ nota, foto: fondo, id, imagenGenerada: generada });
  const { tarjetas } = await armarCarrusel({ nota, foto: fondo, avatar, id, imagenGenerada: generada });
  console.log(`    estáticas: placa + carrusel de ${tarjetas.length}`);

  return { placa, tarjetas };
}

export async function correr({ lote = 1, avatar = 'ana', voz = 'langa', soloNota = false } = {}) {
  const { producir } = await import('./redactar.mjs');

  // Se piden más grupos que piezas: algunos se descartan por ya publicados.
  const { notas, totalItems, totalGrupos } = await producir({ cantidad: lote + 3, minMedios: 2 });
  console.log(`${totalItems} noticias, ${totalGrupos} hechos, ${notas.length} redactadas\n`);

  const hechas = [];

  for (const [i, nota] of notas.entries()) {
    if (hechas.length >= lote) break;

    console.log(`${hechas.length + 1}/${lote} · ${nota.titular.slice(0, 62)}`);

    if (await yaPublicado(claveDelHecho(nota))) {
      console.log('    ya estaba publicada, sigo con la próxima');
      continue;
    }

    const { ruta: fondo, generada } = await conseguirFondo(nota, i);
    const imagenUrl = fondo ? await subirImagen(fondo, `${nota.titular.slice(0, 20)}-${i}`) : null;

    const publicada = await publicarNota(nota, { imagenUrl, imagenGenerada: generada });
    if (publicada.salteada) {
      console.log(`    salteada: ${publicada.motivo}`);
      continue;
    }
    console.log(`    nota: ${publicada.url}`);

    const registro = { ...publicada, conVideo: false };

    if (!soloNota && fondo) {
      if (llevaVideo(hechas.length)) {
        const v = await producirVideo(nota, publicada, fondo, avatar, voz, generada);
        registro.conVideo = Boolean(v);
        if (v) registro.video = v.url;
      } else {
        await producirEstaticas(nota, publicada, fondo, avatar, generada);
      }
    }

    hechas.push(registro);
  }

  return hechas;
}

if (esPrincipal(import.meta.url)) {
  try {
    const lote = Number(arg('lote', '1'));
    const hechas = await correr({
      lote,
      avatar: arg('avatar', 'ana'),
      voz: arg('voz', 'langa'),
      soloNota: flag('solo-nota'),
    });

    const videos = hechas.filter((h) => h.conVideo).length;
    console.log(`\n${hechas.length} piezas: ${videos} con video, ${hechas.length - videos} estáticas`);
    for (const h of hechas) console.log(`  ${h.conVideo ? '▶' : '▪'} ${h.url}`);
  } catch (e) {
    process.exit(salirPorError(e, 'la producción de la pieza'));
  }
}
