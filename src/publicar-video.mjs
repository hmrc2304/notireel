/**
 * Publicadores de TikTok y YouTube Shorts.
 *
 * El mp4 es exactamente el mismo que va a Instagram: 1080x1920, H.264 y AAC.
 * Lo único que cambia es cómo lo recibe cada plataforma, y ahí no se parecen en nada.
 *
 *   TikTok  sube por URL, igual que Instagram, pero exige que el dominio esté
 *           verificado en el panel de la app.
 *   YouTube sube el archivo por partes con un protocolo resumible, no acepta URL.
 *
 * Las dos usan OAuth con refresh token, así que el token de acceso se renueva en
 * cada corrida: pegar uno a mano dura horas y el cron corre todos los días.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, esPrincipal } from './config.mjs';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════════════════════ TikTok ═══════════════════════════ */

const TIKTOK = 'https://open.tiktokapis.com/v2';

async function tokenTikTok() {
  const res = await fetch(`${TIKTOK}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env('TIKTOK_CLIENT_KEY'),
      client_secret: env('TIKTOK_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: env('TIKTOK_REFRESH_TOKEN'),
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`TikTok OAuth: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

/**
 * Publica un Reel en TikTok a partir de una URL pública.
 * El dominio de `videoUrl` tiene que estar verificado en el panel de la app,
 * si no la API responde url_ownership_unverified.
 */
export async function publicarEnTikTok({ videoUrl, titulo }) {
  const token = await tokenTikTok();

  const alta = await fetch(`${TIKTOK}/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: titulo.slice(0, 2200),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
    }),
  });

  const data = await alta.json();
  const publishId = data?.data?.publish_id;
  if (!publishId) throw new Error(`TikTok init: ${JSON.stringify(data).slice(0, 400)}`);

  // TikTok baja y procesa el video; hasta que no termina, el posteo no existe.
  for (let i = 0; i < 40; i++) {
    await dormir(5000);
    const est = await fetch(`${TIKTOK}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId }),
    }).then((r) => r.json());

    const estado = est?.data?.status;
    if (estado === 'PUBLISH_COMPLETE') return publishId;
    if (estado === 'FAILED') throw new Error(`TikTok falló: ${est?.data?.fail_reason ?? 'sin motivo'}`);
  }
  throw new Error('TikTok: se agotó la espera del procesamiento');
}

/* ═══════════════════════════ YouTube ═══════════════════════════ */

async function tokenYouTube() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('YOUTUBE_CLIENT_ID'),
      client_secret: env('YOUTUBE_CLIENT_SECRET'),
      refresh_token: env('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`YouTube OAuth: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

/**
 * Sube el mp4 como Short. Para que YouTube lo trate como Short alcanza con que
 * sea vertical y dure menos de 3 minutos; el hashtag #Shorts ayuda a que lo
 * clasifique rápido.
 *
 * Ojo con la cuota: la Data API da 10.000 unidades por día y cada subida gasta
 * 1.600, o sea 6 videos diarios hasta que Google apruebe una ampliación.
 */
export async function publicarEnYouTube({ mp4, titulo, descripcion, etiquetas = [] }) {
  const token = await tokenYouTube();
  const tamano = fs.statSync(mp4).size;

  const metadatos = {
    snippet: {
      title: `${titulo.slice(0, 90)} #Shorts`.slice(0, 100),
      description: `${descripcion}\n\nLa nota completa en https://notiviral.com\n\n#Shorts #noticias`,
      tags: etiquetas.slice(0, 15),
      categoryId: '25', // News & Politics
      defaultLanguage: 'es',
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  // Paso 1: abrir la sesión resumible. Devuelve la URL donde va el archivo.
  const inicio = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(tamano),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadatos),
    },
  );

  if (!inicio.ok) throw new Error(`YouTube init ${inicio.status}: ${(await inicio.text()).slice(0, 300)}`);
  const destino = inicio.headers.get('location');
  if (!destino) throw new Error('YouTube no devolvió la URL de subida');

  // Paso 2: el archivo entero de una vez. A 8 MB no hace falta trocearlo.
  const subida = await fetch(destino, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(tamano) },
    body: fs.readFileSync(mp4),
  });

  const data = await subida.json();
  if (!data.id) throw new Error(`YouTube upload: ${JSON.stringify(data).slice(0, 400)}`);
  return data.id;
}

/** Cuánta cuota queda hoy, en videos. Sirve para no intentar la subida 7. */
export async function cuotaYouTube() {
  const token = await tokenYouTube();
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/videos?part=id&myRating=like&maxResults=1',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // La API no expone el saldo de cuota: lo único que se puede confirmar acá es
  // que el token sirve. El conteo real se lleva en el estado del motor.
  return { tokenValido: res.ok };
}

/* ═══════════════════════════ orquestación ═══════════════════════════ */

/**
 * Publica en todas las redes que estén configuradas. Una red sin credenciales
 * se saltea en silencio: así se pueden ir sumando de a una sin tocar el motor.
 */
export async function publicarEnTodas({ mp4, videoUrl, guion, nota }) {
  const out = { tiktok: null, youtube: null, errores: {} };

  const texto = `${guion.caption}\n\n${guion.hashtags.slice(0, 8).map((h) => `#${h}`).join(' ')}`;

  if (env('TIKTOK_REFRESH_TOKEN', false)) {
    try {
      out.tiktok = await publicarEnTikTok({ videoUrl, titulo: texto });
    } catch (e) {
      out.errores.tiktok = e.message;
      console.error(`  ! TikTok: ${e.message}`);
    }
  }

  if (env('YOUTUBE_REFRESH_TOKEN', false)) {
    try {
      out.youtube = await publicarEnYouTube({
        mp4,
        titulo: nota.titular ?? nota.titulo,
        descripcion: guion.caption,
        etiquetas: guion.hashtags,
      });
    } catch (e) {
      out.errores.youtube = e.message;
      console.error(`  ! YouTube: ${e.message}`);
    }
  }

  return out;
}

if (esPrincipal(import.meta.url)) {
  const redes = [];
  if (env('TIKTOK_REFRESH_TOKEN', false)) redes.push('TikTok');
  if (env('YOUTUBE_REFRESH_TOKEN', false)) redes.push('YouTube');

  if (!redes.length) {
    console.log('Ninguna de las dos está configurada todavía.\n');
    console.log('TikTok necesita:  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN');
    console.log('                  y el dominio del video verificado en el panel de la app.');
    console.log('YouTube necesita: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN');
    console.log('                  y pedir ampliación de cuota para pasar de 6 subidas por día.');
  } else {
    console.log(`Configuradas: ${redes.join(', ')}`);
    if (env('YOUTUBE_REFRESH_TOKEN', false)) console.log(await cuotaYouTube());
  }
}
