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

/**
 * Los subtítulos van en bloques de hasta cuatro palabras, alineados con el
 * titular: los dos arrancan en el mismo margen izquierdo y se leen como un
 * bloque de texto, no como palabras sueltas flotando.
 */
const MAX_CHARS = 24;
const MAX_PALABRAS = 4;
const MAX_SEG = 2.2;

/**
 * Geometría por formato.
 *
 * El titular arranca en `hookY` y baja; el subtítulo termina en `subY` y sube.
 * Así el aire que queda en el medio no lo puede comer ninguno de los dos.
 *
 * En 16:9 hay la mitad de alto y el doble de ancho: entran más caracteres por
 * línea y el texto tiene que ser más chico, o tapa la escena.
 */
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
const GEOMETRIA = {
  vertical: {
    ancho: 1080, alto: 1920,
    margen: 62,
    tituloY: 1296, tituloFuente: 104, tituloChars: 21,
    bajadaY: 1566, bajadaFuente: 44, bajadaChars: 42, bajadaLineas: 3,
    subY: 860, subFuente: 76, maxChars: 22,
    chipX: 1020, chipY: 74, selloX: 52, selloY: 150,
  },
  horizontal: {
    ancho: 1920, alto: 1080,
    margen: 62,
    tituloY: 690, tituloFuente: 78, tituloChars: 30,
    bajadaY: 892, bajadaFuente: 36, bajadaChars: 66, bajadaLineas: 2,
    subY: 420, subFuente: 58, maxChars: 30,
    chipX: 1860, chipY: 54, selloX: 56, selloY: 126,
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

/** Agrupa palabras en bloques cortos respetando la puntuación. */
export function agrupar(palabras, maxChars = MAX_CHARS) {
  const bloques = [];
  let actual = [];

  const cerrar = () => {
    if (!actual.length) return;
    bloques.push({
      texto: actual.map((p) => p.palabra).join(' '),
      desde: actual[0].desde,
      hasta: actual[actual.length - 1].hasta,
    });
    actual = [];
  };

  for (const p of palabras) {
    const largo = actual.reduce((n, x) => n + x.palabra.length + 1, 0) + p.palabra.length;
    const duracion = actual.length ? p.hasta - actual[0].desde : 0;

    if (actual.length && (largo > maxChars || actual.length >= MAX_PALABRAS || duracion > MAX_SEG)) cerrar();
    actual.push(p);
    // Un cierre de frase corta el bloque: el subtítulo respira donde respira la voz.
    if (/[.,;:!?]$/.test(p.palabra)) cerrar();
  }
  cerrar();

  const juntos = pegarColas(bloques, maxChars);

  // Sin huecos: cada bloque dura hasta que arranca el siguiente.
  for (let i = 0; i < juntos.length - 1; i++) {
    juntos[i].hasta = Math.min(juntos[i + 1].desde, juntos[i].hasta + 0.35);
  }
  return juntos;
}

/**
 * Pega los bloques de cola contra el anterior.
 *
 * El corte por puntuación deja restos de una o dos palabras ("a Portugal.")
 * ocupando un subtítulo entero: se lee como si faltara algo. Se juntan mientras
 * el bloque resultante siga entrando en una línea.
 */
function pegarColas(bloques, maxChars = MAX_CHARS) {
  const out = [];

  for (const b of bloques) {
    const previo = out[out.length - 1];
    const corto = b.texto.split(' ').length <= 2 && b.texto.length <= 10;
    const cabe = previo && `${previo.texto} ${b.texto}`.length <= maxChars + 6;

    if (corto && cabe) {
      previo.texto = `${previo.texto} ${b.texto}`;
      previo.hasta = b.hasta;
      continue;
    }
    out.push({ ...b });
  }

  return out;
}

function escapar(s) {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ');
}

/**
 * Parte un texto en líneas que entren a lo ancho, sin cortar palabras.
 *
 * El ASS va con WrapStyle 2, que NO envuelve solo: lo que no entra se sale del
 * cuadro por el costado. Los saltos se calculan acá o no existen.
 */
function partirEnLineas(texto, maxChars, maxLineas = 3) {
  const palabras = String(texto).trim().split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';

  for (const p of palabras) {
    if (!actual) { actual = p; continue; }
    if (`${actual} ${p}`.length <= maxChars) { actual += ` ${p}`; continue; }
    if (lineas.length + 1 >= maxLineas) { lineas.push(actual); actual = p; break; }
    lineas.push(actual);
    actual = p;
  }
  if (actual && lineas.length < maxLineas) lineas.push(actual);

  return lineas.map(escapar).join('\\N');
}

/** Mismo código de color que el sitio: teal lo verificado, ladrillo lo que se mueve. */
const CERTEZA = {
  confirmado: { texto: 'CONFIRMADO', color: '#12A093' },
  en_desarrollo: { texto: 'EN DESARROLLO', color: '#C4462B' },
  version_unica: { texto: 'UNA SOLA FUENTE', color: '#6B7683' },
};

export function construirASS({
  hook, bajada = '', seccion, palabras, duracion,
  imagenGenerada = false, certeza = null, mediosCount = 0, formato = 'vertical',
}) {
  const g = GEOMETRIA[formato] ?? GEOMETRIA.vertical;
  const bloques = agrupar(palabras, g.maxChars);
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
Style: Titulo,Anton,${g.tituloFuente},${color('#FFFFFF')},${color('#FFFFFF')},${color('#0A1020')},${color('#000000', 110)},0,0,0,0,100,100,1,0,1,5,3,7,0,0,0,1
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

  // Titular: grande, fijo, alineado a la izquierda desde el margen. Es lo que se
  // lee sin sonido y lo que decide si alguien se queda.
  filas.push(
    `Dialogue: 2,0:00:00.00,${fin},Titulo,,0,0,0,,{\\pos(${g.margen},${g.tituloY})\\an7\\fad(240,0)}` +
    partirEnLineas(hook, g.tituloChars, 3),
  );

  // La bajada de la NOTA, debajo del titular. Es texto fijo que amplía el titular,
  // no tiene nada que ver con los subtítulos de la locución.
  if (bajada) {
    filas.push(
      `Dialogue: 2,0:00:00.00,${fin},Bajada,,0,0,0,,{\\pos(${g.margen},${g.bajadaY})\\an7\\fad(420,0)}` +
      partirEnLineas(bajada, g.bajadaChars, g.bajadaLineas),
    );
  }

  // Cuando el fondo no es una foto del hecho sino una imagen generada, se dice.
  // Publicar una recreación como si fuera documental quema la credibilidad del medio.
  if (imagenGenerada) {
    filas.push(
      `Dialogue: 2,0:00:00.00,${fin},Aviso,,0,0,0,,{\\pos(24,${g.tituloY - 44})\\an1}Imagen ilustrativa generada con IA`,
    );
  }

  // Subtítulos de la locución: en el MEDIO del cuadro, sobre la foto, centrados y
  // grandes. Aparecen con un pop mínimo, sin animaciones que distraigan.
  for (const b of bloques) {
    const exceso = b.texto.length / g.maxChars;
    const escala = exceso > 1 ? Math.max(62, Math.round(100 / exceso)) : 100;
    filas.push(
      `Dialogue: 3,${t(b.desde)},${t(b.hasta)},Sub,,0,0,0,,` +
      `{\\pos(${g.ancho / 2},${g.subY})\\an5\\fscx${Math.round(escala * 0.93)}\\fscy93` +
      `\\t(0,110,\\fscx${escala}\\fscy100)}${escapar(b.texto)}`,
    );
  }

  return cabecera + filas.join('\n') + '\n';
}
