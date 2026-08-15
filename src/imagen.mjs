/**
 * Control de calidad de la imagen de fondo.
 *
 * No todas las notas traen una foto: algunas vienen con una placa tipográfica
 * (fondo liso con el titular escrito) o con un thumbnail de Twitter que ya tiene
 * subtítulos quemados. Cualquiera de las dos, ampliada y recortada para el 9:16,
 * queda ilegible y parece un error.
 *
 * Entonces se mira la imagen con Claude antes de usarla y, si no sirve, se genera
 * una propia con GPT image 2 a partir del titular. Es un plan B, no el camino
 * habitual: la mayoría de las notas ya trae su imagen generada y utilizable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { env, DIRS, esPrincipal } from './config.mjs';
import { generarImagen, bajar } from './kie.mjs';

/** Debajo de esto la imagen se ve pixelada al ampliarla a 1080 de ancho. */
const ANCHO_MINIMO = 760;

/** Dimensiones con ffprobe, que ya es una dependencia del proyecto. */
export function medir(ruta) {
  try {
    const salida = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', ruta,
    ]).toString().trim();
    const [w, h] = salida.split('x').map(Number);
    return Number.isFinite(w) && Number.isFinite(h) ? { ancho: w, alto: h } : null;
  } catch {
    return null;
  }
}

const HERRAMIENTA = {
  name: 'evaluar_imagen',
  description: 'Dictamina si la imagen sirve como fondo de un video vertical de noticias.',
  input_schema: {
    type: 'object',
    properties: {
      tipo: {
        type: 'string',
        enum: ['foto', 'placa_de_texto', 'captura_con_subtitulos', 'ilustracion', 'otra'],
        description: 'qué es la imagen',
      },
      usable: {
        type: 'boolean',
        description: 'true solo si es una imagen visual que funciona de fondo aunque se la recorte y amplíe',
      },
      recorte: {
        type: 'string',
        enum: ['completa', 'izquierda', 'derecha', 'arriba', 'abajo'],
        description: 'si la imagen es un collage de varias fotos, qué mitad conviene quedarse; "completa" si es una sola foto',
      },
      motivo: { type: 'string', description: 'una frase corta explicando la decisión' },
    },
    required: ['tipo', 'usable', 'recorte', 'motivo'],
  },
};

const CRITERIO = `Evaluás imágenes que se van a usar como FONDO de un video vertical de noticias.

CÓMO SE USA LA IMAGEN, tenelo en cuenta al decidir:
- El motor ya recorta y descarta la franja INFERIOR (el 18% de abajo). Todo lo que
  esté ahí, marca de agua, logo, dominio, pie de foto, desaparece solo.
- De lo que queda se muestra la parte de arriba, y encima va texto propio.

NO es usable si:
- es una placa tipográfica: fondo liso o degradado cuyo contenido principal es el
  titular escrito, sin escena real detrás
- tiene subtítulos o texto grande quemado en el CENTRO o en la mitad superior
- es un pantallazo de una publicación de red social

SÍ es usable si en la mitad superior hay una escena visual de verdad: personas,
lugares, objetos, un hecho. Un logo o una marca de agua abajo NO la descalifica,
porque ese pedazo se recorta. Un cartel o un texto chico dentro de la escena
fotografiada tampoco: eso es parte de la foto.

Ante la duda, si hay una escena visual reconocible, es usable.

COLLAGES. Los medios arman fotos pegando dos o tres imágenes con un corte duro
(el retrato de la persona de un lado y el lugar del hecho del otro). Eso NO se
descarta: es material real. Marcalo en "recorte" diciendo qué mitad conviene,
la que muestre mejor el hecho o a la persona. Una sola foto va como 'completa'.`;

/** Mira la imagen y decide si sirve de fondo. */
export async function evaluarImagen(rutaLocal) {
  const bytes = fs.readFileSync(rutaLocal);
  const tipo = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system: CRITERIO,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: 'evaluar_imagen' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: tipo, data: bytes.toString('base64') } },
          { type: 'text', text: '¿Sirve como fondo?' },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic visión ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const uso = data.content.find((b) => b.type === 'tool_use');
  if (!uso) throw new Error('el modelo no evaluó la imagen');
  return uso.input;
}

/** Plan B: una foto propia a partir del titular, sin nada de texto adentro. */
export async function generarPortada(nota, destino) {
  const prompt =
    `Editorial news photograph illustrating this headline: "${nota.titular}". ` +
    `${nota.bajada} ` +
    'Ultra photorealistic press photography, natural lighting, documentary style, ' +
    'real human skin texture and natural film grain, shot on a 35mm lens. ' +
    'Absolutely not CGI, not a 3D render, not an illustration. ' +
    'Vertical composition with the subject in the upper two thirds. ' +
    'CRITICAL: no text, no letters, no words, no captions, no watermarks, no logos anywhere in the image.';

  const url = await generarImagen(prompt, { aspect_ratio: '3:4', resolution: '2K' });
  await bajar(url, destino);
  return destino;
}

/**
 * Se queda con la mitad que indicó el control de calidad.
 *
 * Sin esto un collage lado a lado entra entero al 9:16 y el video muestra las dos
 * fotos partidas por un corte vertical en el medio. Devuelve null si no hay nada
 * que recortar, así el motor sigue con la original.
 */
