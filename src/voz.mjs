/**
 * Locución con ElevenLabs.
 *
 * Usa el endpoint with-timestamps: devuelve el audio Y la posición temporal de
 * cada carácter. Con eso armamos los subtítulos exactos sin pasar por un STT,
 * que sería un segundo costo y una segunda fuente de error.
 *
 * Modelo flash_v2_5: consume la mitad de créditos que multilingual_v2 y para
 * lectura de noticias la diferencia de calidad no se nota.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { env, DIRS , esPrincipal } from './config.mjs';

const API = 'https://api.elevenlabs.io/v1';

/** Voces validadas en la cuenta. La default es neutra a propósito: el alcance es mundial. */
export const VOCES = {
  langa: 'sqoAbxNYZX3JdDUTNetR',   // neutral, cálida y calma (mujer)
  paola: 'PoLFkTquRWtbexdwW3Xa',   // podcast y voiceover (mujer)
  malena: 'p7AwDmKvTdoHTBuueGvP',  // cálida, dinámica y confiada (mujer)
  lionel: 'MjtZn5tagxL1RO6w9ER5',  // narrador natural y versátil (hombre)
  bautista: 'Hw05DSJqSd5iZ9AswbcE', // smooth y articulado (hombre)
  facundo: 'qnvusyIjzlSoWYJ0C2Nm', // rítmico y expresivo (hombre)
};

/**
 * Locuta el libreto. Devuelve { mp3, palabras: [{ palabra, desde, hasta }], duracion }.
 */
export async function locutar(texto, destino, { voz = 'langa', modelo = 'eleven_flash_v2_5' } = {}) {
  const voiceId = VOCES[voz] ?? voz;

  const res = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: texto,
      model_id: modelo,
      // Estabilidad alta y estilo bajo: tono de noticiero, sin dramatismo.
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, Buffer.from(data.audio_base64, 'base64'));

  const palabras = agruparEnPalabras(data.alignment ?? data.normalized_alignment);
  const duracion = palabras.length ? palabras[palabras.length - 1].hasta : 0;

  return { mp3: destino, palabras, duracion };
}

/** El alignment viene por carácter; lo agrupamos en palabras para los subtítulos. */
function agruparEnPalabras(al) {
  if (!al) return [];
  const chars = al.characters;
  const desde = al.character_start_times_seconds;
  const hasta = al.character_end_times_seconds;

  const out = [];
  let actual = '';
  let ini = null;

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (actual) {
        out.push({ palabra: actual, desde: ini, hasta: hasta[i - 1] });
        actual = '';
        ini = null;
      }
    } else {
      if (!actual) ini = desde[i];
      actual += c;
    }
  }
  if (actual) out.push({ palabra: actual, desde: ini, hasta: hasta[chars.length - 1] });
  return out;
}

/** Cuántos créditos quedan. Sirve para frenar el cron antes de que falle. */
export async function creditos() {
  const res = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const s = await res.json();
  return { usados: s.character_count, limite: s.character_limit, restantes: s.character_limit - s.character_count };
}

if (esPrincipal(import.meta.url)) {
  const c = await creditos();
  console.log(`Créditos: ${c.usados}/${c.limite} (quedan ${c.restantes})`);

  const texto = process.argv[2] ?? 'Prueba de locución para Noti Viral. 5 petardos, 281 fallecidos, 800 mil barriles.';
  const salida = path.join(DIRS.temp, 'prueba-voz.mp3');
  const r = await locutar(texto, salida);
  console.log(`Audio: ${r.mp3}`);
  console.log(`Duración: ${r.duracion.toFixed(2)}s | ${r.palabras.length} palabras`);
  console.log(`Primeras: ${r.palabras.slice(0, 6).map((p) => `${p.palabra}(${p.desde.toFixed(2)})`).join(' ')}`);
}
