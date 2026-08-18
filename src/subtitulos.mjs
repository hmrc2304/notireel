/**
 * Genera el archivo ASS que libass quema sobre el video.
 *
 * Lleva tres cosas: el chip de sección (fijo), el hook a modo de titular (fijo,
 * para el 80% que mira sin sonido) y los subtítulos sincronizados palabra a palabra
 * con los timestamps que devolvió ElevenLabs.
 *
 * Los subtítulos van en bloques de UNA línea corta: así no hay wrap automático y
 * nunca queda una palabra huérfana colgando.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.mjs';

/**
 * Tres textos, cada uno en su lugar:
 *
 *  - el TITULAR y la BAJADA de la nota van fijos en la franja de abajo, alineados
 *    a la izquierda, uno debajo del otro. Son lo que se lee sin sonido y lo que
 *    hay que poder leer de un vistazo mientras el pulgar decide.
 *  - los SUBTÍTULOS de la locución van en el medio del cuadro, sobre la foto,
 *    centrados y grandes, apareciendo al ritmo de la voz.
 *
 * Antes los subtítulos de la voz ocupaban el lugar de la bajada, que es de otra
 * cosa: la franja de abajo es texto fijo, no karaoke.
 */
/**
 * La franja de texto se arma de abajo hacia arriba.
 *
 * Antes cada bloque tenía su `y` fijo y su cuerpo fijo. Con textos de largo
 * variable eso deja huecos: un titular corto ocupaba dos renglones chicos y
 * quedaba media franja azul vacía, y una bajada larga se cortaba con puntos
 * suspensivos aunque hubiera lugar de sobra abajo.
 *
 * Ahora se define dónde termina el bloque (`pisoY`, justo arriba del pie) y
 * cuánto alto tiene disponible. El titular toma el cuerpo más grande con el que
 * entra en dos renglones parejos, la bajada se queda con el resto, y los dos se
 * apilan hacia arriba desde el piso. La franja siempre queda llena.
 */
/*
 * `pieY` sale de medir el marco, no de tantear.
 *
 * Es donde arranca el pie con el dominio pintado en el PNG: 1724 en el vertical
 * y 955 en el horizontal. El piso del bloque se calcula restándole el cuerpo de
 * la última línea más un respiro, así que agrandar la letra no lo monta encima.
 *
 * `subY` son cuatro quintos del espacio libre de la foto, no del cuadro entero:
 * en el 16:9 el texto arranca en 690, así que cuatro quintos de 1080 caerían
 * bastante por debajo del titular.
 */
const GEOMETRIA = {
  vertical: {
    ancho: 1080, alto: 1920,
    margen: 62,
    techoY: 1240, pieY: 1724, respiro: 26,
    tituloMin: 74, tituloMax: 132, tituloLineas: 2, tituloInter: 0.80,
    bajadaFuente: 47, bajadaMin: 40, bajadaLineas: 3, bajadaInter: 57, bajadaAire: 2,
    subY: 952, subFuente: 88,
    chipX: 1020, chipY: 142, selloX: 52, selloY: 218,
  },
  horizontal: {
    ancho: 1920, alto: 1080,
    margen: 62,
    techoY: 690, pieY: 955, respiro: 22,
    tituloMin: 54, tituloMax: 96, tituloLineas: 2, tituloInter: 0.80,
    bajadaFuente: 38, bajadaMin: 32, bajadaLineas: 3, bajadaInter: 48, bajadaAire: 2,
    subY: 552, subFuente: 68,
    chipX: 1860, chipY: 80, selloX: 56, selloY: 152,
  },
};

