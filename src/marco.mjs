/**
 * Marco fijo del video: 1080x1920 PNG con transparencia.
 *
 * Lleva SOLO lo que no cambia entre noticias (logo, avatar en círculo, degradados,
 * pie con el dominio). Todo lo dinámico (sección, hook, subtítulos) se dibuja
 * después con libass, que es mucho más barato que rerenderizar el marco.
 *
 * Se compone con HTML/CSS y se captura con Edge headless: control pixel-perfect
 * sobre la tipografía y los colores de marca, cosa que drawtext no da.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DIRS , esPrincipal } from './config.mjs';

/**
 * Paleta de NotiViral. El teal marca lo verificado y el ladrillo lo que todavía
 * se mueve, igual que en el sitio: quien ve el Reel y después entra a la web
 * tiene que reconocer el mismo código.
 */
export const MARCA = {
  navy: '#0F1418',
  fondo2: '#161D24',
  azul: '#12A093',
  azulClaro: '#4FBDB2',
  rojo: '#C4462B',
  gris: '#93A1AC',
  dominio: 'notiviral.gemasdigitales.com',
};

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function navegador() {
  for (const p of EDGE) if (fs.existsSync(p)) return p;
  for (const p of ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No encontré Edge ni Chrome para capturar el marco');
}

function html(avatarDataUri) {
  return `<!doctype html><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; background: transparent; }
  body { font-family: "Segoe UI", "Inter", "DejaVu Sans", sans-serif; position: relative; overflow: hidden; }

  /* Degradado inferior: da piso legible a los subtítulos sobre cualquier foto. */
  .piso {
    position: absolute; left: 0; right: 0; bottom: 0; height: 900px;
    background: linear-gradient(to bottom,
      rgba(22,35,63,0) 0%, rgba(22,35,63,.72) 30%, rgba(22,35,63,.96) 58%, ${MARCA.navy} 100%);
  }
  /* La foto nítida termina en 1250 y ahí se veía el corte contra el fondo
     desenfocado. Esta banda lo funde. */
  .costura {
    position: absolute; left: 0; right: 0; top: 1120px; height: 260px;
    background: linear-gradient(to bottom,
      rgba(22,35,63,0) 0%, rgba(22,35,63,.55) 48%, rgba(22,35,63,.92) 78%, ${MARCA.navy} 100%);
  }
  /* Degradado superior: separa la barra de marca de la foto. */
  .techo {
    position: absolute; left: 0; right: 0; top: 0; height: 320px;
    background: linear-gradient(to bottom, rgba(22,35,63,.95) 0%, rgba(22,35,63,.75) 55%, rgba(22,35,63,0) 100%);
  }

  .barra { position: absolute; top: 54px; left: 52px; display: flex; align-items: center; gap: 18px; }
  .logo {
    background: #fff; border-radius: 6px; padding: 13px 24px;
    font-size: 40px; font-weight: 800; letter-spacing: -.5px; line-height: 1;
    text-transform: uppercase;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
  }
  .logo .a { color: ${MARCA.navy}; }
  .logo .b { color: ${MARCA.azul}; }

  .lema {
    font-size: 25px; font-weight: 700; color: ${MARCA.gris}; letter-spacing: .5px;
    text-shadow: 0 2px 10px rgba(0,0,0,.8);
  }

  /* Acento de marca: las tres barras del logo. */
  .acento { position: absolute; top: 1268px; left: 52px; display: flex; gap: 10px; }
  .acento i { display: block; width: 78px; height: 10px; border-radius: 6px; }

  /* Firma inferior: avatar y dominio en una sola fila, bien por debajo de los
     subtítulos. Antes el avatar quedaba a la altura del texto y se pisaban. */
  .firma { position: absolute; left: 60px; bottom: 74px; display: flex; align-items: center; gap: 26px; }

  .avatar {
    width: 152px; height: 152px; border-radius: 999px; flex: 0 0 152px;
    border: 5px solid #fff; overflow: hidden;
    box-shadow: 0 14px 38px rgba(0,0,0,.55);
  }
  .avatar img { width: 100%; height: 100%; object-fit: cover; object-position: center 20%; }

  .pie { color: #fff; font-size: 33px; font-weight: 800; letter-spacing: .2px; line-height: 1.15; }
  .pie span { display: block; color: ${MARCA.azulClaro}; font-size: 24px; font-weight: 600; margin-top: 5px; }
</style>
<div class="techo"></div>
<div class="costura"></div>
<div class="piso"></div>

<div class="barra">
  <div class="logo"><span class="a">Noti</span><span class="b">Viral</span></div>
  <div class="lema">Las fuentes, a la vista</div>
</div>

<div class="acento">
  <i style="background:#FFFFFF"></i>
  <i style="background:${MARCA.azul}"></i>
  <i style="background:${MARCA.rojo}"></i>
</div>

<div class="firma">
  <div class="avatar"><img src="${avatarDataUri}"></div>
  <div class="pie">${MARCA.dominio}<span>La nota completa, con todas las fuentes</span></div>
</div>
`;
}

export function generarMarco(avatarNombre = 'ana') {
  const avatarPng = path.join(DIRS.assets, `avatar-${avatarNombre}.png`);
  if (!fs.existsSync(avatarPng)) throw new Error(`Falta ${avatarPng}. Corré: node src/avatar.mjs ${avatarNombre}`);

  const dataUri = `data:image/png;base64,${fs.readFileSync(avatarPng).toString('base64')}`;
  const htmlPath = path.join(DIRS.temp, `marco-${avatarNombre}.html`);
  fs.writeFileSync(htmlPath, html(dataUri), 'utf8');

  const destino = path.join(DIRS.assets, `marco-${avatarNombre}.png`);
  if (fs.existsSync(destino)) fs.unlinkSync(destino);

  execFileSync(navegador(), [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    // Sin estos dos, el navegador muere con SIGABRT en los runners de Linux:
    // no puede abrir su sandbox y el /dev/shm del contenedor le queda chico.
    // En Windows no hacen falta, pero tampoco molestan.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--default-background-color=00000000',
    '--force-device-scale-factor=1',
    '--window-size=1080,1920',
    `--screenshot=${destino}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: 'ignore', timeout: 120000 });

  if (!fs.existsSync(destino)) throw new Error('Edge no generó el marco');
  return destino;
}

if (esPrincipal(import.meta.url)) {
  const nombre = process.argv[2] ?? 'ana';
  console.log(`Marco de ${nombre} -> ${generarMarco(nombre)}`);
}