function recortarMitad(origen, recorte, destino) {
  if (!recorte || recorte === 'completa') return null;

  const corte = {
    izquierda: 'iw/2:ih:0:0',
    derecha: 'iw/2:ih:iw/2:0',
    arriba: 'iw:ih/2:0:0',
    abajo: 'iw:ih/2:0:ih/2',
  }[recorte];
  if (!corte) return null;

  try {
    execFileSync('ffmpeg', ['-v', 'error', '-i', origen, '-vf', `crop=${corte}`, '-q:v', '3', '-y', destino]);
    console.log(`  collage: me quedo con la mitad ${recorte}`);
    return destino;
  } catch (e) {
    console.error(`  ! no pude recortar el collage (${e.message}), uso la entera`);
    return null;
  }
}

/**
 * Baja las imágenes de las otras coberturas del mismo hecho.
 *
 * Son el material para que el video no se quede treinta segundos sobre una única
 * foto congelada. No pasan por el control de visión: es una llamada por imagen y
 * el gasto no se justifica para algo que aparece seis segundos. Se filtran con lo
 * barato, que descarta casi todo lo malo: las repetidas, las que no se pueden
 * bajar y las miniaturas que ampliadas se ven pixeladas.
 */
export async function fotosDeCoberturas(coberturas, rutaBase, descargar, { tope = 4, evitar = [] } = {}) {
  const vistas = new Set(evitar.map((u) => String(u).split('?')[0]));
  const salida = [];

  for (const c of coberturas ?? []) {
    if (salida.length >= tope) break;
    const url = c?.imagen;
    if (!url) continue;

    const limpia = String(url).split('?')[0];
    if (vistas.has(limpia)) continue;
    vistas.add(limpia);

    const destino = `${rutaBase}-cob${salida.length}.jpg`;
    try {
      await descargar(url, destino);
    } catch {
      continue;
    }

    const tam = medir(destino);
    if (!tam || tam.ancho < ANCHO_MINIMO) continue;

    const recortada = recortarMitad(destino, 'completa', destino);
    salida.push(recortada ?? destino);
  }

  return salida;
}

/**
 * Devuelve la ruta de una imagen de fondo utilizable, generando una si hace falta.
 * `descargar` es la función que baja la imagen original de la nota.
 */
export async function fondoParaNota(nota, rutaBase, descargar) {
  const original = `${rutaBase}.jpg`;

  // Varios medios responden 401 o 403 a la descarga directa de sus imágenes.
  // Sin este plan B la nota queda sin foto y, por lo tanto, sin ninguna pieza.
  try {
    await descargar(nota.imagen, original);
  } catch (e) {
    console.log(`  imagen inaccesible (${e.message}), genero una propia`);
    const propia = await generarPortada(nota, `${rutaBase}-propia.png`);
    return { ruta: propia, generada: true, veredicto: { tipo: 'inaccesible', usable: false, motivo: e.message } };
  }

  // Primero el filtro barato: muchos feeds RSS entregan un thumbnail chico que
  // ampliado a 1080 se ve pixelado. Medirlo cuesta nada y evita gastar una
  // llamada de visión en algo que ya sabemos que no sirve.
  const tam = medir(original);
  if (tam && tam.ancho < ANCHO_MINIMO) {
    console.log(`  imagen descartada: ${tam.ancho}x${tam.alto}, muy chica para 1080 de ancho`);
    const propia = await generarPortada(nota, `${rutaBase}-propia.png`);
    return { ruta: propia, generada: true, veredicto: { tipo: 'baja_resolucion', usable: false, motivo: `${tam.ancho}x${tam.alto}` } };
  }

  let veredicto;
  try {
    veredicto = await evaluarImagen(original);
  } catch (e) {
    console.error(`  ! no pude evaluar la imagen (${e.message}), la uso igual`);
    return { ruta: original, generada: false, veredicto: null };
  }

  if (veredicto.usable) {
    const recortada = recortarMitad(original, veredicto.recorte, `${rutaBase}-mitad.jpg`);
    return { ruta: recortada ?? original, generada: false, veredicto };
  }

  console.log(`  imagen descartada (${veredicto.tipo}): ${veredicto.motivo}`);
  console.log('  generando una foto propia con GPT image 2...');
  const propia = await generarPortada(nota, `${rutaBase}-propia.png`);
  return { ruta: propia, generada: true, veredicto };
}

if (esPrincipal(import.meta.url)) {
  const { ultimas } = await import('./fuente.mjs');
  const notas = await ultimas(Number(process.argv[2] ?? 5));
  const { bajarImagen } = await import('./video.mjs');

  for (const n of notas) {
    const destino = path.join(DIRS.temp, `eval-${n.id.slice(0, 8)}.jpg`);
    await bajarImagen(n.imagen, destino);
    const v = await evaluarImagen(destino);
    console.log(`${v.usable ? 'SIRVE ' : 'NO    '} [${v.tipo}] ${n.titular.slice(0, 60)}`);
    console.log(`         ${v.motivo}`);
  }
}
