/**
 * Intro de marca: el presentador hablando a cámara, generado UNA sola vez con
 * Veo 3 y reusado en todos los videos.
 *
 * Por qué una sola y no una por noticia: para que la boca coincida con cada hook
 * habría que generar un clip nuevo cada vez, y a 24 videos por día son cientos de
 * dólares al mes. Con una frase fija de marca el lipsync es real, el costo se paga
 * una vez y la repetición juega a favor: la gente reconoce la cortina.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS, esPrincipal } from './config.mjs';

const BASE = 'https://api.kie.ai/api/v1';
const FRASE = 'Noti Reel. Las fuentes, a la vista.';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Veo necesita la imagen en una URL pública: va al bucket del sitio. */
async function subirAvatar(avatarNombre) {
  const url = env('SUPABASE_NOTIREEL_URL');
  const key = env('SUPABASE_NOTIREEL_SERVICE_KEY');
  const local = path.join(DIRS.assets, `avatar-${avatarNombre}.png`);
  if (!fs.existsSync(local)) throw new Error(`Falta ${local}`);

  const destino = `avatares/${avatarNombre}.png`;
  const res = await fetch(`${url}/storage/v1/object/medios/${destino}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: fs.readFileSync(local),
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${url}/storage/v1/object/public/medios/${destino}`;
}

/**
 * Genera el clip. El diálogo va DENTRO del prompt porque Veo sintetiza la voz y
 * el lipsync a partir de ahí; pedirlo aparte da una boca que no coincide.
 */
export async function generarIntro(avatarNombre = 'ana') {
  const imagen = await subirAvatar(avatarNombre);
  console.log(`  avatar publicado, generando el clip...`);

  const prompt =
    `The news anchor from the image looks straight into the camera in a modern TV news studio ` +
    `and says in neutral Latin American Spanish, clearly and with a confident, warm tone: ` +
    `"${FRASE}". ` +
    `Subtle natural head movement, natural blinking, professional broadcast lighting. ` +
    `Static camera, chest-up framing. Photorealistic, real skin texture, no CGI look. ` +
    `No on-screen text, no captions, no graphics.`;

  const alta = await fetch(`${BASE}/veo/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('KIE_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: 'veo3_fast', aspectRatio: '9:16', imageUrls: [imagen] }),
  });

  const creado = await alta.json();
  if (creado.code === 402) throw new Error('Kie sin créditos (402)');
  const taskId = creado?.data?.taskId;
  if (!taskId) throw new Error(`Veo no devolvió taskId: ${JSON.stringify(creado).slice(0, 300)}`);

  // 20 minutos: con imagen de referencia, Veo se queda en cola mucho más que los
  // 2 o 3 minutos de una generación desde texto. Con 7 minutos y medio se cortaba
  // antes de tiempo (sin consumir créditos, porque Kie cobra recién al completar).
  console.log(`  tarea ${taskId}`);
  for (let i = 0; i < 240; i++) {
    await dormir(5000);
    const info = await fetch(`${BASE}/veo/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${env('KIE_API_KEY')}` },
    }).then((r) => r.json());

    // El campo es successFlag, NO status: /veo/record-info no devuelve ningún
    // `status`, así que leerlo daba undefined para siempre y el polling se comía
    // los 20 minutos con el video ya terminado del otro lado.
    //   successFlag 0 = en curso · 1 = listo · 2 y 3 = falló
    const estado = info?.data?.successFlag;
    if (i > 0 && i % 24 === 0) console.log(`\n  [${i * 5}s] successFlag=${JSON.stringify(estado)}`);

    if (estado === 1) {
      const urls = info?.data?.response?.resultUrls ?? [];
      const mp4 = urls.find((u) => String(u).includes('.mp4')) ?? urls[0];
      if (!mp4) throw new Error('Veo terminó sin devolver el mp4');

      const destino = path.join(DIRS.assets, `intro-${avatarNombre}.mp4`);
      const bin = await fetch(mp4).then((r) => r.arrayBuffer());
      fs.writeFileSync(destino, Buffer.from(bin));
      return destino;
    }
    if (estado === 2 || estado === 3) {
      throw new Error(`Veo falló: ${info?.data?.errorMessage || info?.data?.errorCode || 'sin motivo'}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`Veo: se agotó la espera de 20 min. La tarea ${taskId} puede seguir viva: ` +
    `consultá ${BASE}/veo/record-info?taskId=${taskId} antes de volver a generar, o pagás dos veces.`);
}

if (esPrincipal(import.meta.url)) {
  const nombre = process.argv[2] ?? 'ana';
  console.log(`Generando la intro de ${nombre} con Veo 3...`);
  const salida = await generarIntro(nombre);
  console.log(`\nListo: ${salida} (${(fs.statSync(salida).size / 1024 / 1024).toFixed(1)} MB)`);
}
