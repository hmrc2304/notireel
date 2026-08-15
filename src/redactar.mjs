/**
 * Redactor: convierte un grupo de noticias sobre el mismo hecho en una nota propia
 * que contrasta lo que dice cada medio.
 *
 * Esto es lo que el sitio promete en su portada ("comparamos fuentes, analizamos
 * sesgos") y hoy no hace. Además resuelve el problema legal: los hechos no tienen
 * copyright, el texto sí. Se toma el hecho de varios medios, se reescribe entero
 * y se cita a cada uno con su enlace.
 *
 * Regla dura del prompt: solo lo que dicen los resúmenes. Un modelo que rellena
 * huecos en una nota periodística es un generador de desinformación.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env, DIRS, esPrincipal, esSinSaldo } from './config.mjs';

const MODELO = 'claude-sonnet-5';

/* ─────────────────────────── ranking ─────────────────────────── */

/**
 * Puntaje de un grupo. Que varios medios cubran lo mismo es la mejor señal
 * disponible de que el hecho importa, así que pesa más que todo lo demás.
 */
export function puntuar(grupo) {
  const medios = grupo.cantidadMedios;
  const horas = (Date.now() - new Date(grupo.fecha).getTime()) / 3600000;

  const porCobertura = Math.min(medios, 8) * 10;
  const porPrestigio = grupo.pesoMedios * 2;
  const porFrescura = Math.max(0, 24 - horas) * 0.8;
  const porMaterial = Math.min(grupo.noticias.reduce((s, n) => s + n.resumen.length, 0) / 400, 8);
  const conImagen = grupo.imagen ? 3 : 0;

  return Math.round((porCobertura + porPrestigio + porFrescura + porMaterial + conImagen) * 10) / 10;
}

export const rankear = (grupos) =>
  grupos
    .map((g) => ({ ...g, puntaje: puntuar(g) }))
    .sort((a, b) => b.puntaje - a.puntaje);

/* ─────────────────────────── redacción ─────────────────────────── */

const HERRAMIENTA = {
  name: 'entregar_nota',
  description: 'Entrega la nota periodística redactada a partir de las coberturas recibidas.',
  input_schema: {
    type: 'object',
    properties: {
      titular: { type: 'string', description: 'titular propio en español, concreto, sin signos de exclamación ni mayúsculas sostenidas' },
      bajada: { type: 'string', description: 'una o dos frases que amplían el titular, hasta 200 caracteres' },
      cuerpo: { type: 'string', description: 'la nota en español, de 300 a 450 palabras, en párrafos separados por una línea en blanco' },
      seccion: { type: 'string', enum: ['Mundo', 'Política', 'Economía', 'Sociedad', 'Tecnología', 'Deportes', 'Ciencia'] },
      contraste: {
        type: 'string',
        description: 'qué aporta cada medio y en qué difieren entre sí. Si todos coinciden, decilo en una frase. Vacío si hay un solo medio.',
      },
      certeza: {
        type: 'string',
        enum: ['confirmado', 'en_desarrollo', 'version_unica'],
        description: 'confirmado si varios medios independientes coinciden; en_desarrollo si los datos todavía cambian; version_unica si lo reporta un solo medio',
      },
      etiquetas: { type: 'array', items: { type: 'string' }, description: '4 a 6 temas o entidades de la nota' },
    },
    required: ['titular', 'bajada', 'cuerpo', 'seccion', 'contraste', 'certeza', 'etiquetas'],
  },
};

