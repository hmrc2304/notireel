/**
 * Toma pedidos del panel y los produce.
 *
 * El panel corre en Vercel, donde una petición muere a los 60 segundos y no hay
 * ffmpeg; un video tarda entre uno y tres minutos. Por eso el botón solo deja el
 * pedido en la cola y esto lo levanta desde una máquina que sí puede.
 *
 *   node src/trabajador.mjs            procesa lo que haya pendiente
 *   node src/trabajador.mjs --uno      procesa un solo pedido y sale
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { env, DIRS, esPrincipal, salirPorError, esSinSaldo } from './config.mjs';
import { publicarNota, notaDelHecho, subirImagen, subirVideo, marcarVideo } from './sitio.mjs';

const SITIO = () => env('NOTIREEL_SITIO', false) ?? 'https://notiviral.gemasdigitales.com';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');
const MAX_INTENTOS = 3;

const cab = (extra = {}) => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
};

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${ruta}`, { ...opciones, headers: cab(opciones.headers) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/**
 * Toma el pedido más viejo que esté pendiente y lo marca como tomado en la misma
 * operación: si dos trabajadores corren a la vez, solo uno se lo queda.
 */
async function tomarUno() {
  const [pendiente] = await pedir(
    `trabajos?select=*,baul(*)&estado=eq.pendiente&intentos=lt.${MAX_INTENTOS}&order=pedido_en.asc&limit=1`,
  ) ?? [];
  if (!pendiente) return null;

  const [tomado] = await pedir(
    `trabajos?id=eq.${pendiente.id}&estado=eq.pendiente`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        estado: 'tomado',
        tomado_en: new Date().toISOString(),
        intentos: pendiente.intentos + 1,
      }),
    },
  ) ?? [];

  return tomado ? { ...pendiente, ...tomado } : null;
}

