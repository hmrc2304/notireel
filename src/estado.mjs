/**
 * Registro de lo ya publicado.
 *
 * En GitHub Actions el disco se borra entre corridas, así que el estado vive en
 * el bucket de Supabase y el archivo local queda solo como copia y como modo
 * de trabajo sin credenciales.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS } from './config.mjs';

const LOCAL = path.join(DIRS.salida, 'estado.json');
const REMOTO = 'estado/estado.json';
const VACIO = { publicadas: {}, ultimaPublicacion: null };

function credenciales() {
  const url = env('SUPABASE_MEDIA_URL', false);
  const key = env('SUPABASE_MEDIA_SERVICE_KEY', false);
  if (!url || !key) return null;
  return { url, key, bucket: env('SUPABASE_MEDIA_BUCKET', false) ?? 'videos' };
}

function leerLocal() {
  if (!fs.existsSync(LOCAL)) return { ...VACIO };
  try {
    return { ...VACIO, ...JSON.parse(fs.readFileSync(LOCAL, 'utf8')) };
  } catch {
    return { ...VACIO };
  }
}

export async function leerEstado() {
  const c = credenciales();
  if (!c) return leerLocal();

  try {
    const res = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${REMOTO}`, {
      headers: { Authorization: `Bearer ${c.key}`, apikey: c.key },
      cache: 'no-store',
    });
    if (res.ok) return { ...VACIO, ...(await res.json()) };
    if (res.status === 400 || res.status === 404) return { ...VACIO }; // todavía no existe
    throw new Error(`storage ${res.status}`);
  } catch (e) {
    console.error(`  ! no pude leer el estado remoto (${e.message}), uso el local`);
    return leerLocal();
  }
}

export async function guardarEstado(estado) {
  fs.writeFileSync(LOCAL, JSON.stringify(estado, null, 2), 'utf8');

  const c = credenciales();
  if (!c) return;

  const res = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${REMOTO}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.key}`,
      apikey: c.key,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(estado),
  });
  if (!res.ok) throw new Error(`No pude guardar el estado remoto: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function marcar(id, datos) {
  const e = await leerEstado();
  e.publicadas[id] = { cuando: new Date().toISOString(), ...datos };
  if (datos.ig || datos.fb) e.ultimaPublicacion = new Date().toISOString();
  await guardarEstado(e);
  return e;
}

/** Minutos desde el último posteo. Infinity si nunca se publicó. */
export async function minutosDesdeElUltimo() {
  const e = await leerEstado();
  if (!e.ultimaPublicacion) return Infinity;
  return (Date.now() - new Date(e.ultimaPublicacion).getTime()) / 60000;
}
