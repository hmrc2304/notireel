/**
 * Publica en NotiViral: toma las notas que redactó el recolector y las escribe
 * en la base del sitio.
 *
 * Es el cable que faltaba. Con esto el circuito queda cerrado sin depender de
 * Lovable: feeds -> agrupar -> redactar -> sitio -> video -> redes.
 */

import { env, DIRS, esPrincipal } from './config.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

function cabeceras(extra = {}) {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
}

/** Slug legible y estable: es la URL de la nota y no puede cambiar después. */
export function armarSlug(titular, fecha = new Date()) {
  const base = titular
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 9)
    .join('-')
    .slice(0, 80)
    .replace(/-+$/, '');

  const d = new Date(fecha);
  const sufijo = `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${base}-${sufijo}`;
}

/**
 * Huellas del hecho: TODAS sus URLs de origen, no solo la primera.
 *
 * Con una sola clave el anti-duplicados fallaba: entre dos corridas el mismo hecho
 * llega con una lista de coberturas ligeramente distinta (los feeds rotan), así que
 * la "primera URL ordenada" cambiaba y el hecho pasaba como nuevo. El sitio terminó
 * con la misma noticia publicada dos veces bajo titulares parecidos.
 *
 * Registrando todas, alcanza con que UNA cobertura coincida para reconocerlo.
 */
export function clavesDelHecho(nota) {
  const urls = (nota.fuentes ?? [])
    .map((f) => String(f.url).split('?')[0].slice(0, 400))
    .filter(Boolean);
  return urls.length ? [...new Set(urls)] : [armarSlug(nota.titular)];
}

/** Compatibilidad con el código que todavía pide una sola clave. */
export const claveDelHecho = (nota) => clavesDelHecho(nota)[0];

/** Postgres rechaza el insert entero si el array llega como texto suelto. */
function normalizarEtiquetas(valor) {
  if (Array.isArray(valor)) return valor.map((e) => String(e).trim()).filter(Boolean);
  if (!valor) return [];
  return String(valor).split(/\s*,\s*/).map((e) => e.trim()).filter(Boolean);
}

async function pedir(ruta, opciones) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${ruta}`, opciones);
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

/**
 * ¿Ya publicamos este hecho? Basta con que UNA de sus coberturas esté registrada.
 * Acepta la nota entera o una clave suelta.
 */
export async function yaPublicado(notaOClave) {
  return Boolean(await notaDelHecho(notaOClave));
}

/**
 * La nota ya publicada de este hecho, si existe.
 *
 * Separado de `yaPublicado` porque el trabajador necesita el slug: cuando alguien
 * pide piezas de algo que el cron ya publicó, no hay que republicar la nota sino
 * colgarle el video o el carrusel a la que ya está en el sitio.
 */
export async function notaDelHecho(notaOClave) {
  const claves = typeof notaOClave === 'string' ? [notaOClave] : clavesDelHecho(notaOClave);
  if (!claves.length) return null;
  const lista = claves.map((c) => `"${c.replace(/"/g, '')}"`).join(',');

  const [visto] = await pedir(
    `hechos_vistos?select=nota_id&clave=in.(${encodeURIComponent(lista)})&limit=1`,
    { headers: cabeceras() },
  ) ?? [];
  if (!visto?.nota_id) return null;

  const [nota] = await pedir(
    `notas?select=id,slug,video_url&id=eq.${visto.nota_id}&limit=1`,
    { headers: cabeceras() },
  ) ?? [];
  return nota ?? null;
}

/**
 * Escribe la nota con sus fuentes. Si el slug ya existe le agrega un sufijo:
 * dos hechos distintos pueden generar el mismo titular acortado.
 */
