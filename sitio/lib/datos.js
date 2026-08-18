/**
 * Lectura de notas desde Supabase por PostgREST directo.
 *
 * Sin @supabase/supabase-js a propósito: para leer con la clave pública alcanza
 * con fetch, y el cliente entero pesa más que todo lo que hace este archivo.
 */

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const CLAVE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SECCIONES = ['Mundo', 'Política', 'Economía', 'Sociedad', 'Tecnología', 'Ciencia', 'Deportes'];

const CAMPOS = 'id,slug,titular,bajada,seccion,certeza,imagen_url,imagen_generada,video_url,video_origen,publicada_en,visitas,medios_count,etiquetas';

async function consultar(ruta, { revalidate = 300 } = {}) {
  if (!URL_BASE || !CLAVE) return [];

  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` },
    next: { revalidate },
  });

  if (!res.ok) {
    console.error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  return res.json();
}

export function portada({ limite = 24 } = {}) {
  return consultar(`notas?select=${CAMPOS}&order=publicada_en.desc&limit=${limite}`);
}

export function porSeccion(seccion, limite = 30) {
  return consultar(
    `notas?select=${CAMPOS}&seccion=eq.${encodeURIComponent(seccion)}&order=publicada_en.desc&limit=${limite}`,
  );
}

export async function porSlug(slug) {
  const filas = await consultar(
    `notas?select=*,fuentes(medio,titulo,url,fecha,tipo,orden)&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    { revalidate: 600 },
  );
  const nota = filas[0];
  if (nota?.fuentes) nota.fuentes.sort((a, b) => a.orden - b.orden);
  return nota ?? null;
}

export function relacionadas(nota, limite = 4) {
  return consultar(
    `notas?select=${CAMPOS}&seccion=eq.${encodeURIComponent(nota.seccion)}&slug=neq.${encodeURIComponent(nota.slug)}&order=publicada_en.desc&limit=${limite}`,
  );
}

/** Todas las notas para el sitemap y el feed. Solo lo indispensable. */
export function todasParaIndice(limite = 1000) {
  return consultar(`notas?select=slug,titular,bajada,publicada_en,actualizada_en,seccion&order=publicada_en.desc&limit=${limite}`, {
    revalidate: 1800,
  });
}

/* ── formato ── */

export function fechaLarga(iso) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function haceCuanto(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

export const ETIQUETA_CERTEZA = {
  confirmado: { texto: 'Confirmado', detalle: 'Varios medios independientes coinciden' },
  en_desarrollo: { texto: 'En desarrollo', detalle: 'Los datos todavía cambian' },
  version_unica: { texto: 'Una sola fuente', detalle: 'Lo reporta un solo medio' },
};

/**
 * Cuánto lleva leer la nota, redondeado al minuto.
 *
 * 200 palabras por minuto es el ritmo que usan los medios para este dato en
 * español. Se muestra porque el lector llega desde un video de treinta segundos
 * y decide en el acto si entra o no: saber que son dos minutos y no diez es
 * parte de esa decisión.
 */
export function minutosDeLectura(cuerpo = '') {
  const palabras = String(cuerpo).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(palabras / 200));
}
