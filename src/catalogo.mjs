/**
 * Convierte la exploración de medios en el catálogo que consume el recolector.
 *
 * Lo que aporta el directorio del usuario más allá de las URLs es la clasificación
 * editorial, y eso cambia cómo se trata cada medio:
 *
 *   Nivel A  base de verificación          peso 1.3
 *   Nivel B  fuerte, hay que contrastarlo   peso 1.0
 *   Nivel C  versión de parte               peso 0.6
 *   Nivel D  monitor narrativo              peso 0.3 — nunca confirmación única
 *
 * El eje geopolítico habilita algo que antes no se podía: distinguir entre un hecho
 * cubierto por tres medios que miran desde el mismo lado y otro cubierto por partes
 * enfrentadas. Lo segundo es mucho más sólido, y la nota puede decirlo.
 *
 *   node src/catalogo.mjs                 arma el catálogo con todo lo explorado
 *   node src/catalogo.mjs --nivel A,B     solo los medios más confiables
 *   node src/catalogo.mjs --idioma es     solo los que publican en español
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, esPrincipal } from './config.mjs';

/** Los feeds de Google News traen el nombre del medio pegado al titular. */
const esViaGoogle = (feed) => String(feed).includes('news.google.com');

function alcanceDe(medio) {
  const region = (medio.region ?? '').toUpperCase();
  const pais = (medio.pais ?? '').toUpperCase();
  if (region.includes('AMÉRICA LATINA') || region.includes('AMERICA LATINA')) {
    return pais.startsWith('ARGENTINA') ? 'ar' : 'latam';
  }
  return 'global';
}

/** Identificador estable y legible para cada medio. */
function idDe(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

export function armarCatalogo(explorados, { niveles = null, idioma = null } = {}) {
  const usados = new Set();

  return explorados
    .filter((m) => m.feed)
    .filter((m) => !niveles || niveles.includes(m.nivel))
    .filter((m) => !idioma || (m.idioma ?? '').toLowerCase().includes(idioma))
    .map((m) => {
      let id = idDe(m.nombre);
      while (usados.has(id)) id = `${id}-2`;
      usados.add(id);

      return {
        id,
        medio: m.nombre,
        url: m.feed,
        idioma: (m.idioma ?? '').split('/')[0].toLowerCase() || 'es',
        alcance: alcanceDe(m),
        peso: m.peso,
        nivel: m.nivel,
        eje: m.eje,
        pais: m.pais,
        orientacion: m.orientacion,
        viaGoogle: esViaGoogle(m.feed),
      };
    })
    .sort((a, b) => b.peso - a.peso || a.medio.localeCompare(b.medio));
}

/** Escribe el módulo que importa el recolector. */
export function escribirModulo(catalogo, destino) {
  const porNivel = { A: 0, B: 0, C: 0, D: 0 };
  for (const f of catalogo) porNivel[f.nivel]++;

  const filas = catalogo.map((f) =>
    `  { id: ${JSON.stringify(f.id)}, medio: ${JSON.stringify(f.medio)}, url: ${JSON.stringify(f.url)},` +
    ` idioma: ${JSON.stringify(f.idioma)}, alcance: ${JSON.stringify(f.alcance)}, peso: ${f.peso},` +
    ` nivel: ${JSON.stringify(f.nivel)}, eje: ${JSON.stringify(f.eje)}, pais: ${JSON.stringify(f.pais)} },`
  ).join('\n');

  const contenido = `/**
 * Catálogo de medios. GENERADO por src/catalogo.mjs a partir del directorio
 * editorial y de la exploración de feeds. No editar a mano: se regenera.
 *
 * ${catalogo.length} medios con feed verificado.
 *   Nivel A: ${porNivel.A}  ·  B: ${porNivel.B}  ·  C: ${porNivel.C}  ·  D: ${porNivel.D}
 *
 * El nivel dice cómo tratar al medio, no si publica verdad o mentira:
 *   A base de verificación · B contrastar · C versión de parte · D nunca confirmación única.
 *
 * \`peso\` inclina el ranking; \`eje\` permite ver si un hecho lo cubren partes
 * enfrentadas o todos desde el mismo lado.
 */

export const FUENTES = [
${filas}
];

export const porId = (id) => FUENTES.find((f) => f.id === id);

/** Los que sirven para dar por confirmado un hecho. */
export const DE_VERIFICACION = FUENTES.filter((f) => f.nivel === 'A' || f.nivel === 'B');

/** Un hecho sostenido solo por estos no se publica como confirmado. */
export const SOLO_MONITOREO = FUENTES.filter((f) => f.nivel === 'D');
`;

  fs.writeFileSync(destino, contenido, 'utf8');
  return destino;
}

if (esPrincipal(import.meta.url)) {
  const origen = path.join(DIRS.salida, 'medios-explorados.json');
  if (!fs.existsSync(origen)) throw new Error(`Falta ${origen}. Corré antes: node src/explorar-medios.mjs`);

  const explorados = JSON.parse(fs.readFileSync(origen, 'utf8'));

  const iN = process.argv.indexOf('--nivel');
  const iI = process.argv.indexOf('--idioma');
  const niveles = iN > 0 ? process.argv[iN + 1].split(',').map((s) => s.trim().toUpperCase()) : null;
  const idioma = iI > 0 ? process.argv[iI + 1].toLowerCase() : null;

  const catalogo = armarCatalogo(explorados, { niveles, idioma });
  const destino = path.join(DIRS.raiz, 'src', 'fuentes.mjs');
  escribirModulo(catalogo, destino);

  console.log(`${explorados.length} explorados · ${explorados.filter((m) => m.feed).length} con feed`);
  console.log(`${catalogo.length} en el catálogo${niveles ? ` (niveles ${niveles.join(',')})` : ''}${idioma ? ` (idioma ${idioma})` : ''}\n`);

  for (const nivel of ['A', 'B', 'C', 'D']) {
    const n = catalogo.filter((f) => f.nivel === nivel);
    if (n.length) console.log(`  Nivel ${nivel}: ${String(n.length).padStart(3)} medios`);
  }
  const google = catalogo.filter((f) => f.viaGoogle).length;
  console.log(`\n  ${catalogo.length - google} con feed propio · ${google} vía Google News`);
  console.log(`\nEscrito en ${destino}`);
}
