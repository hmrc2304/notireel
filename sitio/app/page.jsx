import { portada, haceCuanto, ETIQUETA_CERTEZA } from '../lib/datos';

export const revalidate = 300;

/**
 * Portada.
 *
 * Tres decisiones de estructura, tomadas mirando cómo resuelven la suya los
 * medios que viven de esto:
 *
 *  1. El titular va ARRIBA de la foto en las notas destacadas. Infobae, Semafor
 *     y El País lo hacen igual: el lector decide con el texto, la foto confirma.
 *  2. Jerarquía en cuatro escalones, de la apertura a la lista compacta del
 *     final. Una grilla donde todo pesa lo mismo obliga a leer todo para
 *     encontrar algo.
 *  3. Densidad. Antes entraban 11 notas en toda la página; ahora entran 24, que
 *     es lo que hace que un sitio parezca un medio y no un blog.
 *
 * El sello de fuentes es elemento de primer orden y no letra chica: es lo único
 * que este sitio tiene y los grandes no.
 */

function Sello({ certeza }) {
  const e = ETIQUETA_CERTEZA[certeza] ?? ETIQUETA_CERTEZA.confirmado;
  return <span className={`sello s-${certeza}`} title={e.detalle}>{e.texto}</span>;
}

function Fuentes({ n }) {
  if (!n || n < 2) return null;
  return <span className="cuantos-medios"><b>{n}</b> fuentes</span>;
}

/**
 * La foto, con el triángulo de reproducción cuando hay video.
 * `prioridad` carga sin esperar: es la única imagen que el lector ve de entrada.
 */
function Foto({ nota, prioridad = false, proporcion, hueco = false }) {
  // Sin foto, la tarjeta deja el lugar reservado: si se encoge, desalinea toda la
  // fila de la grilla y el pie de una tarjeta queda a media altura de la de al lado.
  if (!nota.imagen_url) {
    return hueco ? <div className="hueco-foto" style={proporcion ? { aspectRatio: proporcion } : undefined} /> : null;
  }
  return (
    <div className="marco" style={proporcion ? { aspectRatio: proporcion } : undefined}>
      <img
        src={nota.imagen_url}
        alt=""
        loading={prioridad ? 'eager' : 'lazy'}
        fetchPriority={prioridad ? 'high' : 'auto'}
      />
      {nota.video_url && (
        <span className="reproducir" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          {nota.video_origen === 'oficial' ? 'Video oficial' : 'Video'}
        </span>
      )}
    </div>
  );
}

