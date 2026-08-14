import { notFound } from 'next/navigation';
import { porSeccion, SECCIONES, haceCuanto, ETIQUETA_CERTEZA } from '../../../lib/datos';

export const revalidate = 300;

/** La URL va en minúscula; la base guarda el nombre con mayúscula y tilde. */
function resolver(param) {
  const limpio = decodeURIComponent(param).toLowerCase();
  return SECCIONES.find((s) => s.toLowerCase() === limpio) ?? null;
}

export async function generateMetadata({ params }) {
  const { seccion } = await params;
  const nombre = resolver(seccion);
  if (!nombre) return { title: 'Sección no encontrada' };
  return {
    title: nombre,
    description: `Últimas noticias de ${nombre} con las fuentes a la vista.`,
    alternates: { canonical: `/seccion/${nombre.toLowerCase()}` },
  };
}

export function generateStaticParams() {
  return SECCIONES.map((s) => ({ seccion: s.toLowerCase() }));
}

export default async function Seccion({ params }) {
  const { seccion } = await params;
  const nombre = resolver(seccion);
  if (!nombre) notFound();

  const notas = await porSeccion(nombre);

  return (
    <div className="contenedor">
      <h1 style={{
        fontFamily: 'var(--display)', fontSize: 'clamp(32px,5vw,50px)', textTransform: 'uppercase',
        margin: '34px 0 6px', letterSpacing: '.004em', lineHeight: 1.02,
      }}>{nombre}</h1>

      {!notas.length ? (
        <div className="vacio">
          <strong>Todavía no hay notas en esta sección</strong>
          Van a aparecer acá en cuanto el recolector encuentre algo.
        </div>
      ) : (
        <section className="rejilla">
          {notas.map((n) => {
            const e = ETIQUETA_CERTEZA[n.certeza] ?? ETIQUETA_CERTEZA.confirmado;
            return (
              <article className="tarjeta" key={n.slug}>
                <a href={`/nota/${n.slug}`}>
                  {n.imagen_url && (
                    <div className="marco">
                      <img src={n.imagen_url} alt="" loading="lazy" />
                      {n.video_url && (
                        <span className="insignia-video">
                          {n.video_origen === 'oficial' ? 'Video oficial' : 'Video'}
                        </span>
                      )}
                    </div>
                  )}
                </a>
                <div className="meta-linea" style={{ marginTop: 0 }}>
                  <span className={`sello s-${n.certeza}`} title={e.detalle}>{e.texto}</span>
                  {n.medios_count > 1 && <span className="cuantos-medios">{n.medios_count} fuentes</span>}
                </div>
                <a href={`/nota/${n.slug}`}><h3>{n.titular}</h3></a>
                <p>{n.bajada}</p>
                <span className="fecha">{haceCuanto(n.publicada_en)}</span>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