const SISTEMA = `Redactás para Noti Viral, un medio digital en español que cubre noticias del mundo.
Tu material son las coberturas que varios medios publicaron sobre un mismo hecho.

REGLAS DURAS:
- Escribís en español neutro. Nada de voseo.
- SOLO podés afirmar lo que está en las coberturas recibidas. No completes con lo que sepas
  del tema ni con contexto que no esté en el material. Si un dato no está, no existe.
- Reescribís con tus palabras. Nunca copies frases textuales de las coberturas, salvo que
  sea una declaración entrecomillada, y en ese caso atribuila a quien la dijo.
- Cuando los medios difieren en una cifra o en un detalle, decilo explícitamente en el
  cuerpo: "según X son 8 muertos, mientras que Y habla de 12".
- Atribuí la información: "según la BBC", "de acuerdo con EFE". El lector tiene que poder
  rastrear cada dato.
- Frases cortas y directas. Nada de adjetivos de relleno ni de suspenso artificial.
- PROHIBIDO el guion largo (—). Usá coma o punto.
- Nada de "en un hecho sin precedentes", "lo que nadie te cuenta" ni fórmulas de clickbait.
- Si el material es pobre y no alcanza para 300 palabras honestas, escribí una nota más
  corta antes que inventar.
- NUNCA menciones el material que recibiste ni sus límites. Nada de "el fragmento
  disponible", "el medio no precisa", "según el resumen". El lector lee una nota
  terminada, no ve tu proceso: si un dato está incompleto, se omite y listo.
- Señalar que las cifras difieren entre medios SÍ va, porque es información sobre el
  hecho. Señalar que tu fuente estaba recortada NO va.`;

function material(grupo) {
  const coberturas = grupo.noticias
    .map((n, i) => `--- COBERTURA ${i + 1}: ${n.medio} (${n.fecha?.slice(0, 16) ?? 'sin fecha'})
TITULAR: ${n.titulo}
TEXTO: ${n.resumen || '(el feed no trae resumen)'}`)
    .join('\n\n');

  return `Un mismo hecho cubierto por ${grupo.cantidadMedios} medio(s): ${grupo.medios.join(', ')}.

${coberturas}

---
Redactá la nota de Noti Viral sobre este hecho.`;
}

const DEPURAR = {
  name: 'depurar_grupo',
  description: 'Indica qué coberturas del grupo son realmente del mismo hecho.',
  input_schema: {
    type: 'object',
    properties: {
      del_hecho: {
        type: 'array',
        items: { type: 'integer' },
        description: 'números de las coberturas que sí tratan el hecho principal',
      },
      hecho: { type: 'string', description: 'en una frase, cuál es el hecho principal' },
    },
    required: ['del_hecho', 'hecho'],
  },
};

/**
 * Saca del grupo las coberturas que no son del mismo hecho.
 *
 * La agrupación por texto es rápida y barata, pero con miles de noticias mete
 * falsos positivos: una nota de Kazajistán terminó dentro de una de Colombia por
 * compartir unas pocas palabras. Redactar sobre un grupo sucio produce una nota
 * que mezcla dos hechos y atribuye a un medio algo que nunca dijo, que es el peor
 * error posible para un medio que se presenta como verificador.
 *
 * Se hace solo con los grupos que se van a publicar, así que cuesta centavos.
 */
export async function depurarGrupo(grupo) {
  if (grupo.noticias.length < 3) return grupo;

  const lista = grupo.noticias
    .map((n, i) => `${i}. [${n.medio}] ${n.titulo}`)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 800,
      system: `Recibís titulares que un agrupador automático juntó como si fueran el mismo hecho.
El agrupador se equivoca: mete titulares que solo comparten alguna palabra.

Tomá el hecho del PRIMER titular como referencia y decidí cuáles de los demás tratan
ESE MISMO hecho puntual. Un titular sobre el mismo país, la misma persona o el mismo
conflicto pero sobre otro episodio NO va. Los titulares en otros idiomas cuentan si
son del mismo hecho. Incluí siempre el 0.`,
      tools: [DEPURAR],
      tool_choice: { type: 'tool', name: 'depurar_grupo' },
      messages: [{ role: 'user', content: lista }],
    }),
  });

  if (!res.ok) return grupo;
  const uso = (await res.json()).content.find((b) => b.type === 'tool_use');
  if (!uso) return grupo;

  const quedan = new Set(uso.input.del_hecho.filter((i) => Number.isInteger(i) && grupo.noticias[i]));
  quedan.add(0);
  if (quedan.size === grupo.noticias.length) return grupo;

  const limpias = grupo.noticias.filter((_, i) => quedan.has(i));
  const medios = [...new Set(limpias.map((n) => n.medio))];

  console.log(`    depurado: ${grupo.noticias.length} coberturas -> ${limpias.length}`);

  return {
    ...grupo,
    noticias: limpias,
    medios,
    cantidadMedios: medios.length,
    ejes: [...new Set(limpias.map((n) => n.eje).filter(Boolean))],
  };
}

