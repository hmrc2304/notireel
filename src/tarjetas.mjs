/**
 * Formatos derivados: carrusel de tarjetas y placa suelta.
 *
 * De una misma noticia salen tres piezas (Reel, carrusel y placa) sin necesitar
 * una noticia más. Es la manera más barata de subir el volumen diario cuando el
 * sitio produce 10 notas y hacen falta 24 publicaciones.
 *
 * El carrusel va 1:1 y la placa 4:5, que es el alto máximo que Instagram muestra
 * en el feed sin recortar.
 *
 * Se componen con HTML y CSS y se capturan con Chrome headless, igual que el marco
 * del video: la tipografía queda exacta y el texto nunca sale pixelado.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { env, DIRS, esPrincipal } from './config.mjs';
import { pedirHerramienta } from './claude.mjs';
import { MARCA } from './marco.mjs';

const RUTA_EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function navegador() {
  for (const p of RUTA_EDGE) if (fs.existsSync(p)) return p;
  throw new Error('No encontré Edge ni Chrome para capturar las tarjetas');
}

const fuente = (archivo) => pathToFileURL(path.join(DIRS.assets, 'fonts', archivo)).href;
const dataUri = (p) => `data:image/${p.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(p).toString('base64')}`;

/* ─────────────────────── los puntos del carrusel ─────────────────────── */

const HERRAMIENTA = {
  name: 'entregar_tarjetas',
  description: 'Entrega el texto de las tarjetas del carrusel.',
  input_schema: {
    type: 'object',
    properties: {
      portada: { type: 'string', description: 'titular de la primera tarjeta, hasta 60 caracteres, el gancho' },
      puntos: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'de 2 a 5 palabras, el dato en sí' },
            texto: { type: 'string', description: 'una o dos frases, hasta 150 caracteres' },
          },
          required: ['titulo', 'texto'],
        },
      },
      cierre: { type: 'string', description: 'una frase de hasta 70 caracteres que deje al lector queriendo la nota completa' },
    },
    required: ['portada', 'puntos', 'cierre'],
  },
};

const SISTEMA = `Armás carruseles de Instagram para un medio de noticias.
Cada tarjeta se lee en dos segundos mientras alguien desliza con el pulgar.

REGLAS DURAS:
- Español neutro. Nada de voseo.
- Solo datos que estén en la nota. No inventes ni completes.
- Números en cifras.
- PROHIBIDO el guion largo (—). Usá coma o punto.
- Sin emojis, sin hashtags, sin signos de exclamación.
- Cada punto tiene que aportar un dato distinto. Nada de repetir el titular con otras palabras.`;

export async function escribirTarjetas(nota) {
  const t = await pedirHerramienta({
    etapa: 'tarjetas',
    maxTokens: 1200,
    sistema: SISTEMA,
    herramienta: HERRAMIENTA,
    mensajes: [{
      role: 'user',
      content: `TITULAR: ${nota.titular ?? nota.titulo}\nBAJADA: ${nota.bajada}\n\nNOTA:\n${(nota.cuerpo ?? '').slice(0, 3000)}`,
    }],
  });

  t.portada = t.portada.replace(/\s*—\s*/g, ', ');
  t.cierre = t.cierre.replace(/\s*—\s*/g, ', ');
  t.puntos = t.puntos.map((p) => ({ ...p, texto: p.texto.replace(/\s*—\s*/g, ', ') }));
  return t;
}

/* ─────────────────────────── el HTML ─────────────────────────── */

/**
 * El texto va en flujo normal dentro de una columna flex anclada abajo, NO con
 * posiciones absolutas: con `bottom` fijo, un titular de cuatro líneas crecía
 * hacia arriba y se montaba encima de la bajada.
 */
