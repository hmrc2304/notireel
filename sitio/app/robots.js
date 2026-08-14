const SITIO = process.env.NEXT_PUBLIC_SITIO ?? 'https://notiviral.gemasdigitales.com';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
