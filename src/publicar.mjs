/**
 * Publicación en Instagram Reels y Facebook mediante la Graph API.
 *
 * Instagram NO acepta el archivo subido directo: hay que pasarle una URL pública
 * desde donde Meta se baja el mp4. Por eso el video primero se sube a un bucket
 * público de Supabase y recién después se crea el contenedor.
 *
 * Flujo de IG (3 pasos, y el 2 no se puede saltear):
 *   1. POST /{ig-user-id}/media          -> devuelve un creation_id
 *   2. GET  /{creation_id}?fields=status_code  -> esperar a que pase a FINISHED
 *   3. POST /{ig-user-id}/media_publish  -> queda publicado
 *
 * Facebook sí acepta la subida directa por URL en un solo paso.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { env, DIRS , esPrincipal } from './config.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── alojamiento ─────────────────────────── */

/**
 * Sube el mp4 a un bucket público de Supabase y devuelve la URL.
 * El bucket tiene que existir y ser público: node src/publicar.mjs --preparar
 */
export async function subirVideo(mp4) {
  const url = env('SUPABASE_MEDIA_URL');
  const key = env('SUPABASE_MEDIA_SERVICE_KEY');
  const bucket = env('SUPABASE_MEDIA_BUCKET', false) ?? 'videos';

  const nombre = `${new Date().toISOString().slice(0, 10)}/${path.basename(mp4)}`;
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${nombre}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: fs.readFileSync(mp4),
  });

  if (!res.ok) throw new Error(`Supabase storage ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `${url}/storage/v1/object/public/${bucket}/${nombre}`;
}

/**
 * Borra el mp4 del bucket. Meta ya se quedó con su copia, así que el archivo
 * solo tiene que vivir los dos minutos de la subida: manteniéndolo efímero,
 * 24 videos por día entran en el plan gratuito sin problema.
 */
export async function borrarVideo(publicUrl) {
  const url = env('SUPABASE_MEDIA_URL');
  const key = env('SUPABASE_MEDIA_SERVICE_KEY');
  const bucket = env('SUPABASE_MEDIA_BUCKET', false) ?? 'videos';

  const nombre = publicUrl.split(`/object/public/${bucket}/`)[1];
  if (!nombre) return false;

  const res = await fetch(`${url}/storage/v1/object/${bucket}/${nombre}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  return res.ok;
}

/** Crea el bucket público. Se corre una sola vez. */
export async function prepararBucket() {
  const url = env('SUPABASE_MEDIA_URL');
  const key = env('SUPABASE_MEDIA_SERVICE_KEY');
  const bucket = env('SUPABASE_MEDIA_BUCKET', false) ?? 'videos';

  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: bucket, id: bucket, public: true, file_size_limit: 209715200 }),
  });

  const cuerpo = await res.text();
  if (res.ok) return `bucket "${bucket}" creado y público`;
  if (cuerpo.includes('already exists')) return `bucket "${bucket}" ya existía`;
  throw new Error(`No se pudo crear el bucket: ${res.status} ${cuerpo.slice(0, 300)}`);
}

/* ─────────────────────────── Instagram ─────────────────────────── */

function pie(guion, nota) {
  const tags = guion.hashtags.slice(0, 12).map((h) => `#${h.replace(/[^\p{L}\p{N}_]/gu, '')}`).join(' ');
  return `${guion.caption}\n\nLa nota completa en notiviral.com\n\n${tags}`;
}

export async function publicarReel({ videoUrl, texto }) {
  const igId = env('IG_USER_ID');
  const token = env('META_PAGE_TOKEN');

  const alta = await fetch(`${GRAPH}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: texto,
      share_to_feed: true,
      access_token: token,
    }),
  });

  const creado = await alta.json();
  if (!creado.id) throw new Error(`IG media: ${JSON.stringify(creado).slice(0, 400)}`);

  // Meta baja y transcodifica el video. Suele tardar entre 20 y 90 segundos.
  for (let i = 0; i < 60; i++) {
    await dormir(5000);
    const est = await fetch(
      `${GRAPH}/${creado.id}?fields=status_code,status&access_token=${token}`,
    ).then((r) => r.json());

    if (est.status_code === 'FINISHED') break;
    if (est.status_code === 'ERROR') throw new Error(`IG transcodificación falló: ${est.status ?? ''}`);
    if (i === 59) throw new Error('IG: el contenedor nunca llegó a FINISHED');
  }

  const pub = await fetch(`${GRAPH}/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creado.id, access_token: token }),
  }).then((r) => r.json());

  if (!pub.id) throw new Error(`IG publish: ${JSON.stringify(pub).slice(0, 400)}`);
  return pub.id;
}

/* ─────────────────────────── Facebook ─────────────────────────── */

export async function publicarEnFacebook({ videoUrl, texto }) {
  const pageId = env('FB_PAGE_ID');
  const token = env('META_PAGE_TOKEN');

  const res = await fetch(`${GRAPH}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_url: videoUrl, description: texto, access_token: token }),
  });

  const data = await res.json();
  if (!data.id) throw new Error(`FB videos: ${JSON.stringify(data).slice(0, 400)}`);
  return data.id;
}

/* ─────────────────────────── orquestación ─────────────────────────── */

/**
 * Sube una vez y publica en las dos redes. Si una falla, la otra igual sale:
 * perder los dos posteos porque Instagram tuvo un hipo no tiene sentido.
 */
export async function publicarEnRedes({ mp4, guion, nota }) {
  const texto = pie(guion, nota);
  const videoUrl = await subirVideo(mp4);
  const out = { videoUrl, ig: null, fb: null, errores: {} };

  try {
    out.ig = await publicarReel({ videoUrl, texto });
  } catch (e) {
    out.errores.ig = e.message;
    console.error(`  ! Instagram: ${e.message}`);
  }

  try {
    out.fb = await publicarEnFacebook({ videoUrl, texto });
  } catch (e) {
    out.errores.fb = e.message;
    console.error(`  ! Facebook: ${e.message}`);
  }

  if (!out.ig && !out.fb) throw new Error('No se pudo publicar en ninguna red');

  try {
    await borrarVideo(videoUrl);
  } catch {
    // Que quede un archivo suelto no justifica marcar como fallido un posteo que salió.
  }
  return out;
}

/** Chequeo previo: confirma que el token ve la página y la cuenta de IG. */
export async function verificarAccesos() {
  const token = env('META_PAGE_TOKEN');
  const pageId = env('FB_PAGE_ID');

  const pagina = await fetch(
    `${GRAPH}/${pageId}?fields=name,instagram_business_account{username,id}&access_token=${token}`,
  ).then((r) => r.json());

  if (pagina.error) throw new Error(`Token inválido: ${pagina.error.message}`);
  return {
    pagina: pagina.name,
    instagram: pagina.instagram_business_account?.username ?? null,
    igId: pagina.instagram_business_account?.id ?? null,
  };
}

if (esPrincipal(import.meta.url)) {
  if (process.argv.includes('--preparar')) {
    console.log(await prepararBucket());
  } else if (process.argv.includes('--verificar')) {
    console.log(await verificarAccesos());
  } else {
    console.log('Uso: node src/publicar.mjs --verificar | --preparar');
  }
}
