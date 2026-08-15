/**
 * Acceso al baúl y a la cola desde el panel.
 *
 * Usa la clave de servicio, así que TODO lo de este archivo corre solo en el
 * servidor. Nada de esto puede terminar en un componente de cliente.
 */

import 'server-only';

const URL_BASE = process.env.SUPABASE_NOTIREEL_URL;
const CLAVE = process.env.SUPABASE_NOTIREEL_SERVICE_KEY;

function cabeceras(extra = {}) {
  return { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json', ...extra };
}

async function pedir(ruta, opciones = {}) {
  if (!URL_BASE || !CLAVE) throw new Error('Falta la configuración de Supabase en el panel');

  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    ...opciones,
    headers: cabeceras(opciones.headers),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const CAMPOS = 'id,titular,bajada,medios_count,nivel_mejor,ejes,partes_enfrentadas,solo_monitoreo,estado,puntaje,del_dia,creada_en,imagen_origen';

/** Lo guardado, con filtros de día y estado. */
export function listarBaul({ dia = null, estado = null, limite = 120 } = {}) {
  const partes = [`select=${CAMPOS}`, 'order=puntaje.desc', `limit=${limite}`];
  if (dia) partes.push(`del_dia=eq.${dia}`);
  if (estado && estado !== 'todas') partes.push(`estado=eq.${estado}`);
  return pedir(`baul?${partes.join('&')}`);
}

/** Los días que tienen material, para el selector de fecha. */
export async function diasConNoticias() {
  const filas = await pedir('baul?select=del_dia&order=del_dia.desc&limit=600');
  const cuenta = new Map();
  for (const f of filas ?? []) cuenta.set(f.del_dia, (cuenta.get(f.del_dia) ?? 0) + 1);
  return [...cuenta.entries()].map(([dia, total]) => ({ dia, total }));
}

export async function unaDelBaul(id) {
  const [fila] = (await pedir(`baul?select=*&id=eq.${id}&limit=1`)) ?? [];
  return fila ?? null;
}

/** Deja el pedido en la cola. El trabajador lo levanta y produce. */
export async function encolar({ baulId, modo, avatar = 'ana', cuerpo = 'foto', redes = [] }) {
  const [ya] = (await pedir(`trabajos?select=id,estado&baul_id=eq.${baulId}&estado=in.(pendiente,tomado)&limit=1`)) ?? [];
  if (ya) return { yaEstaba: true, id: ya.id };

  const [creado] = await pedir('trabajos', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ baul_id: baulId, modo, avatar, cuerpo, redes }),
  });
  return { yaEstaba: false, id: creado.id };
}

/**
 * Saca un pedido de la cola.
 *
 * Solo mientras esté `pendiente`: si el trabajador ya lo tomó está redactando y
 * gastando voz en otra máquina, y marcarlo cancelado acá no lo detendría, solo
 * haría creer que sí. El filtro va en la consulta, así que la carrera la resuelve
 * Postgres y no el panel.
 */
export async function cancelar(trabajoId) {
  const filas = await pedir(`trabajos?id=eq.${trabajoId}&estado=eq.pendiente`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ estado: 'cancelado', terminado_en: new Date().toISOString() }),
  });
  return filas?.length > 0;
}

export function listarTrabajos(limite = 30) {
  return pedir(`trabajos?select=*,baul(titular)&order=pedido_en.desc&limit=${limite}`);
}

export function descartar(baulId) {
  return pedir(`baul?id=eq.${baulId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'descartada' }),
  });
}
