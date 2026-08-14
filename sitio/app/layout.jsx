import localFont from 'next/font/local';
import './globals.css';
import { SECCIONES } from '../lib/datos';

// Anton solo para el masthead y los titulares: es la única fuente que se
// descarga, el resto usa la del sistema y no cuesta un byte.
const anton = localFont({
  src: '../public/fuentes/Anton-Regular.ttf',
  variable: '--fuente-anton',
  display: 'swap',
  weight: '400',
});

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITIO ?? 'https://notiviral.gemasdigitales.com'),
  title: {
    default: 'NotiReel · Noticias del mundo con las fuentes a la vista',
    template: '%s · NotiReel',
  },
  description:
    'Noticias internacionales en video corto. Cada nota cruza lo que publican varios medios y organismos oficiales, y muestra en qué difieren.',
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: 'NotiReel',
  },
  robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  alternates: { types: { 'application/rss+xml': '/feed.xml' } },
};

export const viewport = { themeColor: '#0E6B64' };

export default function RootLayout({ children }) {
  return (
    <html lang="es-AR" className={anton.variable}>
      <body>
        <header className="cabecera">
          <div className="contenedor">
            <div className="cabecera-fila">
              <a href="/" className="masthead" aria-label="NotiReel, portada">
                <span className="a">Noti</span><span className="b">Reel</span>
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span className="lema">Las fuentes, a la vista</span>
                <a href="/reels" className="enlace-reels">Reels</a>
              </div>
            </div>
            <nav className="menu" aria-label="Secciones">
              <a href="/">Portada</a>
              {SECCIONES.map((s) => (
                <a key={s} href={`/seccion/${encodeURIComponent(s.toLowerCase())}`}>{s}</a>
              ))}
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="pie">
          <div className="contenedor" style={{ display: 'flex', flexWrap: 'wrap', gap: '22px 40px', justifyContent: 'space-between', width: '100%' }}>
            <p>
              <strong>NotiReel</strong> reescribe cada hecho cruzando varias coberturas y cita a cada
              medio con su enlace. Cuando las cifras no coinciden, lo decimos en la nota.
            </p>
            <nav aria-label="Enlaces del pie">
              <a href="/">Portada</a>
              <a href="/feed.xml">RSS</a>
              <a href="/sitemap.xml">Mapa del sitio</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
