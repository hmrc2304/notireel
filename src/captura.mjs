/**
 * Captura una URL con el viewport EXACTO que se le pide.
 *
 * `--screenshot` con `--window-size` no sirve para verificar diseño responsive:
 * el navegador compone unos 60 px más anchos de lo pedido y la imagen recorta esa
 * diferencia, así que todo aparece cortado a la derecha aunque el CSS esté bien.
 * Se pierden horas persiguiendo un desborde que no existe.
 *
 * Esto usa el protocolo de depuración: fija las medidas con Emulation y pide la
 * captura con Page.captureScreenshot, que respeta el viewport al píxel.
 *
 *   node src/captura.mjs http://localhost:3100/reels salida/reels.png 390 844
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { esPrincipal } from './config.mjs';

const NAVEGADORES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function navegador() {
  for (const p of NAVEGADORES) if (fs.existsSync(p)) return p;
  throw new Error('No encontré Edge ni Chrome');
}

export async function capturar(url, destino, { ancho = 390, alto = 844, escala = 2, esperaMs = 6000 } = {}) {
  const puerto = 9300 + Math.floor(Math.random() * 400);
  const perfil = path.join(process.env.TEMP ?? '/tmp', `edge-captura-${puerto}`);

  const proc = spawn(navegador(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${puerto}`,
    `--user-data-dir=${perfil}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // Esperar a que el puerto de depuración levante.
    let objetivo = null;
    for (let i = 0; i < 40 && !objetivo; i++) {
      await dormir(300);
      try {
        const lista = await fetch(`http://127.0.0.1:${puerto}/json`).then((r) => r.json());
        objetivo = lista.find((t) => t.type === 'page');
      } catch { /* todavía no está listo */ }
    }
    if (!objetivo) throw new Error('el navegador no abrió el puerto de depuración');

    const ws = new WebSocket(objetivo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let n = 0;
    const enviar = (method, params = {}) => new Promise((resolve) => {
      const id = ++n;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m.result); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

    // El viewport se fija acá, no con --window-size: esto sí es exacto.
    await enviar('Emulation.setDeviceMetricsOverride', {
      width: ancho, height: alto, deviceScaleFactor: escala, mobile: ancho < 900,
    });
    await enviar('Page.enable');
    await enviar('Page.navigate', { url });
    await dormir(esperaMs);

    const { data } = await enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(data, 'base64'));

    ws.close();
    return destino;
  } finally {
    proc.kill();
  }
}

if (esPrincipal(import.meta.url)) {
  const [url, destino, ancho, alto] = process.argv.slice(2);
  if (!url || !destino) throw new Error('Uso: node src/captura.mjs <url> <destino.png> [ancho] [alto]');
  const salida = await capturar(url, destino, {
    ancho: Number(ancho ?? 390),
    alto: Number(alto ?? 844),
  });
  console.log(`${salida} (${(fs.statSync(salida).size / 1024).toFixed(0)} KB)`);
}
