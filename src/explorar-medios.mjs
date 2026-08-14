/**
 * Explora el directorio de medios y le busca el feed a cada uno.
 *
 * Dos formas de encontrarlo, en este orden:
 *  1. La propia home lo declara con <link rel="alternate" type="application/rss+xml">.
 *     Es lo correcto y lo que usa la mayoría de los medios serios.
 *  2. Probar las rutas habituales (/rss, /feed, /rss.xml…). Muchos medios tienen
 *     feed pero no lo declaran.
 *
 * Un feed cuenta solo si además devuelve items: varios responden 200 con una
 * página de error o un XML vacío.
 *
 *   node src/explorar-medios.mjs                 explora todo el directorio
 *   node src/explorar-medios.mjs --limite 30     prueba con los primeros 30
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, esPrincipal } from './config.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const TIMEOUT = 6000;
const EN_PARALELO = 6;

/** Rutas que prueban los medios que no declaran el feed en la home. */
const RUTAS = [
  '/rss', '/feed', '/rss.xml', '/feed.xml', '/rss/', '/feed/',
  '/index.xml', '/atom.xml', '/rss/all.xml', '/en/rss', '/es/rss',
  '/arc/outboundfeeds/rss/?outputType=xml',
  '/rss/portada.xml', '/rssfeeds/', '/rss/news.xml',
  '/feeds/rss.xml', '/rss/index.xml', '/rss/rss.xml', '/en/feed',
  '/rss/news', '/feeds/all.rss.xml', '/rss/todo.xml', '/news/rss',
];

/**
 * Salida universal: Google News publica un feed por sitio.
 *
 * Sirve para los medios que cerraron su RSS (cada vez más) o lo esconden detrás
 * de un muro. Trae menos control sobre qué secciones llegan y el titular viene con
 * el nombre del medio pegado al final, pero es la diferencia entre tener la fuente
 * o no tenerla.
 */
function feedsDeGoogleNews(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const partes = host.split('.');
    // El dominio raíz, contemplando los dominios de dos niveles (.com.ar, .co.uk).
    const raiz = partes.length > 2 && partes.at(-2).length <= 3
      ? partes.slice(-3).join('.')
      : partes.slice(-2).join('.');

    const armar = (sitio) =>
      `https://news.google.com/rss/search?q=when:2d+site:${sitio}&hl=es-419&gl=AR&ceid=AR:es-419`;

    return [...new Set([host, raiz])].map(armar);
  } catch {
    return [];
  }
}

/* ─────────────────────── el directorio ─────────────────────── */

const NIVEL_A_PESO = { A: 1.3, B: 1.0, C: 0.6, D: 0.3 };

/** Lee el .txt del directorio y devuelve los medios con sus metadatos. */
export function leerDirectorio(archivo) {
  const texto = fs.readFileSync(archivo, 'utf8');
  const medios = [];
  let region = '';
  let pais = '';
  let orientacion = '';

  for (const linea of texto.split('\n')) {
    const l = linea.replace(/\r/g, '');
    const limpio = l.trim();
    if (!limpio || limpio.startsWith('=') || limpio.startsWith('#')) continue;

    // Encabezado de región: en mayúsculas y sin sangría.
    if (!l.startsWith(' ') && !limpio.startsWith('-') && limpio === limpio.toUpperCase() && !limpio.includes('|')) {
      if (limpio.endsWith(':')) pais = limpio.slice(0, -1);
      else region = limpio;
      continue;
    }
    // Encabezado de orientación: sangrado y terminado en dos puntos.
    if (limpio.endsWith(':') && !limpio.startsWith('-')) {
      orientacion = limpio.slice(0, -1).trim();
      continue;
    }

    if (!limpio.startsWith('-') || !limpio.includes('|')) continue;

    const partes = limpio.replace(/^-\s*/, '').split('|').map((p) => p.trim());
    if (partes.length < 3) continue;

    const [nombre, url, nivelCrudo, idioma, formato, eje] = partes;
    const nivel = (nivelCrudo.match(/Nivel\s+([ABCD])/i)?.[1] ?? 'B').toUpperCase();

    medios.push({
      nombre,
      url,
      nivel,
      peso: NIVEL_A_PESO[nivel],
      idioma: idioma ?? '',
      formato: formato ?? '',
      eje: eje ?? '',
      region,
      pais,
      orientacion,
    });
  }

  return medios;
}

