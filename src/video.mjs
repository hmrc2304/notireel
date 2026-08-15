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

const FPS = 30;
const COLA = 1.1;         // segundos de aire al final para que no corte seco

/**
 * Los dos formatos que se producen de cada noticia.
 *
 * El vertical va a /reels y a las redes; el horizontal, al reproductor de la
 * nota, donde un 9:16 a ancho completo ocupa mil trescientos píxeles de alto y
 * empuja el texto fuera de la pantalla.
 *
 * En vertical la foto ocupa una franja de arriba y el texto vive abajo. En
 * horizontal la foto es todo el cuadro y el texto se apoya sobre el degradado,
 * así que `altoFoto` es el alto entero.
 */
const FORMATOS = {
  vertical: { ancho: 1080, alto: 1920, altoFoto: 1250 },
  horizontal: { ancho: 1920, alto: 1080, altoFoto: 1080 },
};

const rel = (p) => path.relative(DIRS.raiz, p).replace(/\\/g, '/');

export async function bajarImagen(url, destino) {
  const res = await fetch(url, { headers: { 'user-agent': 'notiviral-motor/1.0' } });
  if (!res.ok) throw new Error(`imagen ${res.status}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}

const CRUCE = 0.6;   // segundos de fundido entre una foto y la siguiente
const MAX_FOTOS = 5; // más de cinco en treinta segundos se siente un pase de diapositivas

/**
 * Compone el video.
 *
 * `fotos` puede traer una sola imagen o varias: con varias, cada una ocupa su
 * turno mientras la voz sigue leyendo y se funde con la siguiente. Treinta
 * segundos sobre una única foto congelada se sienten eternos, y las coberturas
 * del mismo hecho ya traen sus propias imágenes, así que el material está.
 */
export function componer({ fotos, foto, marco, mp3, ass, destino, duracion, formato = 'vertical' }) {
  const { ancho: W, alto: H, altoFoto: ALTO_FOTO } = FORMATOS[formato] ?? FORMATOS.vertical;
  const lista = (fotos?.length ? fotos : [foto]).filter(Boolean);
  const total = duracion + COLA;
  const n = lista.length;

  // Cada foto dura lo mismo. Los tramos se superponen durante el fundido, así que
  // el turno bruto lleva un cruce de más para que la suma cierre en `total`.
  const turno = n === 1 ? total : (total + CRUCE * (n - 1)) / n;
  const cuadros = Math.round(turno * FPS);

  const filtros = [];

  // Fondo desenfocado: cubre los 1080x1920 sin deformar y sin bandas. Lo da la
  // primera foto y se queda fijo; cambiarlo también hace parpadear el cuadro.
  filtros.push(
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `gblur=sigma=42,eq=brightness=-0.16:saturation=0.75,setsar=1[bg]`,
  );

  // Cada foto nítida se escala al doble antes del zoompan para que el zoom no
  // pixele. Se agranda un 18% de más y se recorta desde ARRIBA (y=0): las
  // imágenes generadas traen su propio watermark abajo y así queda fuera de cuadro.
  // El sentido del zoom se alterna para que dos fotos seguidas no se muevan igual.
  lista.forEach((_, i) => {
    const entrada = i + 1;
    const acerca = i % 2 === 0;
    const zoom = acerca
      ? `z='min(zoom+0.00042,1.12)'`
      : `z='if(lte(on,1),1.12,max(zoom-0.00042,1.0))'`;

    filtros.push(
      `[${entrada}:v]scale=${W * 2}:${Math.round(ALTO_FOTO * 2 * 1.18)}:force_original_aspect_ratio=increase,` +
        `crop=${W * 2}:${ALTO_FOTO * 2}:(iw-${W * 2})/2:0,` +
        `zoompan=${zoom}:d=${cuadros}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `s=${W}x${ALTO_FOTO}:fps=${FPS},setsar=1,format=yuv420p[f${i}]`,
    );
  });

  // Fundido encadenado entre fotos: cada cruce empieza justo antes de que la
  // anterior termine su turno.
  let secuencia = '[f0]';
  for (let i = 1; i < n; i++) {
    const desplazamiento = (turno - CRUCE) * i;
    const salida = i === n - 1 ? '[fotos]' : `[x${i}]`;
    filtros.push(
      `${secuencia}[f${i}]xfade=transition=fade:duration=${CRUCE}:offset=${desplazamiento.toFixed(2)}${salida}`,
    );
    secuencia = salida;
  }
  if (n === 1) filtros.push('[f0]null[fotos]');

  const marcoIdx = n + 1;
  filtros.push(
    `[bg][fotos]overlay=0:0:shortest=0[conFoto]`,
    `[conFoto][${marcoIdx}:v]overlay=0:0[conMarco]`,
    `[conMarco]ass=${rel(ass)}:fontsdir=assets/fonts,format=yuv420p[v]`,
    // Fade de audio al final, sincronizado con la cola.
    `[${marcoIdx + 1}:a]afade=t=out:st=${duracion.toFixed(2)}:d=${COLA.toFixed(2)},apad=whole_dur=${total.toFixed(2)}[a]`,
  );

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-t', String(total), '-i', rel(lista[0]),          // 0: fondo
    ...lista.flatMap((f) => ['-loop', '1', '-t', String(turno + 0.5), '-i', rel(f)]), // 1..n: fotos
    '-loop', '1', '-t', String(total), '-i', rel(marco),             // n+1: marco
    '-i', rel(mp3),                                                   // n+2: locución
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
export function pegarIntro({ intro, cuerpo, destino, formato = 'vertical' }) {
  const { ancho: W, alto: H } = FORMATOS[formato] ?? FORMATOS.vertical;
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
 * Elige la intro del presentador.
 *
 * Si hay varias (`intro-ana.mp4`, `intro-ana-2.mp4`, …) se reparten entre las
 * noticias: con una sola, el que mira tres piezas seguidas escucha tres veces la
 * misma frase y el canal suena a robot. La elección va por el id de la nota y no
 * al azar, así regenerar un video no le cambia la apertura.
 */
export function introDe(avatar, semilla = '') {
  const opciones = fs.readdirSync(DIRS.assets)
    .filter((f) => new RegExp(`^intro-${avatar}(-\\d+)?\\.mp4$`).test(f))
    .sort();

  if (!opciones.length) return `intro-${avatar}.mp4`;

  let n = 0;
  for (const c of String(semilla)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return opciones[n % opciones.length];
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
  fondo = null, fondoGenerado = false, conIntro = true, extras = [],
  formatos = ['vertical', 'horizontal'],
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

  // La foto de la nota primero y las de las otras coberturas detrás: el hecho lo
  // cubrieron varios medios y cada uno mandó su propia imagen.
  const fotos = [foto, ...extras.filter((f) => f && f !== foto)].slice(0, MAX_FOTOS);

  const comun = {
    hook: guion.hook,
    seccion: nota.seccion,
    palabras: locucion.palabras,
    duracion: locucion.duracion,
    imagenGenerada: generada,
    certeza: nota.certeza ?? null,
    mediosCount: nota.medios_count ?? nota.fuentes?.length ?? 0,
  };

  const salidas = {};

  for (const formato of formatos) {
    const sufijo = formato === 'vertical' ? '' : `-${formato}`;
    const marcoF = path.join(DIRS.assets, `marco-${avatar}${sufijo}.png`);
    if (!fs.existsSync(marcoF)) {
      console.error(`  ! falta ${path.basename(marcoF)}, salteo el ${formato}`);
      continue;
    }

    const ass = `${base}${sufijo}.ass`;
    fs.writeFileSync(ass, construirASS({ ...comun, formato }), 'utf8');

    const cuerpo = path.join(DIRS.salida, `${id}-cuerpo${sufijo}.mp4`);
    componer({ fotos, marco: marcoF, mp3: locucion.mp3, ass, destino: cuerpo, duracion: locucion.duracion, formato });

    const destino = path.join(DIRS.salida, `${id}${sufijo}.mp4`);
    const intro = path.join(DIRS.assets, introDe(avatar, nota.slug ?? nota.id ?? ''));

    // La intro del presentador está filmada en vertical: en el horizontal se
    // recortaría a una franja de la cara, así que ahí el video arranca directo.
    if (conIntro && formato === 'vertical' && fs.existsSync(intro)) {
      pegarIntro({ intro, cuerpo, destino, formato });
      fs.unlinkSync(cuerpo);
    } else {
      fs.renameSync(cuerpo, destino);
    }

    salidas[formato] = destino;
  }

  if (!salidas.vertical && !salidas.horizontal) throw new Error('no se pudo componer ningún formato');
  return formatos.length === 1 ? salidas[formatos[0]] : salidas;
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