const BASE = (ancho, alto) => `
  @font-face { font-family: 'Anton'; src: url('${fuente('Anton-Regular.ttf')}'); }
  @font-face { font-family: 'Mont'; src: url('${fuente('Montserrat.ttf')}'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ancho}px; height: ${alto}px; overflow: hidden; }
  body { font-family: 'Mont', 'Segoe UI', sans-serif; background: ${MARCA.navy}; color: #fff; position: relative; }

  .foto { position: absolute; inset: 0; }
  .foto img { width: 100%; height: 100%; object-fit: cover; object-position: center 35%; }
  .velo { position: absolute; inset: 0; background:
    linear-gradient(to bottom, rgba(22,35,63,.86) 0%, rgba(22,35,63,.34) 32%, rgba(22,35,63,.90) 72%, ${MARCA.navy} 100%); }

  .logo { position: absolute; top: 46px; left: 52px; z-index: 3; background: #fff; border-radius: 999px;
    padding: 12px 26px; font-size: 34px; font-weight: 800; letter-spacing: -1px; }
  .logo b { color: ${MARCA.navy}; font-weight: 800; }
  .logo i { color: ${MARCA.azul}; font-style: normal; font-weight: 800; }

  .seccion { position: absolute; top: 52px; right: 52px; z-index: 3; background: ${MARCA.rojo};
    padding: 10px 20px; font-size: 26px; font-weight: 800; letter-spacing: .1em; }

  .acento { display: flex; gap: 9px; }
  .acento i { display: block; width: 64px; height: 9px; border-radius: 5px; }

  /* Columna que sostiene todo el contenido, anclada al pie del cuadro. */
  .lienzo { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column;
    justify-content: flex-end; padding: 150px 52px 44px; gap: 26px; }

  .pie { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 6px; }
  .dominio { font-size: 27px; font-weight: 800; color: #fff; }
  .desliza { font-size: 24px; font-weight: 700; color: ${MARCA.gris}; letter-spacing: .04em; }

  /* Mismo criterio que en el video: si la foto no es del hecho, la pieza lo dice. */
  .sello { position: absolute; left: 52px; bottom: 96px; z-index: 3;
    font-size: 21px; font-weight: 600; color: #C6D2E4; text-shadow: 0 2px 8px rgba(0,0,0,.7); }
`;

const SELLO = (mostrar) => (mostrar ? '<div class="sello">Imagen ilustrativa generada con IA</div>' : '');

const BARRAS = `<div class="acento"><i style="background:#fff"></i><i style="background:${MARCA.azul}"></i><i style="background:${MARCA.rojo}"></i></div>`;

/** El titular largo baja de cuerpo en vez de desbordar el cuadro. */
function cuerpoTitular(texto, base, minimo = 58) {
  if (texto.length <= 42) return base;
  return Math.max(minimo, Math.round(base - (texto.length - 42) * 0.62));
}

