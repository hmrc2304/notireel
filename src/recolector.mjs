/**
 * Recolector: baja los feeds del catálogo, normaliza y deja una lista limpia.
 *
 * Parser propio de RSS y Atom. Traer una librería para esto es traer un árbol de
 * dependencias entero para resolver cuatro etiquetas, y en GitHub Actions cada
 * dependencia es un `npm install` más largo por corrida.
 *
 * Acá NO se decide nada: solo se junta. Agrupar y rankear vienen después.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, esPrincipal } from './config.mjs';
import { FUENTES } from './fuentes.mjs';

const UA = 'Mozilla/5.0 (compatible; notiviral-motor/1.0; +https://notiviral.com)';
const TIMEOUT = 20000;

/* ─────────────────────────── parseo ─────────────────────────── */

function limpiar(s = '') {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ')
    .trim();
}

const etiqueta = (bloque, nombre) =>
  bloque.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, 'i'))?.[1];

function enlace(bloque) {
  const directo = etiqueta(bloque, 'link');
  if (directo && limpiar(directo).startsWith('http')) return limpiar(directo);
  // Atom pone la URL en un atributo, no en el contenido.
  const atom = bloque.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)
    ?? bloque.match(/<link[^>]*href=["']([^"']+)/i);
  return atom?.[1] ?? null;
}

function imagen(bloque) {
  const m =
    bloque.match(/<media:content[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/i) ??
    bloque.match(/<media:thumbnail[^>]*url=["']([^"']+)/i) ??
    bloque.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/i) ??
    bloque.match(/<image[^>]*>\s*<url>([^<]+)<\/url>/i) ??
    bloque.match(/<img[^>]+src=["']([^"']+)/i);
  return m?.[1] ?? null;
}

/** El título de Google News trae " - Medio" pegado al final. */
function limpiarTitulo(t, medio) {
  if (medio !== 'Google News') return t;
  return t.replace(/\s+-\s+[^-]{2,40}$/, '').trim();
}

function parsear(xml, fuente) {
  const bloques = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);

  return bloques.map((b) => {
    const titulo = limpiarTitulo(limpiar(etiqueta(b, 'title') ?? ''), fuente.medio);
    const crudo = etiqueta(b, 'description') ?? etiqueta(b, 'summary') ?? etiqueta(b, 'content:encoded') ?? '';
    const fechaTxt = etiqueta(b, 'pubDate') ?? etiqueta(b, 'updated') ?? etiqueta(b, 'published') ?? etiqueta(b, 'dc:date');
    const fecha = fechaTxt ? new Date(limpiar(fechaTxt)) : null;

    return {
      titulo,
      resumen: limpiar(crudo).slice(0, 1200),
      url: enlace(b),
      imagen: imagen(b),
      fecha: fecha && !isNaN(fecha) ? fecha.toISOString() : null,
      medio: fuente.medio,
      fuenteId: fuente.id,
      idioma: fuente.idioma,
      alcance: fuente.alcance,
      peso: fuente.peso,
    };
  }).filter((x) => x.titulo.length > 15 && x.url);
}

/* ─────────────────────────── descarga ─────────────────────────── */

async function bajarFeed(fuente) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(fuente.url, { headers: { 'user-agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { fuente, error: `HTTP ${res.status}`, items: [] };
    return { fuente, items: parsear(await res.text(), fuente) };
  } catch (e) {
    return { fuente, error: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 60), items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Misma URL o mismo título exacto: es el mismo item repetido, no dos noticias. */
function quitarRepetidos(items) {
  const vistos = new Set();
  const out = [];
  for (const i of items) {
    const claves = [i.url.split('?')[0], i.titulo.toLowerCase()];
    if (claves.some((k) => vistos.has(k))) continue;
    claves.forEach((k) => vistos.add(k));
    out.push(i);
  }
  return out;
}

/**
 * Junta todo lo publicado en las últimas `horas`.
 * Un feed caído no frena al resto: se anota y se sigue.
 */
export async function recolectar({ horas = 24, fuentes = FUENTES } = {}) {
  const resultados = await Promise.all(fuentes.map(bajarFeed));

  const corte = Date.now() - horas * 3600000;
  const items = resultados.flatMap((r) => r.items).filter((i) => {
    if (!i.fecha) return false;
    return new Date(i.fecha).getTime() > corte;
  });

  const limpios = quitarRepetidos(items)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return {
    items: limpios,
    fallaron: resultados.filter((r) => r.error).map((r) => ({ medio: r.fuente.medio, error: r.error })),
    porMedio: Object.fromEntries(
      resultados.map((r) => [r.fuente.medio, r.items.length]),
    ),
  };
}

export function guardar(items, nombre = 'crudo') {
  const dir = path.join(DIRS.salida, 'noticias');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `${nombre}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify(items, null, 2), 'utf8');
  return archivo;
}

if (esPrincipal(import.meta.url)) {
  const horas = Number(process.argv[2] ?? 24);
  const t0 = Date.now();
  const { items, fallaron, porMedio } = await recolectar({ horas });

  console.log(`${items.length} noticias en las últimas ${horas} h (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);

  const orden = Object.entries(porMedio).sort((a, b) => b[1] - a[1]);
  for (const [medio, n] of orden) console.log(`  ${String(n).padStart(4)}  ${medio}`);

  if (fallaron.length) {
    console.log('\nFallaron:');
    for (const f of fallaron) console.log(`  ! ${f.medio}: ${f.error}`);
  }

  console.log(`\nGuardado en ${guardar(items)}`);
  console.log('\nÚltimas 5:');
  for (const i of items.slice(0, 5)) console.log(`  [${i.medio}] ${i.titulo.slice(0, 72)}`);
}
