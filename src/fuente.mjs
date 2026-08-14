import { esPrincipal } from './config.mjs';
/**
 * Fuente de noticias: lee notiviral.com sin credenciales.
 *
 * El sitio corre en Lovable Cloud (SSR), así que cada nota expone un bloque
 * JSON-LD NewsArticle con headline, description, imagen firmada y fechas.
 * El cuerpo completo viene en el HTML renderizado. No hace falta tocar
 * su Supabase ni pedirle claves a la plataforma.
 */

const SITE = 'https://notiviral.com';
const UA = 'notiviral-motor/1.0 (+https://notiviral.com)';

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${url}`);
  return res.text();
}

/** Devuelve las URLs de noticia del sitemap, de la más nueva a la más vieja. */
export async function listarNoticias() {
  const xml = await get(`${SITE}/sitemap.xml`);
  const entradas = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const bloque = m[1];
    const loc = bloque.match(/<loc>(.*?)<\/loc>/)?.[1] ?? '';
    const lastmod = bloque.match(/<lastmod>(.*?)<\/lastmod>/)?.[1] ?? '';
    return { loc, lastmod };
  });

  return entradas
    .filter((e) => e.loc.includes('/noticia/'))
    .sort((a, b) => new Date(b.lastmod) - new Date(a.lastmod));
}

function texto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lee una nota y devuelve todo lo que el motor necesita para armar el video. */
export async function leerNoticia(url) {
  const html = await get(url);

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!ld) throw new Error(`sin JSON-LD en ${url}`);
  const datos = JSON.parse(ld);

  // El cuerpo arranca después de la bajada y termina antes del pie del sitio.
  const plano = texto(html);
  const desde = plano.indexOf(datos.description.replace(/…$/, '').slice(0, 60));
  const cuerpo = desde >= 0 ? plano.slice(desde) : plano;

  return {
    id: url.split('/').pop(),
    url,
    titular: datos.headline,
    bajada: datos.description,
    imagen: Array.isArray(datos.image) ? datos.image[0] : datos.image,
    seccion: datos.articleSection ?? 'Últimas noticias',
    publicada: datos.datePublished,
    actualizada: datos.dateModified,
    cuerpo: cuerpo.slice(0, 4000),
  };
}

/** Las N noticias más recientes, ya leídas. */
export async function ultimas(n = 5) {
  const lista = await listarNoticias();
  const out = [];
  for (const { loc } of lista.slice(0, n)) {
    try {
      out.push(await leerNoticia(loc));
    } catch (e) {
      console.error(`  ! ${loc}: ${e.message}`);
    }
  }
  return out;
}

import { pathToFileURL } from 'node:url';

if (esPrincipal(import.meta.url)) {
  const n = Number(process.argv[2] ?? 3);
  const notas = await ultimas(n);
  for (const x of notas) {
    console.log(`\n[${x.seccion}] ${x.titular}`);
    console.log(`  ${x.bajada}`);
    console.log(`  img: ${x.imagen.slice(0, 90)}...`);
    console.log(`  cuerpo: ${x.cuerpo.length} chars | actualizada: ${x.actualizada}`);
  }
  console.log(`\nTotal: ${notas.length} noticias`);
}
