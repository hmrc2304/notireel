/**
 * Composición final con ffmpeg: 1080x1920, 30 fps, H.264 + AAC.
 *
 * Capas, de abajo hacia arriba:
 *   1. la foto de la noticia estirada a pantalla completa y desenfocada (evita bandas negras)
 *   2. la misma foto nítida arriba, con un Ken Burns lento
 *   3. el marco fijo (logo, avatar, degradados, pie)
 *   4. el ASS (chip de sección, hook fijo, subtítulos sincronizados)
 *
 * Todo se corre con cwd en la raíz del proyecto y rutas relativas: el filtro ass
 * usa ":" como separador y los paths de Windows tipo C:\ lo rompen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DIRS , esPrincipal } from './config.mjs';
import { construirASS } from './subtitulos.mjs';

const W = 1080, H = 1920, FPS = 30;
const ALTO_FOTO = 1250;   // la foto ocupa de 0 a 1250; abajo va el bloque de texto
const COLA = 1.1;         // segundos de aire al final para que no corte seco

const rel = (p) => path.relative(DIRS.raiz, p).replace(/\\/g, '/');

export async function bajarImagen(url, destino) {
  const res = await fetch(url, { headers: { 'user-agent': 'notiviral-motor/1.0' } });
  if (!res.ok) throw new Error(`imagen ${res.status}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}

export function componer({ foto, marco, mp3, ass, destino, duracion }) {
  const total = duracion + COLA;
  const cuadros = Math.round(total * FPS);

  const filtros = [
    // Fondo desenfocado: cubre los 1080x1920 sin deformar y sin bandas.
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `gblur=sigma=42,eq=brightness=-0.16:saturation=0.75,setsar=1[bg]`,

    // Foto nítida: se escala al doble antes del zoompan para que el zoom no pixele.
    // Se agranda un 18% de más y se recorta desde ARRIBA (y=0): las imágenes que
    // genera notiviral traen su propio watermark abajo y así queda fuera de cuadro.
    `[1:v]scale=${W * 2}:${Math.round(ALTO_FOTO * 2 * 1.18)}:force_original_aspect_ratio=increase,` +
      `crop=${W * 2}:${ALTO_FOTO * 2}:(iw-${W * 2})/2:0,` +
      `zoompan=z='min(zoom+0.00035,1.10)':d=${cuadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `s=${W}x${ALTO_FOTO}:fps=${FPS},setsar=1[foto]`,

    `[bg][foto]overlay=0:0:shortest=0[conFoto]`,
    `[conFoto][2:v]overlay=0:0[conMarco]`,
    `[conMarco]ass=${rel(ass)}:fontsdir=assets/fonts,format=yuv420p[v]`,

    // Fade de audio al final, sincronizado con la cola.
    `[3:a]afade=t=out:st=${duracion.toFixed(2)}:d=${COLA.toFixed(2)},apad=whole_dur=${total.toFixed(2)}[a]`,
  ];

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-t', String(total), '-i', rel(foto),   // 0: fondo
    '-loop', '1', '-t', String(total), '-i', rel(foto),   // 1: foto nítida
    '-loop', '1', '-t', String(total), '-i', rel(marco),  // 2: marco
    '-i', rel(mp3),                                        // 3: locución
    '-filter_complex', filtros.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-t', total.toFixed(2),
    rel(destino),
  ];

  execFileSync('ffmpeg', args, { cwd: DIRS.raiz, stdio: ['ignore', 'ignore', 'inherit'] });
  return destino;
}

/**
 * Pega la intro de marca delante del cuerpo.
 *
 * Los dos clips vienen de fuentes distintas (Veo y ffmpeg), así que hay que
 * normalizar resolución, fps y audio antes de concatenar: el demuxer `concat`
 * exige que coincidan y, si no lo hacen, el resultado se corrompe en silencio.
 */
export function pegarIntro({ intro, cuerpo, destino }) {
  const filtros = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1[vi]`,
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1[vc]`,
    `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[ai]`,
    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[ac]`,
    `[vi][ai][vc][ac]concat=n=2:v=1:a=1[v][a]`,
  ];

  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', rel(intro),
    '-i', rel(cuerpo),
    '-filter_complex', filtros.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    rel(destino),
  ], { cwd: DIRS.raiz, stdio: ['ignore', 'ignore', 'inherit'] });

  return destino;
}

/**
 * Arma el video completo de una noticia ya guionada y locutada.
 *
 * `fondo` permite reusar una imagen ya conseguida (la de la nota del sitio) en
 * vez de volver a evaluarla y, si hace falta, generarla de nuevo: eso ahorra
 * una llamada de visión y, sobre todo, una imagen de Kie por video.
 */
export async function armarVideo({
  nota, guion, locucion, avatar = 'ana',
  fondo = null, fondoGenerado = false, conIntro = true,
}) {
  const marco = path.join(DIRS.assets, `marco-${avatar}.png`);
  if (!fs.existsSync(marco)) throw new Error(`Falta el marco de ${avatar}. Corré: node src/marco.mjs ${avatar}`);

  const id = (nota.id ?? nota.slug ?? 'nota').slice(0, 8);
  const base = path.join(DIRS.temp, id);

  let foto = fondo;
  // Al reusar una imagen ya conseguida hay que arrastrar también si fue generada:
  // ese dato es el que decide si el video lleva el sello de imagen ilustrativa.
  let generada = fondo ? fondoGenerado : Boolean(nota.imagen_generada);
  if (!foto) {
    const { fondoParaNota } = await import('./imagen.mjs');
    const r = await fondoParaNota(nota, base, bajarImagen);
    foto = r.ruta;
    generada = r.generada;
    if (generada) console.log('  fondo: foto propia generada');
  }

  const ass = `${base}.ass`;
  fs.writeFileSync(ass, construirASS({
    hook: guion.hook,
    seccion: nota.seccion,
    palabras: locucion.palabras,
    duracion: locucion.duracion,
    imagenGenerada: generada,
    certeza: nota.certeza ?? null,
    mediosCount: nota.medios_count ?? nota.fuentes?.length ?? 0,
  }), 'utf8');

  const cuerpo = path.join(DIRS.salida, `${id}-cuerpo.mp4`);
  componer({ foto, marco, mp3: locucion.mp3, ass, destino: cuerpo, duracion: locucion.duracion });

  const intro = path.join(DIRS.assets, `intro-${avatar}.mp4`);
  const destino = path.join(DIRS.salida, `${id}.mp4`);

  if (conIntro && fs.existsSync(intro)) {
    pegarIntro({ intro, cuerpo, destino });
    fs.unlinkSync(cuerpo);
    return destino;
  }

  // Sin intro generada todavía, el cuerpo ya es un video publicable.
  fs.renameSync(cuerpo, destino);
  return destino;
}

if (esPrincipal(import.meta.url)) {
  const { ultimas } = await import('./fuente.mjs');
  const { escribirGuion } = await import('./guion.mjs');
  const { locutar } = await import('./voz.mjs');

  const avatar = process.argv[2] ?? 'ana';
  const [nota] = await ultimas(1);
  console.log(`NOTA: ${nota.titular}`);

  const guion = await escribirGuion(nota);
  console.log(`HOOK: ${guion.hook} | ${guion.palabras} palabras`);

  const locucion = await locutar(guion.libreto, path.join(DIRS.temp, `${nota.id.slice(0, 8)}.mp3`));
  console.log(`VOZ: ${locucion.duracion.toFixed(1)}s`);

  const mp4 = await armarVideo({ nota, guion, locucion, avatar });
  console.log(`VIDEO: ${mp4}`);
}