export default async function Portada() {
  const notas = await portada({ limite: 26 });

  if (!notas.length) {
    return (
      <div className="contenedor vacio">
        <strong>Todavía no hay notas publicadas</strong>
        El recolector las va a ir cargando a medida que corra.
      </div>
    );
  }

  /**
   * Cada nota aparece UNA vez. Sin esto la franja de video mostraba otra vez las
   * seis de la apertura, porque son las mismas que tienen video, y la portada
   * parecía tener la mitad de contenido del que tiene.
   *
   * Los bloques se sirven en orden de importancia y cada uno toma de lo que
   * quedó: así con pocas notas la portada se acorta sola en vez de quedar con
   * secciones de un solo elemento.
   */
  const disponibles = [...notas];
  const tomar = (cuantos, filtro = () => true) => {
    const elegidas = [];
    for (let i = 0; i < disponibles.length && elegidas.length < cuantos; i++) {
      if (!filtro(disponibles[i])) continue;
      elegidas.push(disponibles.splice(i, 1)[0]);
      i--;
    }
    return elegidas;
  };

  const [principal] = tomar(1);
  // La columna del hero es más alta que la de al lado: sin estas tres, abajo
  // quedaba un vacío del alto de media pantalla.
  const bajoHero = tomar(3);
  const secundarias = tomar(2);
  const conVideo = tomar(6, (n) => n.video_url);
  const ultimas = tomar(5);
  const grilla = tomar(8);
  const breves = disponibles;

  return (
    <div className="contenedor">

      {/*
        La cinta es un ticker, no un bloque de contenido: muestra lo más reciente
        aunque ya esté abajo, igual que la barra de un canal de noticias. Por eso
        se sirve de `notas` y no del reparto sin repetir.
      */}
      <div className="cinta" aria-label="Lo último">
        <span className="cinta-rotulo">Ahora</span>
        <div className="cinta-pista">
          {notas.slice(0, 6).map((n) => (
            <a href={`/nota/${n.slug}`} key={n.slug} className="cinta-item">
              <span className="cinta-hora">{haceCuanto(n.publicada_en)}</span>
              {n.titular}
            </a>
          ))}
        </div>
      </div>

      <section className="apertura">
        <article className="nota-tapa">
          <a href={`/nota/${principal.slug}`}>
            <div className="meta-linea sobre">
              <span className="chip-seccion">{principal.seccion}</span>
              <Sello certeza={principal.certeza} />
              <Fuentes n={principal.medios_count} />
            </div>
            <h1>{principal.titular}</h1>
            <p className="entradilla">{principal.bajada}</p>
            <Foto nota={principal} prioridad proporcion="16 / 9" />
          </a>
          <span className="fecha">{haceCuanto(principal.publicada_en)}</span>

          {bajoHero.length > 0 && (
            <div className="bajo-tapa">
              {bajoHero.map((n) => (
                <article className="compacta" key={n.slug}>
                  <a href={`/nota/${n.slug}`}>
                    <span className="chip-seccion">{n.seccion}</span>
                    <h3>{n.titular}</h3>
                    <Foto nota={n} proporcion="16 / 10" />
                  </a>
                  <div className="meta-linea apretada">
                    <Fuentes n={n.medios_count} />
                    <span className="fecha">{haceCuanto(n.publicada_en)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <div className="costado">
          {secundarias.map((n) => (
            <article className="destacada" key={n.slug}>
              <a href={`/nota/${n.slug}`}>
                <div className="meta-linea sobre">
                  <span className="chip-seccion">{n.seccion}</span>
                  <Fuentes n={n.medios_count} />
                </div>
                <h2>{n.titular}</h2>
                <Foto nota={n} proporcion="16 / 9" />
              </a>
            </article>
          ))}

          <div className="ultimas">
            <h2 className="rotulo-bloque">Últimas</h2>
            {ultimas.map((n) => (
              <article className="breve" key={n.slug}>
                <a href={`/nota/${n.slug}`}><h3>{n.titular}</h3></a>
                <div className="meta-linea apretada">
                  <Sello certeza={n.certeza} />
                  <Fuentes n={n.medios_count} />
                  <span className="fecha">{haceCuanto(n.publicada_en)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {conVideo.length >= 3 && (
        <section className="franja-video">
          <div className="franja-cabeza">
            <h2 className="rotulo-bloque">En video</h2>
            <a href="/reels" className="ver-todo">Ver el feed completo →</a>
          </div>
          <div className="carril">
            {conVideo.map((n) => (
              <a href={`/nota/${n.slug}`} key={n.slug} className="pieza">
                <Foto nota={n} proporcion="9 / 16" />
                <h3>{n.titular}</h3>
                <Fuentes n={n.medios_count} />
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="rejilla">
        {grilla.map((n) => (
          <article className="tarjeta" key={n.slug}>
            <a href={`/nota/${n.slug}`}>
              <div className="meta-linea sobre">
                <span className="chip-seccion">{n.seccion}</span>
                <Fuentes n={n.medios_count} />
              </div>
              <h3>{n.titular}</h3>
              <Foto nota={n} proporcion="16 / 10" hueco />
            </a>
            <p>{n.bajada}</p>
            <div className="meta-linea apretada">
              <Sello certeza={n.certeza} />
              <span className="fecha">{haceCuanto(n.publicada_en)}</span>
            </div>
          </article>
        ))}
      </section>

      {breves.length > 0 && (
        <section className="cierre">
          <h2 className="rotulo-bloque">También hoy</h2>
          <div className="lista-breve">
            {breves.map((n) => (
              <article className="renglon" key={n.slug}>
                <a href={`/nota/${n.slug}`}>
                  <span className="chip-seccion">{n.seccion}</span>
                  <h3>{n.titular}</h3>
                </a>
                <div className="meta-linea apretada">
                  <Fuentes n={n.medios_count} />
                  <span className="fecha">{haceCuanto(n.publicada_en)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