const cerrar = (id, campos) =>
  pedir(`trabajos?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...campos, terminado_en: new Date().toISOString() }),
  });

/** Segundos reales del archivo, o null si ffprobe no está o falla. */
function duracionDe(mp4) {
  try {
    const salida = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4,
    ], { encoding: 'utf8' });
    const n = Number(String(salida).trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Reconstruye el grupo que el baúl guardó, en la forma que espera el redactor. */
function grupoDesdeBaul(fila) {
  return {
    titular: fila.titular,
    noticias: (fila.coberturas ?? []).map((c) => ({ ...c, titulo: c.titulo, resumen: c.resumen ?? '' })),
    medios: [...new Set((fila.coberturas ?? []).map((c) => c.medio))],
    cantidadMedios: fila.medios_count,
    imagen: fila.imagen_origen,
    fecha: fila.creada_en,
    puntaje: fila.puntaje,
    ejes: fila.ejes ?? [],
    partesEnfrentadas: Boolean(fila.partes_enfrentadas),
    mejorNivel: fila.nivel_mejor,
  };
}

export async function procesar(trabajo) {
  const fila = trabajo.baul;
  console.log(`\n▸ ${trabajo.modo === 'avatar' ? 'CON avatar' : 'sin avatar'} · ${fila.titular.slice(0, 58)}`);

  const { redactarNota } = await import('./redactar.mjs');
  const { bajarImagen } = await import('./video.mjs');
  const { fondoParaNota } = await import('./imagen.mjs');

  // 1. La nota. El grupo ya está agrupado y depurado desde el baúl.
  const nota = await redactarNota(grupoDesdeBaul(fila));
  console.log(`  nota redactada (${nota.palabras} palabras)`);

  // 2. La imagen, con el mismo control de calidad de siempre.
  const base = path.join(DIRS.temp, `trabajo-${trabajo.id.slice(0, 8)}`);
  const { ruta: fondo, generada } = await fondoParaNota(nota, base, bajarImagen);
  const imagenUrl = fondo ? await subirImagen(fondo, nota.titular.slice(0, 30)) : null;

  // 3. Publicar en el sitio.
  //
  // Si el cron ya publicó este hecho, el pedido no es un error: la nota está y lo
  // que falta son las piezas. Se reusa la que ya existe en vez de duplicarla.
  let publicada = await publicarNota(nota, { imagenUrl, imagenGenerada: generada });
  if (publicada.salteada) {
    const previa = await notaDelHecho(nota);
    if (!previa) throw new Error(publicada.motivo);
    publicada = { salteada: false, id: previa.id, slug: previa.slug, url: `${SITIO()}/nota/${previa.slug}` };
    console.log('  ya estaba publicada: se le agregan las piezas');
  }
  console.log(`  ${publicada.url}`);

  const resultado = { nota_url: publicada.url };

  // 4. Las piezas, según lo que se haya pedido.
  //
  // El modo se sigue llamando 'avatar' en la base porque es el valor que ya
  // tienen las filas y el CHECK de la tabla; hoy significa "con voz y video",
  // sin presentador en pantalla.
  if (trabajo.modo === 'avatar') {
    const { escribirGuion } = await import('./guion.mjs');
    const { locutar } = await import('./voz.mjs');
    const { armarVideo, VERSION_RENDER } = await import('./video.mjs');

    const { fotosDeCoberturas } = await import('./imagen.mjs');

    const guion = await escribirGuion({ ...nota, titulo: nota.titular });
    // `avatar` en la cola pasó a nombrar la VOZ: ya no hay presentador en pantalla.
    const locucion = await locutar(guion.libreto, `${base}.mp3`, { voz: trabajo.avatar ?? 'langa' });

    // Las imágenes que mandaron los otros medios del mismo hecho: con ellas el
    // video va cambiando de foto mientras la voz lee.
    const extras = await fotosDeCoberturas(fila.coberturas, base, bajarImagen, {
      evitar: [fila.imagen_origen],
    });
    if (extras.length) console.log(`  ${extras.length} fotos más de otras coberturas`);

    const piezas = await armarVideo({
      nota: { ...nota, id: publicada.slug, slug: publicada.slug },
      guion, locucion, fondo, fondoGenerado: generada, extras,
    });

    resultado.video_url = await subirVideo(piezas.vertical, publicada.slug);
    const horizontalUrl = piezas.horizontal
      ? await subirVideo(piezas.horizontal, publicada.slug, { sufijo: '16x9' })
      : null;

    await marcarVideo(publicada.slug, {
      videoUrl: resultado.video_url, horizontalUrl, duracion: locucion.duracion, version: VERSION_RENDER,
    });
    // Se mide el archivo en vez de sumar los 9 s de la intro: los presentadores
    // sin intro generada arrancan directo y el número quedaba inflado.
    const segundos = duracionDe(piezas.vertical) ?? locucion.duracion;
    console.log(`  video de ${segundos.toFixed(0)}s${horizontalUrl ? ' (vertical y 16:9)' : ''}`);
  } else {
    const { armarCarrusel, armarPlaca } = await import('./tarjetas.mjs');
    const id = publicada.slug.slice(0, 24);
    armarPlaca({ nota, foto: fondo, id, imagenGenerada: generada });
    const { tarjetas } = await armarCarrusel({ nota, foto: fondo, id, imagenGenerada: generada });
    console.log(`  placa + carrusel de ${tarjetas.length}`);
  }

  // 5. Redes, si están configuradas y el pedido las incluye.
  if (trabajo.redes?.length && resultado.video_url && env('META_PAGE_TOKEN', false)) {
    try {
      const { publicarEnRedes } = await import('./publicar.mjs');
      const mp4Local = path.join(DIRS.salida, `${publicada.slug.slice(0, 8)}.mp4`);
      const guion = { caption: nota.bajada, hashtags: nota.etiquetas ?? [] };
      resultado.publicado = await publicarEnRedes({ mp4: mp4Local, guion, nota });
      console.log(`  publicado en redes`);
    } catch (e) {
      console.error(`  ! redes: ${e.message}`);
      resultado.publicado = { error: e.message };
    }
  }

  await pedir(`baul?id=eq.${fila.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'publicada' }),
  });

  return resultado;
}

export async function correr({ soloUno = false } = {}) {
  let hechos = 0;

  for (;;) {
    const trabajo = await tomarUno();
    if (!trabajo) break;

    try {
      const resultado = await procesar(trabajo);
      await cerrar(trabajo.id, { estado: 'listo', ...resultado });
      hechos++;
    } catch (e) {
      // Sin saldo no es culpa del pedido: vuelve a la cola con el intento
      // devuelto. Si contara, tres corridas seguidas sin crédito lo darían por
      // fallado para siempre y habría que reencolarlo a mano.
      if (esSinSaldo(e)) {
        console.error('  ! sin saldo en la API: el pedido queda en la cola');
        await pedir(`trabajos?id=eq.${trabajo.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: 'pendiente', intentos: trabajo.intentos, error: 'sin saldo' }),
        });
        throw e;
      }

      console.error(`  ! falló: ${e.message}`);
      // Con los intentos agotados queda fallado; si no, vuelve a la cola.
      const agotado = trabajo.intentos >= MAX_INTENTOS;
      await cerrar(trabajo.id, {
        estado: agotado ? 'fallado' : 'pendiente',
        error: e.message.slice(0, 400),
        terminado_en: agotado ? new Date().toISOString() : null,
      });
    }

    if (soloUno) break;
  }

  return hechos;
}

if (esPrincipal(import.meta.url)) {
  try {
    const hechos = await correr({ soloUno: process.argv.includes('--uno') });
    console.log(hechos ? `\n${hechos} pedido(s) procesado(s).` : 'No había nada pendiente.');
  } catch (e) {
    process.exit(salirPorError(e, 'el despacho de la cola'));
  }
}
