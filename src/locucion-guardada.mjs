/**
 * Guarda y recupera la locución de una nota, para no pagarla dos veces.
 *
 * Rehacer un video por un cambio de maqueta no necesita audio nuevo: el guion es
 * el mismo y la voz suena idéntica. Aun así, el rehacedor volvía a llamar a
 * ElevenLabs cada vez. Cinco pasadas de maqueta en un día sobre dieciséis notas
 * se comieron los 10.034 créditos del plan y la sexta murió con seis créditos en
 * la cuenta, a mitad de camino.
 *
 * Con el mp3 y los timestamps guardados, cambiar la tipografía cuesta cero de
 * voz. Se vuelve a locutar solo si cambió el libreto, que es cuando de verdad
 * hace falta.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS } from './config.mjs';

const BUCKET = 'medios';
const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

/** Nombre estable por nota: no lleva fecha, así se pisa a sí mismo. */
const rutaDe = (slug, ext) => `locuciones/${slug.slice(0, 60)}.${ext}`;

async function subir(destino, cuerpo, tipo) {
  const res = await fetch(`${URL_BASE()}/storage/v1/object/${BUCKET}/${destino}`, {
    method: 'POST',
    headers: {
      apikey: CLAVE(),
      Authorization: `Bearer ${CLAVE()}`,
      'Content-Type': tipo,
      'x-upsert': 'true',
    },
    body: cuerpo,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

/**
 * Deja la locución lista para reusar. Que falle no puede voltear la producción:
 * el video ya está hecho, esto es solo el ahorro de la próxima vez.
 */
export async function guardar(slug, { guion, voz, locucion }) {
  try {
    await subir(rutaDe(slug, 'mp3'), fs.readFileSync(locucion.mp3), 'audio/mpeg');
    await subir(
      rutaDe(slug, 'json'),
      JSON.stringify({ guion, voz, palabras: locucion.palabras, duracion: locucion.duracion }),
      'application/json',
    );
    return true;
  } catch (e) {
    console.error(`    ! no pude guardar la locución (${e.message.slice(0, 60)})`);
    return false;
  }
}

/**
 * Devuelve el guion y la locución guardados para esa voz, o null.
 *
 * Van juntos y no por separado porque los timestamps son de ese libreto exacto:
 * un guion nuevo con el audio viejo deja los subtítulos corridos toda la pieza.
 * Reusar los dos ahorra la llamada al modelo además de la de la voz.
 */
export async function recuperar(slug, { voz }) {
  const base = `${URL_BASE()}/storage/v1/object/public/${BUCKET}`;

  let datos;
  try {
    const r = await fetch(`${base}/${rutaDe(slug, 'json')}`);
    if (!r.ok) return null;
    datos = await r.json();
  } catch {
    return null;
  }

  if (datos.voz !== voz || !datos.palabras?.length || !datos.guion?.libreto) return null;

  const destino = path.join(DIRS.temp, `${slug.slice(0, 24)}-guardada.mp3`);
  try {
    const r = await fetch(`${base}/${rutaDe(slug, 'mp3')}`);
    if (!r.ok) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 2048) return null;
    fs.writeFileSync(destino, bytes);
  } catch {
    return null;
  }

  return {
    guion: datos.guion,
    locucion: { mp3: destino, palabras: datos.palabras, duracion: datos.duracion },
  };
}