function tarjetaPortada(t, fotoUri, seccion, sello) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE(1080, 1080)}
    .titular { font-family: 'Anton'; font-size: ${cuerpoTitular(t.portada, 94, 62)}px; line-height: .98;
      text-transform: uppercase; text-shadow: 0 6px 30px rgba(0,0,0,.6); text-wrap: balance; }
    .sello { bottom: auto; top: 118px; }
  </style>
  <div class="foto"><img src="${fotoUri}"></div>
  <div class="velo"></div>
  <div class="logo"><b>Noti</b><i>Viral</i></div>
  <div class="seccion">${seccion.toUpperCase()}</div>
  ${SELLO(sello)}
  <div class="lienzo">
    ${BARRAS}
    <div class="titular">${t.portada}</div>
    <div class="pie"><span class="dominio">notiviral.com</span><span class="desliza">Desliza &rsaquo;</span></div>
  </div>`;
}

function tarjetaPunto(p, indice, total, fotoUri) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE(1080, 1080)}
    .foto img { filter: blur(26px) brightness(.42) saturate(.7); transform: scale(1.15); }
    .lienzo { justify-content: center; gap: 22px; padding: 150px 52px 130px; }
    .num { font-family: 'Anton'; font-size: 116px; line-height: .8; color: ${MARCA.azul}; }
    .titulo { font-family: 'Anton'; font-size: ${cuerpoTitular(p.titulo, 76, 54)}px; line-height: 1.02;
      text-transform: uppercase; text-wrap: balance; }
    .texto { font-size: ${p.texto.length > 120 ? 37 : 42}px; line-height: 1.42; font-weight: 600;
      color: #E4EBF6; text-wrap: pretty; max-width: 92%; }
    .paso { position: absolute; right: 52px; top: 58px; z-index: 3; font-size: 26px; font-weight: 800; color: ${MARCA.gris}; }
    .pie { position: absolute; left: 52px; right: 52px; bottom: 44px; }
  </style>
  <div class="foto"><img src="${fotoUri}"></div>
  <div class="velo"></div>
  <div class="logo"><b>Noti</b><i>Viral</i></div>
  <div class="paso">${indice} / ${total}</div>
  <div class="lienzo">
    <div class="num">${String(indice).padStart(2, '0')}</div>
    <div class="titulo">${p.titulo}</div>
    <div class="texto">${p.texto}</div>
  </div>
  <div class="pie"><span class="dominio">notiviral.com</span><span class="desliza">Desliza &rsaquo;</span></div>`;
}

