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
 *
 * En el celular el gesto de deslizar ya está aprendido y alcanza con una pista en
 * la primera tarjeta. Con mouse no: nada indica que abajo hay otra nota, así que
 * en pantallas grandes van flechas, que además dan navegación por teclado.
 */
export default function Feed({ notas }) {
  const [sonido, setSonido] = useState(false);
  const [activo, setActivo] = useState(0);
  const refs = useRef([]);

  const irA = (i) => {
    const destino = refs.current[i];
    if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Las flechas del teclado son gratis: el contenedor tiene el scroll, no el
  // documento, así que sin esto no responden aunque el feed esté a la vista.
  useEffect(() => {
    const alTeclado = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); irA(Math.min(activo + 1, notas.length - 1)); }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); irA(Math.max(activo - 1, 0)); }
    };
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [activo, notas.length]);

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

      <nav className="flechas" aria-label="Navegar entre notas">
        <button
          type="button"
          onClick={() => irA(activo - 1)}
          disabled={activo === 0}
          aria-label="Nota anterior"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span className="flechas-cuenta">{activo + 1}/{notas.length}</span>

        <button
          type="button"
          onClick={() => irA(activo + 1)}
          disabled={activo >= notas.length - 1}
          aria-label="Nota siguiente"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </nav>

      {notas.map((n, i) => (
        <section
          className="reel"
          key={n.slug}
          data-indice={i}
          ref={(el) => { refs.current[i] = el; }}
        >
          {/* Todo el cuadro lleva a la nota: el botón queda como refuerzo visual,
              no como la única forma de entrar. */}
          <a href={`/nota/${n.slug}`} className="reel-tapa" aria-label={n.titular} />

          <video
            src={n.video_url}
            poster={n.imagen_url ?? undefined}
            muted
            loop
            playsInline
            preload={i < 2 ? 'auto' : 'none'}
          />

          <div className="reel-velo" />

          {/*
            Solo el botón. El video ya trae quemados el titular, la sección, el
            contador de fuentes y los subtítulos: repetirlos acá los superponía
            unos sobre otros y tapaba justo la parte de abajo del cuadro, que es
            donde el video pone su texto.
          */}
          <div className="reel-datos">
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
