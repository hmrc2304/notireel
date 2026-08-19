/**
 * La franja de texto del video, hecha con HTML y CSS.
 *
 * El título y la bajada se dibujaban con ASS, calculando a mano el ancho de cada
 * renglón, el cuerpo que entraba y el interlineado. Cambiar un tamaño obligaba a
 * recomponer el video entero, y recomponerlo costaba una locución nueva.
 *
 * Con CSS eso desaparece: el navegador ya sabe repartir renglones, balancearlos
 * y ajustar el cuerpo. Y como la franja es una imagen aparte, se puede repintar
 * sobre un video ya publicado sin tocar el audio ni los subtítulos de la voz.
 *
 * Es la misma técnica que ya usaba el marco, aplicada a lo que cambia.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DIRS, esPrincipal } from './config.mjs';
import { MARCA } from './marco.mjs';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function navegador() {
  for (const p of EDGE) if (fs.existsSync(p)) return p;
  for (const p of ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No encontré Edge ni Chrome para capturar la franja');
}

/**
 * La franja arranca donde termina la foto y llega al borde de abajo.
 *
 * `desde` es el punto donde el degradado ya tapa: por encima de eso el PNG es
 * transparente y deja ver el video. Repintar desde ahí cubre cualquier texto
 * anterior sin comerse la foto.
 */
const FORMATOS = {
  vertical: {
    ancho: 1080, alto: 1920, desde: 1090,
    margen: 62, titulo: 132, bajada: 47, pie: 33, pieChico: 24,
    acento: 78, acentoAlto: 10,
  },
  horizontal: {
    ancho: 1920, alto: 1080, desde: 560,
    margen: 62, titulo: 96, bajada: 38, pie: 26, pieChico: 19,
    acento: 64, acentoAlto: 8,
  },
};

