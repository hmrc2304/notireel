import { portada, haceCuanto, ETIQUETA_CERTEZA } from '../lib/datos';

export const revalidate = 300;

function Sello({ certeza }) {
  const e = ETIQUETA_CERTEZA[certeza] ?? ETIQUETA_CERTEZA.confirmado;
  return <span className={`sello s-${certeza}`} title={e.detalle}>{e.texto}</span>;
}

function Medios({ n }) {
  if (!n || n < 2) return null;
  return <span className="cuantos-medios">{n} fuentes</span>;
}

function Marco({ nota }) {
  if (!nota.imagen_url) return null;
  return (
    <div className="marco">
      <img src={nota.imagen_url} alt="" loading="lazy" />
      {nota.video_url && (
        <span className="insignia-video">
          {nota.video_origen === 'oficial' ? 'Video oficial' : 'Video'}
        </span>
      )}
    </div>
  );
}

export default async function Portada() {
  const notas = await portada({ limite: 25 });

  if (!notas.length) {
    return (
      <div className="contenedor vacio">
        <strong>Todavía no hay notas publicadas</strong>
        El recolector las va a ir cargando a medida que corra.
      </div>
    );
  }

  const [principal, ...resto] = notas;
  const laterales = resto.slice(0, 5);
  const grilla = resto.slice(5);

  return (
    <div className="contenedor">
      <section className="tapa">
        <article className="nota-tapa">
          <a href={`/nota/${principal.slug}`}>
            <Marco nota={principal} />
            <h1>{principal.titular}</h1>
          </a>
          <p>{principal.bajada}</p>
          <div className="meta-linea">
            <span className="chip-seccion">{principal.seccion}</span>
            <Sello certeza={principal.certeza} />
            <Medios n={principal.medios_count} />
            <span className="fecha">{haceCuanto(principal.publicada_en)}</span>
          </div>
        </article>

        <aside className="columna-lateral">
          <h2>Últimas</h2>
          {laterales.map((n) => (
            <article className="breve" key={n.slug}>
              <a href={`/nota/${n.slug}`}><h3>{n.titular}</h3></a>
              <div className="meta-linea" style={{ marginTop: 0 }}>
                <Sello certeza={n.certeza} />
                <Medios n={n.medios_count} />
                <span className="fecha">{haceCuanto(n.publicada_en)}</span>
              </div>
            </article>
          ))}
        </aside>
      </section>

      <section className="rejilla">
        {grilla.map((n) => (
          <article className="tarjeta" key={n.slug}>
            <a href={`/nota/${n.slug}`}>
              <Marco nota={n} />
            </a>
            <div className="meta-linea" style={{ marginTop: 0 }}>
              <span className="chip-seccion">{n.seccion}</span>
              <Sello certeza={n.certeza} />
              <Medios n={n.medios_count} />
            </div>
            <a href={`/nota/${n.slug}`}><h3>{n.titular}</h3></a>
            <p>{n.bajada}</p>
            <span className="fecha">{haceCuanto(n.publicada_en)}</span>
          </article>
        ))}
      </section>
    </div>
  );
}