/* ─────────────────────── descubrimiento ─────────────────────── */

/**
 * Descarga con timeout.
 *
 * Usa `AbortSignal.timeout` en vez de un AbortController con setTimeout: abortar
 * decenas de sockets TLS a mano hace que el cliente HTTP de Node reviente el
 * proceso entero con un AssertionError desde su parser, y se pierde toda la
 * exploración por una conexión que colgó.
 */
async function bajar(url, comoTexto = true) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, estado: res.status };
    return { ok: true, estado: res.status, cuerpo: comoTexto ? await res.text() : null, url: res.url };
  } catch (e) {
    return { ok: false, estado: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'error' };
  }
}

/** ¿Este XML es un feed con contenido de verdad? */
function esFeedUtil(cuerpo) {
  if (!cuerpo || cuerpo.length < 200) return 0;
  const cabecera = cuerpo.slice(0, 800).toLowerCase();
  if (!/<rss|<feed|<rdf/.test(cabecera)) return 0;
  return [...cuerpo.matchAll(/<item[\s>]|<entry[\s>]/gi)].length;
}

/** Feeds que la home declara en su <head>. */
function feedsDeclarados(html, base) {
  const encontrados = [];
  const re = /<link[^>]+>/gi;
  for (const [tag] of html.matchAll(re)) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      encontrados.push(new URL(href, base).href);
    } catch { /* href malformado */ }
  }
  return [...new Set(encontrados)].slice(0, 6);
}

/** Busca el feed de un medio y lo valida. */
export async function buscarFeed(medio) {
  const base = medio.url.replace(/\/+$/, '');

  // 1. Lo que declare la home.
  const home = await bajar(base);
  if (home.ok && home.cuerpo) {
    for (const candidato of feedsDeclarados(home.cuerpo, home.url ?? base)) {
      const r = await bajar(candidato);
      const items = r.ok ? esFeedUtil(r.cuerpo) : 0;
      if (items > 0) return { ...medio, feed: candidato, items, via: 'declarado' };
    }
  }

  // 2. Las rutas de siempre, en tandas.
  //    En serie tardaba medio minuto por medio (22 rutas por el timeout de las
  //    que no existen); las 22 de golpe abren demasiados sockets a la vez.
  const pruebas = [];
  for (let i = 0; i < RUTAS.length; i += 8) {
    const tanda = await Promise.all(RUTAS.slice(i, i + 8).map(async (ruta) => {
      const r = await bajar(base + ruta);
      return { url: base + ruta, items: r.ok ? esFeedUtil(r.cuerpo) : 0 };
    }));
    pruebas.push(...tanda);
    // Con una ya servible no hace falta seguir probando.
    if (tanda.some((t) => t.items > 0)) break;
  }

  // Entre las que sirven, la que más items trae.
  const mejor = pruebas.filter((p) => p.items > 0).sort((a, b) => b.items - a.items)[0];
  if (mejor) return { ...medio, feed: mejor.url, items: mejor.items, via: 'ruta' };

  // 3. Google News, que indexa al medio aunque el medio no publique feed.
  //    Se prueba con el host tal cual y con el dominio raíz: muchos medios
  //    publican en un subdominio que Google indexa bajo el dominio principal.
  for (const candidato of feedsDeGoogleNews(base)) {
    const r = await bajar(candidato);
    const items = r.ok ? esFeedUtil(r.cuerpo) : 0;
    if (items > 0) return { ...medio, feed: candidato, items, via: 'google' };
  }

  return { ...medio, feed: null, items: 0, via: null, motivo: home.ok ? 'sin feed' : `home ${home.estado}` };
}

