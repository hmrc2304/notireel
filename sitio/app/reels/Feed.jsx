'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Feed vertical tipo TikTok.
 *
 * Dos decisiones que lo hacen andar en el celular:
 *  - El scroll lo maneja el navegador con scroll-snap, no JavaScript. Interceptar
 *    el gesto para animar a mano se siente pesado en móviles de gama media.
 *  - Un IntersectionObserver decide qué video está a la vista: reproduce ese y pausa
 *    el resto. Sin eso, treinta videos suenan a la vez y el teléfono se traba.
 *
 * Arranca en silencio porque ningún navegador deja reproducir con audio sin que el
 * usuario toque antes; el botón de sonido es el primer gesto.
 */
export default function Feed({ notas }) {
  const [sonido, setSonido] = useState(false);
  const [activo, setActivo] = useState(0);
  const refs = useRef([]);

  useEffect(() => {
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const video = e.target.querySelector('video');
          if (!video) continue;
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            setActivo(Number(e.target.dataset.indice));
            video.play().catch(() => {});
          } else {
            video.pause();
            video.currentTime = 0;
          }
        }
      },
      { threshold: [0, 0.6, 1] },
    );

    refs.current.filter(Boolean).forEach((n) => observador.observe(n));
    return () => observador.disconnect();
  }, [notas.length]);

  useEffect(() => {
    refs.current.filter(Boolean).forEach((n) => {
      const v = n.querySelector('video');
      if (v) v.muted = !sonido;
    });
  }, [sonido]);

  return (
    <div className="feed">
      <button
        className="boton-sonido"
        onClick={() => setSonido((s) => !s)}
        aria-label={sonido ? 'Silenciar' : 'Activar sonido'}
      >
        {sonido ? '🔊 Sonido' : '🔇 Sin sonido'}
      </button>

      {notas.map((n, i) => (
        <section
          className="reel"
          key={n.slug}
          data-indice={i}
          ref={(el) => { refs.current[i] = el; }}
        >
          <video
            src={n.video_url}
            poster={n.imagen_url ?? undefined}
            muted
            loop
            playsInline
            preload={i < 2 ? 'auto' : 'none'}
          />

          <div className="reel-velo" />

          <div className="reel-datos">
            <div className="reel-sellos">
              <span className="chip-seccion" style={{ color: '#4FBDB2' }}>{n.seccion}</span>
              {n.medios_count > 1 && <span className="reel-fuentes">{n.medios_count} fuentes</span>}
            </div>
            <h2>{n.titular}</h2>
            <p>{n.bajada}</p>
            <a href={`/nota/${n.slug}`} className="reel-cta">
              Leer la nota con todas las fuentes
            </a>
          </div>

          {i === activo && i === 0 && (
            <div className="reel-pista" aria-hidden="true">Desliza para seguir</div>
          )}
        </section>
      ))}
    </div>
  );
}
