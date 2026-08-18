/**
 * Qué cuesta el motor, por etapa y por día.
 *
 * El único indicador que había era que el crédito se agotara, y eso avisa tarde:
 * pasó dos veces en una semana, y las dos el culpable fue una etapa concreta
 * comiéndose el presupuesto sin que se notara. Cada llamada al modelo queda
 * anotada con su etapa en la tabla `gasto`; acá se suma y se convierte en plata.
 *
 *   node src/gasto.mjs           los últimos 7 días
 *   node src/gasto.mjs --dias 30
 */

import { env, esPrincipal, salirPorError } from './config.mjs';
import { costoEnDolares } from './claude.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

const plata = (d) => (d < 0.01 ? `${(d * 100).toFixed(2)} ¢` : `US$ ${d.toFixed(2)}`);
const dia = (t) => new Date(t).toISOString().slice(0, 10);

async function filas(dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const k = CLAVE();

  const todas = [];
  // PostgREST corta en 1000 por respuesta, y una semana de motor pasa eso.
  for (let salto = 0; ; salto += 1000) {
    const r = await fetch(
      `${URL_BASE()}/rest/v1/gasto?select=etapa,modelo,entrada,salida,cacheada,cuando`
      + `&cuando=gte.${desde}&order=cuando.asc&limit=1000&offset=${salto}`,
      { headers: { apikey: k, Authorization: `Bearer ${k}` } },
    );
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const tanda = await r.json();
    todas.push(...tanda);
    if (tanda.length < 1000) return todas;
  }
}

/** Agrupa por una clave y suma llamadas, tokens y dólares. */
function resumir(filas, clave) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    const a = m.get(k) ?? { llamadas: 0, entrada: 0, salida: 0, dolares: 0 };
    a.llamadas++;
    a.entrada += f.entrada ?? 0;
    a.salida += f.salida ?? 0;
    a.dolares += costoEnDolares({ modelo: f.modelo, entrada: f.entrada, salida: f.salida });
    m.set(k, a);
  }
  return m;
}

export async function informe({ dias = 7 } = {}) {
  const datos = await filas(dias);
  if (!datos.length) {
    console.log(`Sin llamadas registradas en los últimos ${dias} días.`);
    return 0;
  }

  const total = datos.reduce(
    (s, f) => s + costoEnDolares({ modelo: f.modelo, entrada: f.entrada, salida: f.salida }),
    0,
  );

  const porDia = resumir(datos, (f) => dia(f.cuando));
  console.log(`\nPOR DÍA (últimos ${dias})`);
  for (const [d, a] of [...porDia].sort()) {
    console.log(`  ${d}  ${plata(a.dolares).padStart(10)}   ${String(a.llamadas).padStart(4)} llamadas`);
  }

  console.log('\nPOR ETAPA');
  const porEtapa = [...resumir(datos, (f) => f.etapa)].sort((a, b) => b[1].dolares - a[1].dolares);
  for (const [e, a] of porEtapa) {
    const parte = ((a.dolares / total) * 100).toFixed(0);
    console.log(
      `  ${e.padEnd(16)} ${plata(a.dolares).padStart(10)}  ${String(parte).padStart(3)}%`
      + `  ${String(a.llamadas).padStart(4)} llamadas`
      + `  ${(a.entrada / 1000).toFixed(0)}k entrada / ${(a.salida / 1000).toFixed(0)}k salida`,
    );
  }

  console.log('\nPOR MODELO');
  for (const [m, a] of [...resumir(datos, (f) => f.modelo)].sort((a, b) => b[1].dolares - a[1].dolares)) {
    console.log(`  ${m.padEnd(20)} ${plata(a.dolares).padStart(10)}   ${String(a.llamadas).padStart(4)} llamadas`);
  }

  const dias_reales = porDia.size;
  console.log(`\nTOTAL ${plata(total)} en ${dias_reales} día(s) con actividad`);
  console.log(`Promedio ${plata(total / dias_reales)} por día · proyección mensual ${plata((total / dias_reales) * 30)}`);
  return total;
}

if (esPrincipal(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--dias');
    await informe({ dias: i > 0 ? Number(process.argv[i + 1]) : 7 });
  } catch (e) {
    process.exit(salirPorError(e, 'el informe de gasto'));
  }
}
