import { esPrincipal } from './config.mjs';
/**
 * Elige qué noticia se convierte en video.
 *
 * Dos criterios que salieron de mirar el resultado real:
 *  - Nunca repetir: el estado vive en salida/estado.json.
 *  - Preferir la imagen generada por el propio sitio (news-images/generated/).
 *    Las notas que traen thumbnail de Twitter salen con texto quemado ajeno,
 *    en baja resolución y recortado. Se usan solo si no hay otra cosa.
 */

import { pathToFileURL } from 'node:url';
import { listarNoticias, leerNoticia } from './fuente.mjs';
import { leerEstado } from './estado.mjs';

export const esGenerada = (url) => typeof url === 'string' && url.includes('news-images/generated/');

/**
 * Devuelve la próxima noticia a publicar, o null si no hay nada nuevo.
 * Recorre de la más reciente hacia atrás y se queda con la primera que sirva.
 */
export async function proxima({ maxCandidatas = 25, exigirImagenPropia = true } = {}) {
  const estado = await leerEstado();
  const lista = await listarNoticias();
  const suplente = [];

  for (const { loc } of lista.slice(0, maxCandidatas)) {
    const id = loc.split('/').pop();
    if (estado.publicadas[id]) continue;

    let nota;
    try {
      nota = await leerNoticia(loc);
    } catch {
      continue;
    }
    if (!nota.imagen || nota.cuerpo.length < 400) continue;

    if (esGenerada(nota.imagen)) return nota;
    if (!exigirImagenPropia) return nota;
    suplente.push(nota);
  }

  // Ninguna con imagen propia: antes que no publicar, va la mejor suplente.
  return suplente[0] ?? null;
}

if (esPrincipal(import.meta.url)) {
  const estado = await leerEstado();
  console.log(`Ya publicadas: ${Object.keys(estado.publicadas).length}`);
  const n = await proxima();
  if (!n) {
    console.log('No hay noticias nuevas para publicar.');
  } else {
    console.log(`\nPRÓXIMA: ${n.titular}`);
    console.log(`  seccion: ${n.seccion} | imagen propia: ${esGenerada(n.imagen) ? 'sí' : 'NO'}`);
    console.log(`  ${n.url}`);
  }
}
