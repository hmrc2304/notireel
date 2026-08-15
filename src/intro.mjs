/**
 * Intros de marca: el presentador hablando a cámara, generadas una sola vez con
 * Veo 3 y reusadas en todos los videos.
 *
 * Por qué no una por noticia: para que la boca coincida con cada texto habría que
 * generar un clip nuevo cada vez, y a 24 videos por día son cientos de dólares al
 * mes. Con frases fijas de marca el lipsync es real y el costo se paga una vez.
 *
 * Por qué VARIAS y no una sola: quien mira tres piezas seguidas escucha tres
 * veces la misma frase y el canal suena a robot. Con media docena rotando, la
 * cortina se sigue reconociendo pero no cansa.
 *
 *   node src/intro.mjs ana        genera la que falte
 *   node src/intro.mjs ana 3      genera solo la número 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS, esPrincipal } from './config.mjs';

const BASE = 'https://api.kie.ai/api/v1';
/**
 * Cada una es una apertura de noticiero distinta. Todas nombran la marca, que es
 * lo que tiene que quedar, y ninguna promete algo que la pieza no cumple.
 */
const FRASES = [
  'Notiviral. Las fuentes, a la vista.',
  'Esto es Notiviral. Vamos con lo que pasó.',
  'Notiviral. Lo que dicen los medios, comparado.',
  'Acá Notiviral, con la noticia y sus fuentes.',
  'Notiviral. Esto es lo que sabemos hasta ahora.',
  'Bienvenidos a Notiviral. Arrancamos.',
];

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
export async function generarIntro(avatarNombre = 'ana', numero = 1) {
  const FRASE = FRASES[(numero - 1) % FRASES.length];
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

      // La primera va sin número: es la que ya usaban los videos existentes.
      const sufijo = numero === 1 ? '' : `-${numero}`;
      const destino = path.join(DIRS.assets, `intro-${avatarNombre}${sufijo}.mp4`);
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
  const uno = process.argv[3] ? Number(process.argv[3]) : null;
  const pedidas = uno ? [uno] : FRASES.map((_, i) => i + 1);

  for (const n of pedidas) {
    const sufijo = n === 1 ? '' : `-${n}`;
    const destino = path.join(DIRS.assets, `intro-${nombre}${sufijo}.mp4`);

    // Sin número explícito se completan las que falten: cada generación cuesta
    // 60 créditos y rehacer las que ya están es tirar plata.
    if (!uno && fs.existsSync(destino)) {
      console.log(`${n}. ya existe ${path.basename(destino)}`);
      continue;
    }

    console.log(`${n}. "${FRASES[(n - 1) % FRASES.length]}"`);
    try {
      const salida = await generarIntro(nombre, n);
      console.log(`\n   ${path.basename(salida)} · ${(fs.statSync(salida).size / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
      console.error(`\n   ! ${e.message}`);
      if (/402|cr[eé]dito/i.test(e.message)) break;
    }
  }
}
