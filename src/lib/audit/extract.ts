import * as cheerio from "cheerio";

export type PageFacts = {
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  viewport: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  h1: string[];
  headings: { h1: number; h2: number; h3: number };
  images: { total: number; withoutAlt: number };
  links: { internal: number; external: number };
  hasNav: boolean;
  forms: { total: number; contactLike: number; embeddedProviders: string[] };
  booking: { providers: string[]; evidence: string[] };
  contact: { telLinks: number; mailtoLinks: number; phoneInText: boolean; emailInText: boolean; whatsapp: boolean };
  chat: string[];
  social: string[];
  cta: { count: number; samples: string[] };
  analytics: string[];
  generator: string | null;
  cms: string | null;
  structuredDataTypes: string[];
  openGraph: { title: boolean; description: boolean; image: boolean };
  copyrightYear: number | null;
  scripts: number;
  stylesheets: number;
  textLength: number;
  /** El HTML estático casi no contiene contenido: probablemente se genera con JavaScript. */
  likelyJsRendered: boolean;
  firstParagraph: string | null;
};

const BOOKING_HOSTS: [RegExp, string][] = [
  [/calendly\.com/i, "Calendly"], [/doctoralia\./i, "Doctoralia"], [/treatwell\./i, "Treatwell"], [/resengo\./i, "Resengo"],
  [/thefork\.|eltenedor\./i, "TheFork"], [/booksy\./i, "Booksy"], [/simplybook\./i, "SimplyBook"], [/reservio\./i, "Reservio"],
  [/setmore\./i, "Setmore"], [/acuityscheduling\./i, "Acuity"], [/opentable\./i, "OpenTable"], [/covermanager\./i, "CoverManager"],
  [/quandoo\./i, "Quandoo"], [/fresha\./i, "Fresha"], [/mindbodyonline\./i, "Mindbody"], [/cal\.com/i, "Cal.com"],
  [/tuotempo\./i, "TuoTempo"], [/synxis\.|travelclick\.|siteminder\.|d-edge\.|avalonaccess|bookingengine/i, "Motor de reservas hotelero"],
  [/booking\.com\/hotel/i, "Booking.com"], [/zenchef\./i, "Zenchef"], [/restoo\./i, "Restoo"], [/bookeo\./i, "Bookeo"],
];
const BOOKING_TEXT = /(reservar|reserva online|reserva tu|pedir cita|pide tu cita|solicitar cita|cita previa|book (now|online)|reserve)/i;

const FORM_HOSTS: [RegExp, string][] = [
  [/hsforms\.|hubspot\.com\/embed|js\.hsforms/i, "HubSpot"], [/typeform\.com/i, "Typeform"], [/jotform\./i, "Jotform"], [/tally\.so/i, "Tally"],
  [/docs\.google\.com\/forms|forms\.gle/i, "Google Forms"], [/formspree\.io/i, "Formspree"], [/wufoo\./i, "Wufoo"], [/airtable\.com\/embed/i, "Airtable"],
  [/mailchimp\.com|list-manage\.com/i, "Mailchimp"],
];

const CHAT_HOSTS: [RegExp, string][] = [
  [/tawk\.to/i, "Tawk.to"], [/crisp\.chat/i, "Crisp"], [/intercom/i, "Intercom"], [/drift\.com|driftt\.com/i, "Drift"],
  [/tidio/i, "Tidio"], [/livechatinc|livechat\.com/i, "LiveChat"], [/zdassets|zendesk/i, "Zendesk"], [/manychat/i, "ManyChat"],
  [/botpress|landbot|chatbot/i, "Chatbot"], [/js\.hs-scripts\.com|hubspot.*conversations/i, "HubSpot chat"],
  [/joinchat|elfsight.*whatsapp|whatsapp.*widget|wa-chat|click-to-chat/i, "Widget de WhatsApp"],
];