export async function publicarNota(nota, { imagenUrl = null, imagenGenerada = false, videoUrl = null, videoOrigen = null } = {}) {
  const claves = clavesDelHecho(nota);
  if (await yaPublicado(nota)) return { salteada: true, motivo: 'el hecho ya se publicó' };

  let slug = armarSlug(nota.titular, nota.fecha);
  const existe = await pedir(`notas?select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: cabeceras() });
  if (existe?.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [fila] = await pedir('notas', {
    method: 'POST',
    headers: cabeceras({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      slug,
      titular: nota.titular,
      bajada: nota.bajada,
      cuerpo: nota.cuerpo,
      seccion: nota.seccion,
      contraste: nota.contraste || null,
      certeza: nota.certeza,
      etiquetas: normalizarEtiquetas(nota.etiquetas),
      // Solo la imagen que logramos subir a nuestro bucket. Caer a la URL
      // original del medio parece inofensivo y no lo es: varios bloquean el
      // enlace directo, así que la nota queda con una imagen rota a la vista.
      imagen_url: imagenUrl ?? null,
      imagen_generada: imagenGenerada,
      video_url: videoUrl,
      video_origen: videoOrigen,
      publicada_en: nota.fecha ?? new Date().toISOString(),
      medios_count: new Set((nota.fuentes ?? []).map((f) => f.medio)).size || 1,
      puntaje: nota.puntaje ?? null,
    }),
  });

  if (nota.fuentes?.length) {
    await pedir('fuentes', {
      method: 'POST',
      headers: cabeceras({ Prefer: 'return=minimal' }),
      body: JSON.stringify(nota.fuentes.map((f, i) => ({
        nota_id: fila.id,
        medio: f.medio,
        titulo: f.titulo,
        url: f.url,
        fecha: f.fecha ?? null,
        tipo: f.tipo ?? 'medio',
        orden: i,
      }))),
    });
  }

  // Una fila por cobertura: así el hecho se reconoce aunque mañana llegue con
  // una lista de fuentes distinta.
  await pedir('hechos_vistos', {
    method: 'POST',
    headers: cabeceras({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(claves.map((clave) => ({ clave, nota_id: fila.id }))),
  });

  return { salteada: false, id: fila.id, slug, url: `${env('NOTIREEL_SITIO', false) ?? 'https://notiviral.gemasdigitales.com'}/nota/${slug}` };
}

/**
 * Comprime la imagen antes de subirla.
 *
 * Los PNG de 2K que devuelve GPT image 2 pesan más de un mega cada uno. A 24 notas
 * por día eso llena el giga gratuito de Supabase en ocho meses. Pasados a JPEG de
 * 1080 quedan en unos 200 KB, sin diferencia visible en pantalla, y el plan
 * gratuito aguanta años.
 */
async function comprimir(origen) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  const destino = path.join(DIRS.temp, `web-${path.basename(origen, path.extname(origen))}.jpg`);
  try {
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', origen,
      // Solo achica: una imagen que ya viene chica no se agranda ni pierde nitidez.
      '-vf', "scale='min(1080,iw)':-2:flags=lanczos",
      '-q:v', '4',
      destino,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    const antes = fs.statSync(origen).size;
    const despues = fs.statSync(destino).size;
    console.log(`    imagen: ${(antes / 1024).toFixed(0)} KB -> ${(despues / 1024).toFixed(0)} KB`);
    return destino;
  } catch (e) {
    console.error(`    ! no pude comprimir (${e.message}), subo el original`);
    return origen;
  }
}

/**
 * Nombre de archivo apto para Storage: sin tildes, espacios ni signos.
 * Supabase rechaza la subida entera con InvalidKey si la clave los trae.
 */
function nombreSeguro(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'medio';
}

/** Sube una imagen al bucket público del sitio y devuelve su URL definitiva. */
export async function subirImagen(ruta, nombre) {
  const fs = await import('node:fs');
  const bucket = 'medios';

  const liviana = await comprimir(ruta);
  const destino = `${new Date().toISOString().slice(0, 10)}/${nombreSeguro(nombre.replace(/\.\w+$/, ''))}.jpg`;

  const res = await fetch(`${URL_BASE()}/storage/v1/object/${bucket}/${destino}`, {
    method: 'POST',
    headers: {
      apikey: CLAVE(),
      Authorization: `Bearer ${CLAVE()}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: fs.readFileSync(liviana),
  });

  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${URL_BASE()}/storage/v1/object/public/${bucket}/${destino}`;
}

/** Sube el mp4 de una nota y deja su URL en el registro, para el sitio y el feed. */
export async function subirVideo(mp4, slug) {
  const fs = await import('node:fs');
  const bucket = 'medios';
  const destino = `${new Date().toISOString().slice(0, 10)}/${nombreSeguro(slug)}.mp4`;

  const res = await fetch(`${URL_BASE()}/storage/v1/object/${bucket}/${destino}`, {
    method: 'POST',
    headers: {
      apikey: CLAVE(),
      Authorization: `Bearer ${CLAVE()}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: fs.readFileSync(mp4),
  });

  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${URL_BASE()}/storage/v1/object/public/${bucket}/${destino}`;
}

/** Cuelga el video de una nota ya publicada. */
export async function marcarVideo(slug, { videoUrl, horizontalUrl = null, duracion, origen = 'propio' }) {
  await pedir(`notas?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: cabeceras({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      video_url: videoUrl,
      // El horizontal es opcional: si su render falló, la nota se queda con el
      // vertical antes que sin video.
      ...(horizontalUrl ? { video_horizontal_url: horizontalUrl } : {}),
      video_duracion: duracion ?? null,
      video_origen: origen,
      actualizada_en: new Date().toISOString(),
    }),
  });
  return videoUrl;
}

/** Crea el bucket de imágenes. Se corre una sola vez. */
export async function prepararBucket() {
  const res = await fetch(`${URL_BASE()}/storage/v1/bucket`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ name: 'medios', id: 'medios', public: true, file_size_limit: 52428800 }),
  });
  const cuerpo = await res.text();
  if (res.ok) return 'bucket "medios" creado y público';
  if (cuerpo.includes('already exists')) return 'bucket "medios" ya existía';
  throw new Error(`No se pudo crear el bucket: ${res.status} ${cuerpo.slice(0, 200)}`);
}

if (esPrincipal(import.meta.url)) {
  if (process.argv.includes('--preparar')) {
    console.log(await prepararBucket());
  } else {
    const filas = await pedir('notas?select=slug,titular,publicada_en&order=publicada_en.desc&limit=10', { headers: cabeceras() });
    console.log(`${filas.length} notas publicadas en el sitio:\n`);
    for (const f of filas) console.log(`  ${f.publicada_en.slice(0, 16)}  ${f.titular.slice(0, 66)}`);
  }
}
