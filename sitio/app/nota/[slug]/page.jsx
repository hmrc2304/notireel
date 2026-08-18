import { notFound } from 'next/navigation';
import { porSlug, relacionadas, fechaLarga, haceCuanto, minutosDeLectura, ETIQUETA_CERTEZA } from '../../../lib/datos';

export const revalidate = 600;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const nota = await porSlug(slug);
  if (!nota) return { title: 'Nota no encontrada' };

  return {
    title: nota.titular,
    description: nota.bajada,
    openGraph: {
      type: 'article',
      title: nota.titular,
      description: nota.bajada,
      publishedTime: nota.publicada_en,
      modifiedTime: nota.actualizada_en,
      images: nota.imagen_url ? [nota.imagen_url] : [],
      url: `/nota/${nota.slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: nota.titular,
      description: nota.bajada,
      images: nota.imagen_url ? [nota.imagen_url] : [],
    },
    alternates: { canonical: `/nota/${nota.slug}` },
  };
}

export default async function Nota({ params }) {
  const { slug } = await params;
  const nota = await porSlug(slug);
  if (!nota) notFound();

  const otras = await relacionadas(nota);
  const certeza = ETIQUETA_CERTEZA[nota.certeza] ?? ETIQUETA_CERTEZA.confirmado;
  const parrafos = nota.cuerpo.split(/\n\s*\n/).filter(Boolean);

  // Google necesita el JSON-LD para mostrar la nota como artículo de noticias.
  const datos = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: nota.titular,
    description: nota.bajada,
    image: nota.imagen_url ? [nota.imagen_url] : undefined,
    datePublished: nota.publicada_en,
    dateModified: nota.actualizada_en,
    articleSection: nota.seccion,
    inLanguage: 'es-AR',
    publisher: { '@type': 'Organization', name: 'NotiViral' },
    citation: (nota.fuentes ?? []).map((f) => ({
      '@type': 'CreativeWork',
      name: f.titulo,
      url: f.url,
      publisher: { '@type': 'Organization', name: f.medio },
    })),
  };

  return (
    <div className="contenedor">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datos) }} />

      <article className="articulo">
        <div className="meta-linea" style={{ marginTop: 0 }}>
          <span className="chip-seccion">{nota.seccion}</span>
          <span className={`sello s-${nota.certeza}`} title={certeza.detalle}>{certeza.texto}</span>
          {nota.medios_count > 1 && <span className="cuantos-medios">{nota.medios_count} fuentes</span>}
          <span className="fecha">{fechaLarga(nota.publicada_en)} · {haceCuanto(nota.publicada_en)}</span>
          <span className="lectura">{minutosDeLectura(nota.cuerpo)} min de lectura</span>
        </div>

        <h1>{nota.titular}</h1>
        <p className="bajada">{nota.bajada}</p>

        {nota.video_url ? (
          <>
            {/*
              El 16:9 cuando existe. El vertical mide 1080x1920: a ancho completo
              ocupa más de mil trescientos píxeles de alto y empuja el cuerpo de
              la nota fuera de la pantalla. Las notas viejas, que solo tienen el
              vertical, se muestran contenidas.
            */}
            <video
              className={`video-nota ${nota.video_horizontal_url ? '' : 'vertical'}`}
              controls
              preload="metadata"
              poster={nota.imagen_url ?? undefined}
            >
              <source src={nota.video_horizontal_url ?? nota.video_url} type="video/mp4" />
            </video>
            {nota.video_origen === 'oficial' && (
              <p className="pie-imagen">Video de fuente oficial, reproducido con fines informativos.</p>
            )}
          </>
        ) : nota.imagen_url ? (
          <>
            <div className="portada-nota"><img src={nota.imagen_url} alt="" /></div>
            {nota.imagen_generada && (
              <p className="pie-imagen">Imagen ilustrativa generada con IA. No es una fotografía del hecho.</p>
            )}
          </>
        ) : null}

        <div className="cuerpo">
          {parrafos.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        {nota.contraste && (
          <section className="contraste">
            <h2>Qué dice cada fuente</h2>
            <p>{nota.contraste}</p>
          </section>
        )}

        {nota.fuentes?.length > 0 && (
          <section className="fuentes">
            <h2>Fuentes</h2>
            <p className="aclara">
              Esta nota se escribió cruzando estas coberturas. Cada enlace lleva al original.
            </p>
            <ol>
              {nota.fuentes.map((f, i) => (
                <li key={i}>
                  <a href={f.url} target="_blank" rel="noopener noreferrer nofollow">
                    <span className="medio">{f.medio}</span>
                    {f.tipo === 'oficial' && <span className="marca-oficial">Oficial</span>}
                    <span className="tit">{f.titulo}</span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {nota.etiquetas?.length > 0 && (
          <div className="etiquetas">
            {nota.etiquetas.map((e) => <span key={e}>{e}</span>)}
          </div>
        )}
      </article>

      {otras.length > 0 && (
        <section className="rejilla" style={{ borderTop: '1px solid var(--linea)' }}>
          {otras.map((n) => (
            <article className="tarjeta" key={n.slug}>
              <a href={`/nota/${n.slug}`}>
                {n.imagen_url && <div className="marco"><img src={n.imagen_url} alt="" loading="lazy" /></div>}
                <h3>{n.titular}</h3>
              </a>
              <span className="fecha">{haceCuanto(n.publicada_en)}</span>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