function tarjetaCierre(t, fotoUri, avatarUri) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE(1080, 1080)}
    .foto img { filter: blur(30px) brightness(.36) saturate(.7); transform: scale(1.15); }
    .lienzo { justify-content: center; gap: 46px; padding: 150px 52px 130px; }
    .frase { font-family: 'Anton'; font-size: ${cuerpoTitular(t.cierre, 82, 58)}px; line-height: 1.03;
      text-transform: uppercase; text-wrap: balance; }
    .cta { display: flex; align-items: center; gap: 24px; }
    .avatar { width: 132px; height: 132px; border-radius: 999px; border: 5px solid #fff; overflow: hidden; flex: 0 0 132px; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; object-position: center 20%; }
    .cta div { font-size: 40px; font-weight: 800; line-height: 1.2; }
    .cta span { display: block; font-size: 29px; font-weight: 600; color: ${MARCA.gris}; margin-top: 6px; }
    .pie { position: absolute; left: 52px; right: 52px; bottom: 44px; }
  </style>
  <div class="foto"><img src="${fotoUri}"></div>
  <div class="velo"></div>
  <div class="logo"><b>Noti</b><i>Viral</i></div>
  <div class="lienzo">
    ${BARRAS}
    <div class="frase">${t.cierre}</div>
    <div class="cta">
      <div class="avatar"><img src="${avatarUri}"></div>
      <div>La nota completa<span>notiviral.com</span></div>
    </div>
  </div>
  <div class="pie"><span class="dominio">notiviral.com</span><span class="desliza">&nbsp;</span></div>`;
}

function tarjetaPlaca(nota, fotoUri, sello) {
  const titular = nota.titular ?? nota.titulo;
  return `<!doctype html><meta charset="utf-8"><style>${BASE(1080, 1350)}
    .lienzo { padding: 200px 56px 46px; gap: 24px; }
    .titular { font-family: 'Anton'; font-size: ${cuerpoTitular(titular, 92, 58)}px; line-height: 1;
      text-transform: uppercase; text-shadow: 0 6px 30px rgba(0,0,0,.6); text-wrap: balance; }
    .bajada { font-size: 34px; font-weight: 600; line-height: 1.38; color: #DDE6F3;
      text-wrap: pretty; max-width: 95%; }
    .sello { bottom: auto; top: 132px; }
  </style>
  <div class="foto"><img src="${fotoUri}"></div>
  <div class="velo"></div>
  <div class="logo"><b>Noti</b><i>Viral</i></div>
  <div class="seccion">${(nota.seccion ?? 'MUNDO').toUpperCase()}</div>
  ${SELLO(sello)}
  <div class="lienzo">
    ${BARRAS}
    <div class="titular">${titular}</div>
    <div class="bajada">${(nota.bajada ?? '').slice(0, 170)}</div>
    <div class="pie"><span class="dominio">notiviral.com</span><span class="desliza">&nbsp;</span></div>
  </div>`;
}

/* ─────────────────────────── captura ─────────────────────────── */

function capturar(html, destino, ancho, alto) {
  const tmp = path.join(DIRS.temp, `t-${path.basename(destino, '.png')}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  if (fs.existsSync(destino)) fs.unlinkSync(destino);

  execFileSync(navegador(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    // Obligatorios en los runners de Linux, inocuos en Windows: sin ellos el
    // navegador aborta al no poder abrir su sandbox.
    '--no-sandbox', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--window-size=${ancho},${alto}`,
    `--screenshot=${destino}`, pathToFileURL(tmp).href,
  ], { stdio: 'ignore', timeout: 120000 });

  if (!fs.existsSync(destino)) throw new Error(`no se generó ${destino}`);
  return destino;
}

/** Carrusel completo: portada, puntos y cierre. Devuelve las rutas en orden. */
export async function armarCarrusel({ nota, foto, avatar = 'ana', id, imagenGenerada = false }) {
  const t = await escribirTarjetas(nota);
  const dir = path.join(DIRS.salida, 'carruseles', id);
  fs.mkdirSync(dir, { recursive: true });

  const fotoUri = dataUri(foto);
  const avatarUri = dataUri(path.join(DIRS.assets, `avatar-${avatar}.png`));
  const total = t.puntos.length + 2;
  const salidas = [];

  salidas.push(capturar(tarjetaPortada(t, fotoUri, nota.seccion ?? 'Mundo', imagenGenerada), path.join(dir, '1.png'), 1080, 1080));
  t.puntos.forEach((p, i) => {
    salidas.push(capturar(tarjetaPunto(p, i + 2, total, fotoUri), path.join(dir, `${i + 2}.png`), 1080, 1080));
  });
  salidas.push(capturar(tarjetaCierre(t, fotoUri, avatarUri), path.join(dir, `${total}.png`), 1080, 1080));

  return { tarjetas: salidas, texto: t };
}

/** Placa suelta 4:5, el formato más barato de todos. */
export function armarPlaca({ nota, foto, id, imagenGenerada = false }) {
  const dir = path.join(DIRS.salida, 'placas');
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `${id}.png`);
  return capturar(tarjetaPlaca(nota, dataUri(foto), imagenGenerada), destino, 1080, 1350);
}

if (esPrincipal(import.meta.url)) {
  const archivo = path.join(DIRS.salida, 'notas', `notas-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(archivo)) throw new Error(`Falta ${archivo}. Corré primero: node src/redactar.mjs 2`);

  const notas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const nota = notas[0];
  console.log(`NOTA: ${nota.titular}`);

  const { bajarImagen } = await import('./video.mjs');
  const { fondoParaNota } = await import('./imagen.mjs');
  const base = path.join(DIRS.temp, 'tarjeta-demo');
  const { ruta: foto, generada } = await fondoParaNota(
    { ...nota, titular: nota.titular, bajada: nota.bajada, imagen: nota.imagen },
    base,
    bajarImagen,
  );
  if (generada) console.log('  fondo: foto propia generada');

  const placa = armarPlaca({ nota, foto, id: 'demo', imagenGenerada: generada });
  console.log(`Placa:    ${placa}`);

  const { tarjetas } = await armarCarrusel({ nota, foto, id: 'demo', imagenGenerada: generada });
  console.log(`Carrusel: ${tarjetas.length} tarjetas en ${path.dirname(tarjetas[0])}`);
}