const ANALYTICS_HOSTS: [RegExp, string][] = [
  [/googletagmanager\.com/i, "Google Tag Manager"], [/google-analytics\.com|gtag\/js/i, "Google Analytics"],
  [/connect\.facebook\.net.*fbevents|facebook\.com\/tr/i, "Meta Pixel"], [/matomo|piwik/i, "Matomo"], [/plausible\.io/i, "Plausible"],
  [/hotjar\./i, "Hotjar"], [/clarity\.ms/i, "Microsoft Clarity"],
];

const SOCIAL: [RegExp, string][] = [
  [/facebook\.com\/(?!sharer|share|plugins|tr\b|dialog)/i, "Facebook"], [/instagram\.com\//i, "Instagram"], [/linkedin\.com\/(company|in|school)/i, "LinkedIn"],
  [/(twitter\.com|x\.com)\/(?!intent|share)/i, "X"], [/youtube\.com\/(@|channel|user|c\/)|youtu\.be/i, "YouTube"], [/tiktok\.com\/@/i, "TikTok"],
  [/pinterest\.[a-z]+\/(?!pin\/create)/i, "Pinterest"],
];

const CTA_TEXT = /(llam(a|ar|ános|anos)|contact(a|ar|o|anos|ar)|reserv|pide|pedir|solicit|cita|presupuesto|comprar|suscrib|más información|saber más|escríbenos|escribenos|call now|get a quote|whatsapp)/i;
const PHONE_RE = /(?:\+34[\s.-]?)?\b[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b|(?:\+34[\s.-]?)?\b[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const matchAll = (list: [RegExp, string][], haystack: string[]) => [...new Set(list.filter(([re]) => haystack.some((h) => re.test(h))).map(([, n]) => n))];
const clean = (s?: string | null) => s?.replace(/\s+/g, " ").trim() || null;

export function extractFacts(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();

  const srcs: string[] = [];
  $("script[src], iframe[src], link[href], img[src], a[href]").each((_, el) => {
    const v = $(el).attr("src") ?? $(el).attr("href");
    if (v) srcs.push(v);
  });
  const inlineScripts = $("script:not([src])").map((_, el) => $(el).html() ?? "").get().join("\n").slice(0, 200_000);
  const resources = [...srcs, inlineScripts];

  // Enlaces
  let internal = 0;
  let external = 0;
  const hrefs: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    hrefs.push(href);
    if (/^(#|javascript:|tel:|mailto:|sms:)/i.test(href)) return;
    try {
      const h = new URL(href, pageUrl).hostname.replace(/^www\./, "").toLowerCase();
      if (h === host) internal++;
      else external++;
    } catch { /* enlace mal formado */ }
  });

  // Formularios
  let contactLike = 0;
  $("form").each((_, el) => {
    const f = $(el);
    const isSearch = f.attr("role") === "search" || f.find("input[type=search]").length > 0 || /search|buscar/i.test(f.attr("action") ?? "");
    const isLogin = f.find("input[type=password]").length > 0;
    if (isSearch || isLogin) return;
    const fields = f.find("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), select").length;
    if (f.find("textarea").length > 0 || fields >= 2) contactLike++;
  });
  const formHints = /wpcf7|gform_wrapper|elementor-form|wpforms|ninja-forms|nf-form|forminator|fluentform|contact-form/i.test(html);
  const embeddedProviders = matchAll(FORM_HOSTS, resources);

  // Reserva online
  const bookingProviders = matchAll(BOOKING_HOSTS, resources);
  const bookingEvidence: string[] = [];
  $("a, button").each((_, el) => {
    const text = clean($(el).text());
    if (text && text.length <= 50 && BOOKING_TEXT.test(text) && bookingEvidence.length < 4) bookingEvidence.push(text);
  });

  // Contacto
  const bodyText = clean($("body").clone().find("script, style, noscript").remove().end().text()) ?? "";
  const telLinks = hrefs.filter((h) => /^tel:/i.test(h)).length;
  const mailtoLinks = hrefs.filter((h) => /^mailto:/i.test(h)).length;
  const whatsapp = hrefs.some((h) => /(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/)/i.test(h));

  // CTA
  const ctaSamples: string[] = [];
  let ctaCount = 0;
  $("a, button, input[type=submit]").each((_, el) => {
    const text = clean($(el).text() || $(el).attr("value") || $(el).attr("aria-label"));
    if (text && text.length <= 40 && CTA_TEXT.test(text)) {
      ctaCount++;
      if (ctaSamples.length < 5 && !ctaSamples.includes(text)) ctaSamples.push(text);
    }
  });

  // Datos estructurados
  const types = new Set<string>();
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const walk = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          const t = o["@type"];
          if (typeof t === "string") types.add(t);
          else if (Array.isArray(t)) t.filter((x): x is string => typeof x === "string").forEach((x) => types.add(x));
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(JSON.parse($(el).html() ?? ""));
    } catch { /* JSON-LD inválido */ }
  });

  // CMS / tecnología
  const generator = clean($("meta[name=generator]").attr("content"));
  const cms =
    /wp-content|wp-includes/i.test(html) ? "WordPress" :
    /wixstatic\.com|static\.parastorage|wix\.com/i.test(html) ? "Wix" :
    /squarespace/i.test(html) ? "Squarespace" :
    /cdn\.shopify\.com/i.test(html) ? "Shopify" :
    /prestashop/i.test(html) ? "PrestaShop" :
    /joomla/i.test(html) ? "Joomla" :
    /webflow/i.test(html) ? "Webflow" :
    /jimdo/i.test(html) ? "Jimdo" : null;

  // Año de copyright
  const years = [...bodyText.matchAll(/(?:©|copyright|&copy;)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  const copyrightYear = years.length ? Math.max(...years) : null;

  const textLength = bodyText.length;
  const scripts = $("script").length;
  const firstP = $("main p, article p, p").map((_, el) => clean($(el).text())).get().find((t) => t && t.length >= 60);

  return {
    title: clean($("title").first().text()),
    metaDescription: clean($("meta[name=description]").attr("content")),
    lang: clean($("html").attr("lang")),
    viewport: clean($("meta[name=viewport]").attr("content")),
    canonical: clean($("link[rel=canonical]").attr("href")),
    robotsMeta: clean($("meta[name=robots]").attr("content")),
    h1: $("h1").map((_, el) => clean($(el).text())).get().filter((t): t is string => Boolean(t)).slice(0, 5),
    headings: { h1: $("h1").length, h2: $("h2").length, h3: $("h3").length },
    images: { total: $("img").length, withoutAlt: $("img").filter((_, el) => $(el).attr("alt") === undefined).length },
    links: { internal, external },
    hasNav: $("nav").length > 0,
    forms: { total: $("form").length, contactLike: contactLike + (contactLike === 0 && formHints ? 1 : 0), embeddedProviders },
    booking: { providers: bookingProviders, evidence: bookingEvidence },
    contact: { telLinks, mailtoLinks, phoneInText: PHONE_RE.test(bodyText), emailInText: EMAIL_RE.test(bodyText), whatsapp },
    chat: matchAll(CHAT_HOSTS, resources),
    social: matchAll(SOCIAL, hrefs),
    cta: { count: ctaCount, samples: ctaSamples },
    analytics: matchAll(ANALYTICS_HOSTS, resources),
    generator,
    cms,
    structuredDataTypes: [...types],
    openGraph: {
      title: $("meta[property='og:title']").length > 0,
      description: $("meta[property='og:description']").length > 0,
      image: $("meta[property='og:image']").length > 0,
    },
    copyrightYear,
    scripts,
    stylesheets: $("link[rel=stylesheet]").length,
    textLength,
    likelyJsRendered: textLength < 400 && scripts >= 3,
    firstParagraph: firstP ? firstP.slice(0, 280) : null,
  };
}