export async function redactarNota(grupoCrudo) {
  const grupo = await depurarGrupo(grupoCrudo);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 2500,
      system: SISTEMA,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: 'entregar_nota' },
      messages: [{ role: 'user', content: material(grupo) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const uso = data.content.find((b) => b.type === 'tool_use');
  if (!uso) throw new Error('el modelo no redactó la nota');

  const n = uso.input;
  n.cuerpo = n.cuerpo.replace(/\s*—\s*/g, ', ');
  n.titular = n.titular.replace(/\s*—\s*/g, ', ');
  // A veces devuelve las etiquetas como texto separado por comas en vez de lista,
  // y Postgres rechaza el insert entero por el array mal formado.
  if (!Array.isArray(n.etiquetas)) n.etiquetas = String(n.etiquetas ?? '').split(/\s*,\s*/);
  n.etiquetas = n.etiquetas.map((e) => String(e).trim()).filter(Boolean);

  return {
    ...n,
    palabras: n.cuerpo.split(/\s+/).length,
    imagen: grupo.imagen,
    fecha: grupo.fecha,
    puntaje: grupo.puntaje ?? null,
    fuentes: grupo.noticias.map((x) => ({ medio: x.medio, titulo: x.titulo, url: x.url, fecha: x.fecha })),
  };
}

/** Ciclo completo: recolectar, agrupar, rankear y redactar las mejores. */
export async function producir({ cantidad = 3, horas = 24, minMedios = 1 } = {}) {
  const { recolectar } = await import('./recolector.mjs');
  const { agrupar } = await import('./agrupar.mjs');

  const { items } = await recolectar({ horas });
  const grupos = await agrupar(items);
  const ranking = rankear(grupos).filter((g) => g.cantidadMedios >= minMedios);

  const notas = [];
  for (const g of ranking.slice(0, cantidad)) {
    try {
      notas.push(await redactarNota(g));
    } catch (e) {
      // Sin saldo van a fallar todas igual, y el error repetido una vez por nota
      // sepulta el motivo. Se corta y se avisa una sola vez, arriba.
      if (esSinSaldo(e)) throw e;
      console.error(`  ! ${g.titular.slice(0, 50)}: ${e.message}`);
    }
  }
  return { notas, totalGrupos: grupos.length, totalItems: items.length };
}

export function guardarNotas(notas) {
  const dir = path.join(DIRS.salida, 'notas');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `notas-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify(notas, null, 2), 'utf8');
  return archivo;
}

if (esPrincipal(import.meta.url)) {
  const cantidad = Number(process.argv[2] ?? 3);
  console.log(`Produciendo ${cantidad} notas...\n`);

  const { notas, totalGrupos, totalItems } = await producir({ cantidad, minMedios: 2 });
  console.log(`${totalItems} noticias, ${totalGrupos} hechos distintos, ${notas.length} notas redactadas\n`);

  for (const n of notas) {
    console.log('='.repeat(78));
    console.log(`${n.titular}`);
    console.log(`[${n.seccion}] ${n.certeza} · ${n.palabras} palabras · puntaje ${n.puntaje}`);
    console.log(`\n${n.bajada}\n`);
    console.log(n.cuerpo);
    console.log(`\nCONTRASTE DE FUENTES: ${n.contraste}`);
    console.log(`\nFUENTES:`);
    for (const f of n.fuentes) console.log(`  · ${f.medio}: ${f.titulo.slice(0, 62)}`);
    console.log();
  }

  console.log(`Guardado en ${guardarNotas(notas)}`);
}