/** &HAABBGGRR: alfa invertido y canales al revés que en CSS. */
function color(hex, alfa = 0) {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const a = alfa.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function t(seg) {
  const s = Math.max(0, seg);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/**
 * Una palabra por subtitulo.
 *
 * Agrupar de a cuatro obligaba a achicar la letra cuando el bloque no entraba,
 * y el cuerpo cambiaba de un subtitulo al siguiente: se ve como si la pieza
 * estuviera mal armada. Con una sola palabra por vez el ancho nunca es problema,
 * el cuerpo queda fijo y el ritmo sigue exactamente a la voz.
 *
 * Los timestamps vienen de ElevenLabs, asi que cada palabra aparece cuando se
 * la pronuncia, no cuando un reparto por promedio lo estima.
 */
export function agrupar(palabras) {
  const bloques = palabras
    .filter((p) => p.palabra.trim())
    .map((p) => ({ texto: p.palabra, desde: p.desde, hasta: p.hasta }));

  // Sin huecos: cada palabra queda en pantalla hasta que arranca la siguiente,
  // porque un cuadro vacio entre palabra y palabra parpadea.
  for (let i = 0; i < bloques.length - 1; i++) {
    bloques[i].hasta = bloques[i + 1].desde;
  }
  if (bloques.length) {
    const u = bloques[bloques.length - 1];
    u.hasta = Math.max(u.hasta, u.desde + 0.28);
  }

  return bloques;
}

function escapar(s) {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ');
}

/**
 * Ancho real de un texto, en píxeles, con la fuente con la que se va a dibujar.
 *
 * Contar caracteres para repartir un titular es mentira: en Anton la "I" mide un
 * tercio de la "M". "SISMO DE MAGNITUD" y "4 EN VENEZUELA" tienen 17 y 14
 * letras, casi lo mismo, pero miden 756 y 584 píxeles: el segundo renglón sale
 * un 23% más corto y se ve como si sobrara.
 *
 * La tabla la genera scripts/medir-fuentes.py leyendo los archivos TTF.
 */
const ANCHOS = JSON.parse(
  fs.readFileSync(path.join(DIRS.assets, 'anchos-fuentes.json'), 'utf8'),
);

export function anchoDe(texto, fuente, tamano) {
  const t = ANCHOS[fuente] ?? ANCHOS.anton;
  let em = 0;
  for (const c of String(texto)) em += t.anchos[c] ?? t.porDefecto;
  return em * tamano;
}

/**
 * Parte un texto en líneas que entren a lo ancho, sin cortar palabras.
 *
 * El ASS va con WrapStyle 2, que NO envuelve solo: lo que no entra se sale del
 * cuadro por el costado. Los saltos se calculan acá o no existen.
 *
 * `ancho` y el resultado están en píxeles, medidos con la fuente real.
 */
function partirEnLineas(texto, { ancho, fuente, tamano, maxLineas = 3, balancear = false }) {
  const palabras = String(texto).trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];

  const mide = (s) => anchoDe(s, fuente, tamano);

  /** Reparte llenando cada línea hasta `tope` píxeles, sin cortar palabras. */
  const repartir = (tope) => {
    const lineas = [];
    let actual = '';

    for (const p of palabras) {
      if (!actual) { actual = p; continue; }
      if (mide(`${actual} ${p}`) <= tope) { actual += ` ${p}`; continue; }
      lineas.push(actual);
      actual = p;
      if (lineas.length === maxLineas) return { lineas, sobra: true };
    }
    if (actual) lineas.push(actual);
    return { lineas, sobra: false };
  };

  let { lineas, sobra } = repartir(ancho);

  /**
   * Balancear: que todos los renglones midan parecido.
   *
   * Llenar cada línea al máximo deja la última corta, y con una sola palabra se
   * lee como un error. Se prueba cada tope entre el promedio y el ancho
   * disponible, y gana el que reparta en la misma cantidad de renglones con la
   * menor diferencia entre el más ancho y el más angosto.
   */
  if (balancear && lineas.length > 1) {
    const objetivo = lineas.length;
    const total = mide(palabras.join(' '));
    let mejor = lineas;
    let mejorDif = Infinity;

    for (let tope = Math.ceil(total / objetivo); tope <= ancho; tope += 4) {
      const p = repartir(tope);
      if (p.sobra || p.lineas.length !== objetivo) continue;
      const anchos = p.lineas.map(mide);
      const dif = Math.max(...anchos) - Math.min(...anchos);
      if (dif < mejorDif) { mejorDif = dif; mejor = p.lineas; }
    }
    lineas = mejor;
  }

  // Lo que no entró se marca con puntos suspensivos: cortar en seco se lee como
  // que el texto está roto.
  if (sobra && lineas.length) {
    const i = lineas.length - 1;
    let ultima = lineas[i];
    while (ultima && mide(`${ultima}…`) > ancho) ultima = ultima.replace(/\s*\S+$/, '');
    lineas[i] = `${ultima}…`;
  }

  return lineas;
}

/** ¿Quedó todo el texto, o el repartidor tuvo que recortar? */
const entroEntero = (texto, lineas) =>
  lineas.join(' ').split(/\s+/).length === String(texto).trim().split(/\s+/).length
  && !lineas.some((l) => l.endsWith('…'));

/**
 * El cuerpo más grande con el que el texto entra en `maxLineas` renglones
 * llenando el ancho disponible.
 *
 * Un titular corto con cuerpo fijo deja media franja vacía y se ve chico; uno
 * largo se desborda. Con el cuerpo calculado, el renglón más ancho siempre roza
 * el margen y el bloque ocupa lo que tiene que ocupar.
 *
 * Para la bajada sirve para lo contrario: bajar un punto o dos de cuerpo antes
 * que cortar con puntos suspensivos. Una bajada larga entera en letra un poco
 * más chica se lee; una cortada a la mitad, no.
 */
function cuerpoQueLlena(texto, { ancho, fuente, maxLineas, min, max, balancear = true }) {
  for (let t = max; t >= min; t -= 2) {
    const lineas = partirEnLineas(texto, { ancho, fuente, tamano: t, maxLineas, balancear });
    if (lineas.length <= maxLineas
      && entroEntero(texto, lineas)
      && lineas.every((l) => anchoDe(l, fuente, t) <= ancho)) {
      return { tamano: t, lineas };
    }
  }
  return {
    tamano: min,
    lineas: partirEnLineas(texto, { ancho, fuente, tamano: min, maxLineas, balancear }),
  };
}

/**
 * Dibuja un texto de varias líneas, una por evento.
 *
 * El salto `\N` de ASS separa los renglones con el interlineado del propio
 * formato, que para una tipografía condensada como Anton deja un hueco enorme y
 * el titular se lee como dos frases sueltas. Con un evento por línea, la
 * separación es exactamente la que se pide.
 */
function bloqueDeTexto({
  lineas, estilo, x, y, interlineado, fin,
  capa = 2, fade = 240, tamano = null, fuente = null, ancho = null, estirarHasta = 1,
}) {
  const fs_ = tamano ? `\\fs${tamano}` : '';

  return lineas.map((linea, i) => {
    /*
     * Justificado al margen.
     *
     * Con dos renglones y palabras que no se pueden partir, el segundo casi
     * siempre queda mas corto: "SISMO DE MAGNITUD" mide 892 px y "4 EN
     * VENEZUELA" 689, un 23% menos, y el escalon se ve. Estirar el renglon
     * corto a lo ancho lo empareja, que es lo que hace cualquier cartel.
     *
     * El tope existe porque Anton ya es condensada: pasado cierto punto las
     * letras se ven infladas y el remedio es peor. Si no alcanza, se deja el
     * renglon como esta antes que deformarlo.
     */
    let escala = '';
    if (fuente && ancho && estirarHasta > 1) {
      const mide = anchoDe(linea, fuente, tamano ?? 100);
      if (mide > 0) {
        const factor = Math.min(ancho / mide, estirarHasta);
        if (factor > 1.015) escala = `\\fscx${Math.round(factor * 100)}`;
      }
    }

    return `Dialogue: ${capa},0:00:00.00,${fin},${estilo},,0,0,0,,`
      + `{\\pos(${x},${Math.round(y + i * interlineado)})\\an7${fs_}${escala}\\fad(${fade},0)}${escapar(linea)}`;
  });
}

/** Mismo código de color que el sitio: teal lo verificado, ladrillo lo que se mueve. */
const CERTEZA = {
  confirmado: { texto: 'CONFIRMADO', color: '#12A093' },
  en_desarrollo: { texto: 'EN DESARROLLO', color: '#C4462B' },
  version_unica: { texto: 'UNA SOLA FUENTE', color: '#6B7683' },
};

/**
 * Nada de lo que llega puede voltear el render.
 *
 * El esquema de la herramienta marca `seccion` como obligatoria, pero el modelo
 * la omitió una vez y `seccion.length` tiró abajo la corrida entera: la nota ya
 * estaba publicada y se quedó sin video. Forzar la herramienta obliga a usarla,
 * no garantiza que venga completa.
 */
export function construirASS({
  hook, bajada = '', seccion, palabras, duracion,
  imagenGenerada = false, certeza = null, mediosCount = 0, formato = 'vertical',
}) {
  const g = GEOMETRIA[formato] ?? GEOMETRIA.vertical;
  const bloques = agrupar(palabras ?? []);
  seccion = String(seccion || 'Mundo');
  const fin = t(duracion + 1.2);

  const cabecera = `[Script Info]
ScriptType: v4.00+
PlayResX: ${g.ancho}
PlayResY: ${g.alto}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Titulo,Anton,${g.tituloMax},${color('#FFFFFF')},${color('#FFFFFF')},${color('#0A1020')},${color('#000000', 110)},0,0,0,0,100,100,1,0,1,5,3,7,0,0,0,1
Style: Bajada,Montserrat,${g.bajadaFuente},${color('#CFDAE6')},${color('#CFDAE6')},${color('#0A1020')},${color('#000000', 140)},0,0,0,0,100,100,0,0,1,3,2,7,0,0,0,1
Style: Sub,Montserrat,${g.subFuente},${color('#FFFFFF')},${color('#FFFFFF')},${color('#0B1220')},${color('#000000', 70)},1,0,0,0,100,100,0,0,1,6,4,5,60,60,60,1
Style: Chip,Montserrat,36,${color('#FFFFFF')},${color('#FFFFFF')},${color('#0F1418')},${color('#000000', 255)},1,0,0,0,100,100,2,0,1,0,0,9,60,60,60,1
Style: Aviso,Montserrat,27,${color('#E6ECF5')},${color('#E6ECF5')},${color('#0B0F12')},${color('#000000', 255)},0,0,0,0,100,100,0,0,1,3,0,3,60,60,60,1
Style: Certeza,Montserrat,31,${color('#FFFFFF')},${color('#FFFFFF')},${color('#0F1418')},${color('#000000', 255)},1,0,0,0,100,100,1.4,0,1,0,0,7,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const filas = [];

  // Chip de sección, arriba a la derecha, con la cápsula dibujada a mano.
  const anchoChip = 30 + seccion.length * 20;
  filas.push(
    `Dialogue: 0,0:00:00.00,${fin},Chip,,0,0,0,,{\\pos(${g.chipX},${g.chipY})\\an9\\p1\\c${color('#D81E2C')}\\bord0\\shad0}` +
    `m 0 0 l ${anchoChip} 0 l ${anchoChip} 56 l 0 56{\\p0}`,
  );
  filas.push(
    `Dialogue: 1,0:00:00.00,${fin},Chip,,0,0,0,,{\\pos(${g.chipX - anchoChip / 2},${g.chipY + 28})\\an5}${escapar(seccion.toUpperCase())}`,
  );

  // El sello de certeza y las fuentes, debajo del logo: es la promesa de la marca
  // y tiene que estar en el video, no solo en el sitio.
  if (certeza && CERTEZA[certeza]) {
    const c = CERTEZA[certeza];
    const leyenda = mediosCount > 1 ? `${c.texto}   ·   ${mediosCount} FUENTES` : c.texto;
    const anchoSello = 34 + leyenda.length * 17;
    filas.push(
      `Dialogue: 0,0:00:00.00,${fin},Certeza,,0,0,0,,{\\pos(${g.selloX},${g.selloY})\\an7\\p1\\c${color(c.color)}\\alpha&H50&\\bord0\\shad0}` +
      `m 0 0 l ${anchoSello} 0 l ${anchoSello} 52 l 0 52{\\p0}`,
    );
    filas.push(
      `Dialogue: 1,0:00:00.00,${fin},Certeza,,0,0,0,,{\\pos(${g.selloX + 17},${g.selloY + 26})\\an4\\c${color('#FFFFFF')}}${escapar(leyenda)}`,
    );
  }

  /*
   * Titular y bajada, apilados desde el piso de la franja hacia arriba.
   *
   * El titular toma el cuerpo mas grande con el que entra en dos renglones
   * parejos, medidos con la fuente real. La bajada se arma despues y las dos
   * alturas juntas deciden donde empieza el bloque, asi la franja queda llena
   * sin importar si el titular es corto o largo.
   */
  const anchoUtil = g.ancho - g.margen * 2;
  const altoFranja = g.pieY - g.respiro - g.bajadaFuente - g.techoY;

  /*
   * El bloque tiene que entrar en la franja, no solamente verse bien.
   *
   * Antes el titular y la bajada tomaban cada uno el cuerpo más grande que les
   * entraba a lo ancho, y si la suma no cabía a lo alto el bloque se apoyaba en
   * el techo y desbordaba: la última línea de la bajada terminó pisando el pie
   * con el dominio. Ahora se prueban los dos cuerpos de mayor a menor y gana el
   * primer par que entra en el alto disponible. Achicar es feo; superponer es
   * un error.
   */
  const armar = (maxTitulo, maxBajada) => {
    const titulo = cuerpoQueLlena(hook, {
      ancho: anchoUtil, fuente: 'anton', maxLineas: g.tituloLineas,
      min: g.tituloMin, max: maxTitulo,
    });
    const interTitulo = Math.round(titulo.tamano * g.tituloInter);
    const altoTitulo = titulo.tamano + (titulo.lineas.length - 1) * interTitulo;

    /*
     * `bajadaAire` es chico a propósito.
     *
     * En Anton la mayúscula ocupa cerca del 72% del cuerpo, así que debajo del
     * titular ya quedan 27px muertos en el 16:9 y 37 en el vertical. Sumarles
     * 34 de aire dejaba un hueco visual de 60 a 73px y el titular se leía
     * despegado de su bajada, como dos bloques sueltos en vez de uno.
     *
     * La bajada baja de cuerpo antes que cortarse: entera en letra un poco más
     * chica se lee, cortada con puntos suspensivos parece que falta el final.
     */
    const cuerpoBajada = bajada
      ? cuerpoQueLlena(bajada, {
        ancho: anchoUtil, fuente: 'montserrat', maxLineas: g.bajadaLineas,
        // Balanceada igual que el titular: llenar cada renglón al máximo dejaba
        // el último con una sola palabra, y una huérfana se lee como un error.
        min: g.bajadaMin, max: maxBajada, balancear: true,
      })
      : { tamano: maxBajada, lineas: [] };

    // El interlineado acompaña al cuerpo, si no la bajada chica queda desarmada.
    const interBajada = Math.round(g.bajadaInter * (cuerpoBajada.tamano / g.bajadaFuente));
    const altoBajada = cuerpoBajada.lineas.length
      ? g.bajadaAire + cuerpoBajada.tamano + (cuerpoBajada.lineas.length - 1) * interBajada
      : 0;

    return { titulo, interTitulo, altoTitulo, cuerpoBajada, interBajada, altoBajada };
  };

  let bloque = armar(g.tituloMax, g.bajadaFuente);
  for (let t = g.tituloMax; t >= g.tituloMin; t -= 4) {
    let entro = false;
    for (let b = g.bajadaFuente; b >= g.bajadaMin; b -= 2) {
      const prueba = armar(t, b);
      if (prueba.altoTitulo + prueba.altoBajada <= altoFranja) { bloque = prueba; entro = true; break; }
    }
    if (entro) break;
    // Si con la bajada al mínimo tampoco entra, el que tiene que ceder es el
    // titular: la bajada ya está en su cuerpo más chico legible.
    bloque = armar(t, g.bajadaMin);
  }

  const { titulo, interTitulo, altoTitulo, cuerpoBajada, interBajada, altoBajada } = bloque;
  const lineasBajada = cuerpoBajada.lineas;

  /*
   * El piso se calcula con el cuerpo que quedó, no con uno fijo.
   *
   * Con `y` en `an7` la coordenada es el TOPE del renglón, así que la última
   * línea ocupa hasta `piso + cuerpo`. Con un piso fijo calculado para cuerpo 41,
   * agrandar la bajada a 47 metió esos seis píxeles de más encima del pie. Ahora
   * el piso sale de dónde arranca el pie menos el cuerpo real y el respiro.
   */
  const piso = g.pieY - (lineasBajada.length ? cuerpoBajada.tamano : titulo.tamano) - g.respiro;

  // Si el bloque no entra en la franja, se apoya en el techo y baja: prefiero que
  // muerda el borde de la foto antes que pisar el pie de la marca.
  const arranque = Math.max(g.techoY, piso - altoTitulo - altoBajada);

  filas.push(...bloqueDeTexto({
    lineas: titulo.lineas,
    estilo: 'Titulo', x: g.margen, y: arranque, interlineado: interTitulo, fin,
    tamano: titulo.tamano,
    fuente: 'anton', ancho: anchoUtil, estirarHasta: 1.22,
  }));

  if (lineasBajada.length) {
    filas.push(...bloqueDeTexto({
      lineas: lineasBajada,
      estilo: 'Bajada', x: g.margen, y: arranque + altoTitulo + g.bajadaAire,
      interlineado: interBajada, fin, fade: 420, tamano: cuerpoBajada.tamano,
    }));
  }

  // El aviso de imagen generada ya no va quemado en el video, por pedido
  // expreso. La nota sí lo sigue diciendo al pie de su foto, que es donde el
  // lector puede leerlo entero y en contexto.
  void imagenGenerada;

  // Subtítulos de la locución: en el MEDIO del cuadro, sobre la foto, centrados y
  // grandes. Aparecen con un pop mínimo, sin animaciones que distraigan.
  for (const b of bloques) {
    // Cuerpo fijo y sin animacion de escala. Antes se achicaba la letra cuando el
    // bloque no entraba a lo ancho y se la hacia crecer al aparecer: el tamano
    // cambiaba de un subtitulo al siguiente y la pieza se veia mal armada. Con una
    // palabra por vez nada de eso hace falta.
    filas.push(
      `Dialogue: 3,${t(b.desde)},${t(b.hasta)},Sub,,0,0,0,,` +
      `{\\pos(${g.ancho / 2},${g.subY})\\an5}${escapar(b.texto)}`,
    );
  }

  return cabecera + filas.join('\n') + '\n';
}