function html(formato, { hook, bajada }) {
  const f = FORMATOS[formato];
  const alto = f.alto - f.desde;

  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: 'Anton'; src: url('${pathToFileURL(path.join(DIRS.assets, 'fonts', 'Anton-Regular.ttf')).href}'); }
  @font-face { font-family: 'Montse'; src: url('${pathToFileURL(path.join(DIRS.assets, 'fonts', 'Montserrat.ttf')).href}'); }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${f.ancho}px; height: ${alto}px; background: transparent; overflow: hidden; }

  body {
    position: relative;
    /*
     * El degradado tiene que llegar a opaco apenas termina la foto.
     *
     * La franja se pega encima de un video que ya trae su propio texto quemado:
     * si a esa altura todavía es semitransparente, el titular anterior se ve por
     * detrás del nuevo. La transición ocupa solo los píxeles que quedan sobre la
     * foto; de ahí para abajo es color pleno.
     */
    background: linear-gradient(to bottom,
      rgba(22,35,63,0) 0%, rgba(22,35,63,.80) 7%, ${MARCA.navy} ${((f.alto - 1190) < 0 ? 14 : Math.round((f.desde + 100 - f.desde) / alto * 100 + 2))}%);
    padding: 0 ${f.margen}px;
    display: flex; flex-direction: column; justify-content: flex-end;
    padding-bottom: ${Math.round(alto * 0.075)}px;
  }

  .acento { position: absolute; top: ${Math.round(alto * 0.145)}px; left: ${f.margen}px; display: flex; gap: 10px; }
  .acento i { display: block; width: ${f.acento}px; height: ${f.acentoAlto}px; border-radius: 6px; }

  /*
   * El titular se ajusta solo.
   *
   * Con \`text-wrap: balance\` los dos renglones quedan del mismo ancho sin que
   * nadie mida nada, y el cuerpo se toma del ancho del cuadro: un titular corto
   * llena la franja y uno largo se achica hasta entrar, que es exactamente lo
   * que antes había que calcular a mano.
   */
  h1 {
    font-family: 'Anton', sans-serif; font-weight: 400;
    font-size: ${f.titulo}px;
    line-height: .96; text-transform: uppercase; letter-spacing: .004em;
    color: #fff; text-wrap: balance;
    text-shadow: 0 5px 3px rgba(0,0,0,.55);
    margin-bottom: ${Math.round(f.bajada * 0.34)}px;
  }

  p {
    font-family: 'Montse', sans-serif; font-weight: 500;
    font-size: ${f.bajada}px; line-height: 1.22; color: #CFDAE6;
    text-wrap: pretty; text-shadow: 0 3px 2px rgba(0,0,0,.5);
    /* Tres renglones como tope. El cuerpo lo ajusta el script de abajo, así que
       cortar es el último recurso y no el primero. */
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    margin-bottom: ${Math.round(alto * 0.055)}px;
  }

  .firma { display: flex; align-items: center; gap: 18px; }
  .firma .barrita { width: 6px; align-self: stretch; border-radius: 3px; background: ${MARCA.azul}; }
  .pie { color: #fff; font-size: ${f.pie}px; font-weight: 800; letter-spacing: .2px; line-height: 1.15; }
  .pie span { display: block; color: ${MARCA.azulClaro}; font-size: ${f.pieChico}px; font-weight: 600; margin-top: 5px; }
</style>

<div class="acento">
  <i style="background:#FFFFFF"></i>
  <i style="background:${MARCA.azul}"></i>
  <i style="background:${MARCA.rojo}"></i>
</div>

<h1>${escapar(hook)}</h1>
${bajada ? `<p>${escapar(bajada)}</p>` : ''}

<div class="firma">
  <div class="barrita"></div>
  <div class="pie">${MARCA.dominio}<span>La nota completa, con todas las fuentes</span></div>
</div>

<script>
/*
 * El cuerpo del titular se ajusta al contenido.
 *
 * CSS reparte renglones y los balancea, pero no achica la letra cuando el texto
 * no entra: eso hay que pedirlo. Se arranca del cuerpo máximo y se baja de a dos
 * píxeles hasta que el titular entre en dos renglones. Es el mismo cálculo que
 * antes se hacía con una tabla de anchos, pero acá lo resuelve el motor de
 * texto del navegador, que además sabe de kerning y de ligaduras.
 */
(() => {
  const ajustar = (sel, maxPx, minPx, alto, renglones) => {
    const el = document.querySelector(sel);
    if (!el) return;

    /*
     * Para medir hay que soltar el recorte entero, no solo el line-clamp.
     *
     * Con display:-webkit-box y overflow:hidden, el alto que reporta el
     * elemento ya viene truncado: el texto que sobra no existe para la
     * medición y el bucle nunca ve que hay que achicar. Se mide en block con
     * overflow visible y recién después se devuelve el recorte, que así queda
     * como último recurso y no como lo primero que pasa.
     */
    el.style.display = 'block';
    el.style.overflow = 'visible';
    el.style.webkitLineClamp = 'unset';

    for (let px = maxPx; px >= minPx; px -= 1) {
      el.style.fontSize = px + 'px';
      if (Math.round(el.scrollHeight / (px * alto)) <= renglones) break;
    }

    el.style.display = '';
    el.style.overflow = '';
    el.style.webkitLineClamp = '';
  };

  /*
   * Nada se mide hasta que las tipografías estén cargadas.
   *
   * Anton y Montserrat entran por @font-face, que es asíncrono: si el ajuste
   * corre antes, mide con la fuente de reemplazo del sistema, que tiene otro
   * ancho, y elige un cuerpo que después no entra. El navegador se captura con
   * presupuesto de tiempo virtual, así que le da lugar a esta promesa.
   */
  document.fonts.ready.then(() => {
    // El titular manda: dos renglones, del cuerpo más grande que entre.
    ajustar('h1', ${f.titulo}, ${Math.round(f.titulo * 0.5)}, 0.96, 2);
    // La bajada baja de cuerpo antes que cortarse con puntos suspensivos.
    ajustar('p', ${f.bajada}, ${Math.round(f.bajada * 0.78)}, 1.22, 3);
    document.documentElement.dataset.listo = '1';
  });
})();
</script>
`;
}

const escapar = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Genera el PNG de la franja. Devuelve la ruta y desde qué `y` va pegado. */
export function generarFranja({ hook, bajada, formato = 'vertical', destino }) {
  const f = FORMATOS[formato] ?? FORMATOS.vertical;
  const alto = f.alto - f.desde;

  const htmlPath = path.join(DIRS.temp, `franja-${formato}-${Date.now() % 100000}.html`);
  fs.writeFileSync(htmlPath, html(formato, { hook, bajada }), 'utf8');

  // Edge escribe la captura sobre la ruta tal cual se la pasan: con una relativa
  // la resuelve contra su propio directorio y el archivo aparece en otro lado.
  const salida = path.resolve(destino ?? path.join(DIRS.temp, `franja-${formato}.png`));
  if (fs.existsSync(salida)) fs.unlinkSync(salida);

  execFileSync(navegador(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-sandbox', '--disable-dev-shm-usage',
    '--default-background-color=00000000',
    '--force-device-scale-factor=1',
    // Sin esto la captura sale antes de que carguen las fuentes y corra el ajuste.
    '--virtual-time-budget=4000',
    `--window-size=${f.ancho},${alto}`,
    `--screenshot=${salida}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: 'ignore', timeout: 120000 });

  fs.rmSync(htmlPath, { force: true });
  if (!fs.existsSync(salida)) throw new Error('el navegador no generó la franja');

  return { ruta: salida, y: f.desde, ancho: f.ancho, alto };
}

if (esPrincipal(import.meta.url)) {
  const r = generarFranja({
    hook: process.argv[2] ?? 'EEUU SANCIONA A LA CORTE PENAL',
    bajada: process.argv[3] ?? 'Washington también sanciona a la jueza Tomoko Akane y a un abogado de la fiscalía.',
    formato: process.argv[4] ?? 'vertical',
  });
  console.log(`${r.ruta} · ${r.ancho}x${r.alto}, va pegada en y=${r.y}`);
}
