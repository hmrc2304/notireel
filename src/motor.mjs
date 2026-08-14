/**
 * Motor: de la noticia al video publicado. Es lo que corre el cron cada hora.
 *
 *   node src/motor.mjs                 genera y publica
 *   node src/motor.mjs --sin-publicar  solo genera el mp4 (para revisar)
 *   node src/motor.mjs --avatar mateo  usa otro presentador
 *
 * Idempotente: lo ya publicado queda en salida/estado.json y no se repite.
 * Si el video se generó pero la publicación falló, al reintentar NO se regenera
 * (no se vuelve a gastar la locución).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIRS , esPrincipal } from './config.mjs';
import { proxima, esGenerada } from './seleccion.mjs';
import { marcar, minutosDesdeElUltimo } from './estado.mjs';
import { escribirGuion } from './guion.mjs';
import { locutar, creditos } from './voz.mjs';
import { armarVideo } from './video.mjs';

/** Margen de créditos: por debajo de esto el cron no arranca en vez de fallar a mitad. */
const MINIMO_CREDITOS = 700;

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}
const flag = (n) => process.argv.includes(`--${n}`);

export async function correr({ avatar = 'ana', voz = 'langa', publicar = true, forzar = false } = {}) {
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  // El cron de GitHub a veces dispara dos veces la misma hora. Sin esta guarda
  // saldrían dos videos seguidos y la cuenta parecería spam.
  if (publicar && !forzar) {
    const min = await minutosDesdeElUltimo();
    if (min < 45) {
      log(`Se publicó hace ${Math.round(min)} min. Salteo esta corrida.`);
      return null;
    }
  }

  const c = await creditos();
  log(`Créditos de voz: ${c.restantes} disponibles`);
  if (c.restantes < MINIMO_CREDITOS) {
    throw new Error(`Quedan ${c.restantes} créditos de ElevenLabs, hace falta un mínimo de ${MINIMO_CREDITOS}. Recargar.`);
  }

  const nota = await proxima();
  if (!nota) {
    log('No hay noticias nuevas. Nada que hacer.');
    return null;
  }
  log(`Noticia: ${nota.titular}`);
  if (!esGenerada(nota.imagen)) log('  ! usa imagen de terceros, puede traer texto quemado');

  const guion = await escribirGuion(nota);
  log(`Guion: "${guion.hook}" (${guion.palabras} palabras, ~${guion.segundos}s)`);

  const locucion = await locutar(guion.libreto, path.join(DIRS.temp, `${nota.id.slice(0, 8)}.mp3`), { voz });
  log(`Locución: ${locucion.duracion.toFixed(1)}s`);

  const mp4 = await armarVideo({ nota, guion, locucion, avatar });
  const peso = (fs.statSync(mp4).size / 1024 / 1024).toFixed(1);
  log(`Video: ${path.basename(mp4)} (${peso} MB)`);

  const registro = { titular: nota.titular, url: nota.url, video: mp4, hook: guion.hook };

  if (publicar) {
    const { publicarEnRedes } = await import('./publicar.mjs');
    const res = await publicarEnRedes({ mp4, guion, nota });
    Object.assign(registro, res);
    log(`Publicado: IG=${res.ig ?? 'no'} FB=${res.fb ?? 'no'}`);
  }

  await marcar(nota.id, registro);
  return registro;
}

if (esPrincipal(import.meta.url)) {
  try {
    await correr({
      avatar: arg('avatar', 'ana'),
      voz: arg('voz', 'langa'),
      publicar: !flag('sin-publicar'),
      forzar: flag('forzar'),
    });
  } catch (e) {
    console.error(`\nFALLÓ: ${e.message}`);
    process.exit(1);
  }
}
