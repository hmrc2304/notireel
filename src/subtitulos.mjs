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
const GEOMETRIA = {
  vertical: {
    ancho: 1080, alto: 1920,
    // Titular y subtítulo comparten la franja de abajo, los dos arrancando en el
    // mismo margen izquierdo: se leen como el bloque de texto de una placa, en
    // vez de flotar centrados con aire muerto entre medio.
    margen: 62,
    hookY: 1298, subY: 1596, hookFuente: 88, subFuente: 64,
    chipX: 1020, chipY: 74, selloX: 52, selloY: 150,
    maxChars: 24,
  },
  horizontal: {
    ancho: 1920, alto: 1080,
    margen: 58,
    hookY: 686, subY: 906, hookFuente: 66, subFuente: 52,
    chipX: 1860, chipY: 54, selloX: 56, selloY: 126,
    maxChars: 32,
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

/** Corta el hook en 2 líneas balanceadas, sin dejar una palabra sola. */
function partirHook(hook) {
  const palabras = hook.trim().split(/\s+/);
  if (hook.length <= 18 || palabras.length < 3) return escapar(hook);

  let mejor = { corte: 1, dif: Infinity };
  for (let i = 1; i < palabras.length; i++) {
    const a = palabras.slice(0, i).join(' ').length;
    const b = palabras.slice(i).join(' ').length;
    const dif = Math.abs(a - b) + (palabras.slice(i).length === 1 ? 40 : 0);
    if (dif < mejor.dif) mejor = { corte: i, dif };
  }
  return escapar(palabras.slice(0, mejor.corte).join(' ')) + '\\N' + escapar(palabras.slice(mejor.corte).join(' '));
}

/** Mismo código de color que el sitio: teal lo verificado, ladrillo lo que se mueve. */
const CERTEZA = {
  confirmado: { texto: 'CONFIRMADO', color: '#12A093' },
  en_desarrollo: { texto: 'EN DESARROLLO', color: '#C4462B' },
  version_unica: { texto: 'UNA SOLA FUENTE', color: '#6B7683' },
};

export function construirASS({
  hook, seccion, palabras, duracion,
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
Style: Hook,Anton,${g.hookFuente},${color('#FFFFFF')},${color('#FFFFFF')},${color('#16233F')},${color('#000000', 120)},0,0,0,0,100,100,1,0,1,6,4,5,60,60,60,1
Style: Sub,Montserrat,${g.subFuente},${color('#FFFFFF')},${color('#FFFFFF')},${color('#0B1220')},${color('#000000', 90)},1,0,0,0,100,100,0,0,1,5,3,5,60,60,60,1
Style: Chip,Montserrat,36,${color('#FFFFFF')},${color('#FFFFFF')},${color('#0F1418')},${color('#000000', 255)},1,0,0,0,100,100,2,0,1,0,0,9,60,60,60,1
Style: Aviso,Montserrat,27,${color('#E6ECF5')},${color('#E6ECF5')},${color('#0B0F12')},${color('#000000', 255)},0,0,0,0,100,100,0,0,1,3,0,3,60,60,60,1
Style: Certeza,Montserrat,31,${color('#FFFFFF')},${color('#FFFFFF')},${color('#0F1418')},${color('#000000', 255)},1,0,0,0,100,100,1.4,0,1,0,0,7,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const filas = [];

  // Chip de sección, arriba a la derecha, con la cápsula dibujada a mano.
  const ancho = 30 + seccion.length * 20;
  filas.push(
    `Dialogue: 0,0:00:00.00,${fin},Chip,,0,0,0,,{\\pos(1020,74)\\an9\\p1\\c${color('#D81E2C')}\\bord0\\shad0}` +
    `m 0 0 l ${ancho} 0 l ${ancho} 56 l 0 56{\\p0}`,
  );
  filas.push(
    `Dialogue: 1,0:00:00.00,${fin},Chip,,0,0,0,,{\\pos(${1020 - ancho / 2},102)\\an5}${escapar(seccion.toUpperCase())}`,
  );

  // El sello de certeza y las fuentes, debajo del logo: es la promesa de la marca
  // y tiene que estar en el video, no solo en el sitio.
  if (certeza && CERTEZA[certeza]) {
    const c = CERTEZA[certeza];
    const leyenda = mediosCount > 1 ? `${c.texto}   ·   ${mediosCount} FUENTES` : c.texto;
    const ancho = 34 + leyenda.length * 17;
    filas.push(
      `Dialogue: 0,0:00:00.00,${fin},Certeza,,0,0,0,,{\\pos(52,150)\\an7\\p1\\c${color(c.color)}\\alpha&H50&\\bord0\\shad0}` +
      `m 0 0 l ${ancho} 0 l ${ancho} 52 l 0 52{\\p0}`,
    );
    filas.push(
      `Dialogue: 1,0:00:00.00,${fin},Certeza,,0,0,0,,{\\pos(69,176)\\an4\\c${color('#FFFFFF')}}${escapar(leyenda)}`,
    );
  }

  // El hook queda fijo: es el titular que se lee sin sonido.
  //
  // Anclado por ARRIBA (\an8), mientras el subtítulo se ancla por abajo. Con los
  // dos centrados, un titular de dos líneas terminaba a 60 px del subtítulo y
  // cualquier bloque que creciera se le metía encima. Anclados en direcciones
  // opuestas crecen hacia afuera y el aire del medio nunca se pierde.
  filas.push(
    `Dialogue: 2,0:00:00.00,${fin},Hook,,0,0,0,,{\\pos(${g.margen},${g.hookY})\\an7\\fad(220,0)}${partirHook(hook)}`,
  );

  // Cuando el fondo no es una foto del hecho sino una imagen generada, se dice.
  // Publicar una recreación como si fuera documental quema la credibilidad del medio.
  if (imagenGenerada) {
    filas.push(
      `Dialogue: 2,0:00:00.00,${fin},Aviso,,0,0,0,,{\\pos(24,1218)\\an1}Imagen ilustrativa generada con IA`,
    );
  }

  // Subtítulos: aparecen con un pop mínimo, sin animaciones que distraigan.
  // Si un bloque es una sola palabra larguísima, se encoge en vez de desbordar.
  for (const b of bloques) {
    const exceso = b.texto.length / g.maxChars;
    const escala = exceso > 1 ? Math.max(62, Math.round(100 / exceso)) : 100;
    filas.push(
      `Dialogue: 3,${t(b.desde)},${t(b.hasta)},Sub,,0,0,0,,` +
      `{\\pos(${g.margen},${g.subY})\\an7\\fscx${Math.round(escala * 0.93)}\\fscy93` +
      `\\t(0,110,\\fscx${escala}\\fscy100)}${escapar(b.texto)}`,
    );
  }

  return cabecera + filas.join('\n') + '\n';
}
