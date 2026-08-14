import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  // Sin esto, Next sube por el árbol buscando el lockfile, encuentra uno suelto
  // en el home del usuario y toma C:\Users\... como raíz del proyecto.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },

  // Las imágenes vienen de Supabase Storage y de los feeds de los medios, que son
  // decenas de dominios distintos. Con <img> normal y el optimizador apagado no
  // hay que mantener una lista blanca que se rompe cada vez que entra un medio nuevo.
  images: { unoptimized: true },
  poweredByHeader: false,

  async headers() {
    return [{
      source: '/:ruta*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default config;
