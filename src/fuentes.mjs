/**
 * Catálogo de medios. Todos verificados el 14/08/2026: devuelven items y están
 * al día. Los que respondieron 404 quedaron fuera con la nota de por qué.
 *
 * Son feeds RSS, no scraping de HTML. El medio los publica para que se consuman:
 * son estables, vienen estructurados y no hay Cloudflare que esquivar.
 *
 * `peso` inclina el ranking hacia las agencias y los medios de referencia cuando
 * dos noticias empatan. `alcance` sirve para equilibrar la portada y que no queden
 * seis notas de Argentina seguidas.
 */

export const FUENTES = [
  // ── Agencias y medios de referencia internacionales ──────────────
  { id: 'ap', medio: 'AP', url: 'https://feedx.net/rss/ap.xml', idioma: 'es', alcance: 'global', peso: 1.3 },
  { id: 'efe', medio: 'EFE', url: 'https://news.google.com/rss/search?q=when:24h+site:efe.com&hl=es-419&gl=AR&ceid=AR:es-419', idioma: 'es', alcance: 'global', peso: 1.3 },
  { id: 'reuters', medio: 'Reuters', url: 'https://news.google.com/rss/search?q=when:24h+site:reuters.com&hl=es-419&gl=AR&ceid=AR:es-419', idioma: 'es', alcance: 'global', peso: 1.3 },

  { id: 'bbc-mundo', medio: 'BBC Mundo', url: 'https://feeds.bbci.co.uk/mundo/rss.xml', idioma: 'es', alcance: 'global', peso: 1.2 },
  { id: 'bbc-world', medio: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', idioma: 'en', alcance: 'global', peso: 1.2 },
  { id: 'nyt-world', medio: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', idioma: 'en', alcance: 'global', peso: 1.2 },
  { id: 'guardian', medio: 'The Guardian', url: 'https://www.theguardian.com/world/rss', idioma: 'en', alcance: 'global', peso: 1.1 },
  { id: 'aljazeera', medio: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', idioma: 'en', alcance: 'global', peso: 1.1 },
  { id: 'dw', medio: 'DW', url: 'https://rss.dw.com/rdf/rss-sp-all', idioma: 'es', alcance: 'global', peso: 1.1 },
  { id: 'france24', medio: 'France 24', url: 'https://www.france24.com/es/rss', idioma: 'es', alcance: 'global', peso: 1.1 },
  { id: 'euronews', medio: 'Euronews', url: 'https://es.euronews.com/rss', idioma: 'es', alcance: 'global', peso: 1 },
  { id: 'elpais', medio: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', idioma: 'es', alcance: 'global', peso: 1.1 },
  { id: 'abc', medio: 'ABC', url: 'https://www.abc.es/rss/2.0/internacional/', idioma: 'es', alcance: 'global', peso: 1 },
  { id: 'elmundo', medio: 'El Mundo', url: 'https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml', idioma: 'es', alcance: 'global', peso: 1 },
  { id: 'nbc', medio: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/world', idioma: 'en', alcance: 'global', peso: 1 },
  { id: 'cbs', medio: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/world', idioma: 'en', alcance: 'global', peso: 1 },
  { id: 'sky', medio: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml', idioma: 'en', alcance: 'global', peso: 1 },
  { id: 'rt', medio: 'RT', url: 'https://actualidad.rt.com/feeds/all.rss', idioma: 'es', alcance: 'global', peso: .7 },

  // ── América Latina ───────────────────────────────────────────────
  { id: 'cnn-es', medio: 'CNN en Español', url: 'https://feeds.feedburner.com/cnnespanol', idioma: 'es', alcance: 'latam', peso: 1.1 },
  { id: 'infobae-am', medio: 'Infobae América', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/america/?outputType=xml', idioma: 'es', alcance: 'latam', peso: 1 },
  { id: 'infobae', medio: 'Infobae', url: 'https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml', idioma: 'es', alcance: 'ar', peso: .9 },
  { id: 'clarin', medio: 'Clarín', url: 'https://www.clarin.com/rss/mundo/', idioma: 'es', alcance: 'ar', peso: .9 },
  { id: 'lanacion', medio: 'La Nación', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/el-mundo/?outputType=xml', idioma: 'es', alcance: 'ar', peso: .9 },

  // ── Agregadores: sirven de red de seguridad para lo que se escapa ─
  { id: 'gnews-mundo', medio: 'Google News', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=es-419&gl=AR&ceid=AR:es-419', idioma: 'es', alcance: 'global', peso: .6 },
  { id: 'gnews-top', medio: 'Google News', url: 'https://news.google.com/rss?hl=es-419&gl=AR&ceid=AR:es-419', idioma: 'es', alcance: 'latam', peso: .6 },
];

/**
 * Descartados el 14/08/2026, para no volver a probarlos:
 *   reuters.com/arc/outboundfeeds  → 404, Reuters cerró su RSS público
 *   cnnespanol.cnn.com/feed        → 404, migró a FeedBurner
 *   infobae.com/feeds/rss          → 404, ahora va por /arc/outboundfeeds
 *   pagina12, milenio, eluniversal, xinhua → 404
 */

export const porId = (id) => FUENTES.find((f) => f.id === id);