/** Explora en tandas para no abrir cientos de conexiones a la vez. */
export async function explorar(medios, alAvanzar, alGuardar) {
  const salida = [];
  for (let i = 0; i < medios.length; i += EN_PARALELO) {
    const tanda = medios.slice(i, i + EN_PARALELO);
    // Un medio que falla feo no puede tumbar la exploración de los otros 257.
    const res = await Promise.all(tanda.map((m) =>
      buscarFeed(m).catch((e) => ({ ...m, feed: null, items: 0, via: null, motivo: `fallo: ${e.message.slice(0, 30)}` }))));
    salida.push(...res);
    alAvanzar?.(salida.length, medios.length, res);
    alGuardar?.(salida);
  }
  return salida;
}

if (esPrincipal(import.meta.url)) {
  const archivo = path.join(DIRS.assets, 'Notiviral input medios .txt');
  const todos = leerDirectorio(archivo);

  const destinoParcial = path.join(DIRS.salida, 'medios-explorados.json');
  fs.mkdirSync(path.dirname(destinoParcial), { recursive: true });

  // Reanudable a propósito: el cliente HTTP de Node revienta el proceso con un
  // AssertionError interno cuando se le corta un socket TLS, y eso no se puede
  // atrapar. En vez de pelearlo, cada corrida retoma donde quedó la anterior;
  // basta con volver a lanzarla hasta que no quede nada.
  const previos = fs.existsSync(destinoParcial)
    ? JSON.parse(fs.readFileSync(destinoParcial, 'utf8'))
    : [];
  const yaHechos = new Set(previos.map((p) => p.url));

  const i = process.argv.indexOf('--limite');
  const pendientes = todos.filter((m) => !yaHechos.has(m.url));
  const medios = i > 0 ? pendientes.slice(0, Number(process.argv[i + 1])) : pendientes;

  console.log(`${todos.length} en el directorio · ${previos.length} ya explorados · faltan ${pendientes.length}\n`);
  if (!medios.length) {
    console.log('No queda nada por explorar.');
    process.exit(0);
  }

  const t0 = Date.now();
  let conFeed = 0;

  const resultado = await explorar(medios, (hechos, total, ultimos) => {
    for (const r of ultimos) {
      if (r.feed) conFeed++;
      const marca = r.feed ? `${r.via.slice(0, 3).toUpperCase()} ${String(r.items).padStart(3)}` : '--      ';
      console.log(`${marca}  ${r.nombre.slice(0, 32).padEnd(32)} ${r.feed ? r.feed.slice(0, 60) : r.motivo}`);
    }
    if (hechos % 30 === 0 || hechos === total) {
      console.log(`   ── ${hechos}/${total} · ${conFeed} con feed · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
  }, (parcial) => {
    // Guardar tras cada tanda: si el proceso muere, lo hecho queda.
    fs.writeFileSync(destinoParcial, JSON.stringify([...previos, ...parcial], null, 2), 'utf8');
  });

  const acumulado = [...previos, ...resultado];
  fs.writeFileSync(destinoParcial, JSON.stringify(acumulado, null, 2), 'utf8');

  const con = acumulado.filter((r) => r.feed);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`CON FEED: ${con.length} de ${acumulado.length} explorados (${Math.round((con.length / acumulado.length) * 100)}%)`);
  console.log(`Faltan ${todos.length - acumulado.length} · esta corrida tomó ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  for (const nivel of ['A', 'B', 'C', 'D']) {
    const t = acumulado.filter((m) => m.nivel === nivel).length;
    const c = con.filter((m) => m.nivel === nivel).length;
    if (t) console.log(`  Nivel ${nivel}: ${c}/${t}`);
  }
  console.log(`\nGuardado en ${destinoParcial}`);
}
