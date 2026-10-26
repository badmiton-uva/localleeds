import type { FindingCategory, FindingKind, ServiceKey } from "@/lib/domain";
import type { PageFacts } from "./extract";
import type { PsiResult } from "./pagespeed";
import type { RobotsInfo } from "./robots";

export type FindingDraft = {
  code: string;
  category: FindingCategory;
  kind: FindingKind;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  impact: string | null;
  limitations: string | null;
  serviceKeys: ServiceKey[];
};

export type CheckInput = {
  facts: PageFacts;
  page: { url: string; finalUrl: string; status: number; ttfbMs: number; totalMs: number; bytes: number; truncated: boolean; redirects: string[] };
  robots: RobotsInfo;
  sitemap: { exists: boolean | null; url: string };
  psi: PsiResult | null;
  psiReason?: string;
  sectorKey?: string | null;
  year: number;
};

/** Peso (0-5) de cada hallazgo como señal de oportunidad comercial. Lo usa el scoring. */
export const IMPACT_WEIGHT: Record<string, number> = {
  no_https: 3, no_viewport: 4, noindex: 5, no_title: 3, title_length: 1, no_meta_description: 2, meta_description_length: 1,
  no_h1: 2, no_lang: 1, images_without_alt: 2, slow_response: 2, no_contact_form: 3, no_online_booking: 3, no_contact_info: 4,
  no_chat_or_whatsapp: 1, no_social_links: 1, no_cta: 2, few_internal_links: 1, outdated_copyright: 2, no_structured_data: 2,
  no_sitemap: 1, no_canonical: 1, no_open_graph: 1, phone_only_channel: 2, psi_performance: 3, psi_accessibility: 2, psi_seo: 2,
};

const BOOKING_SECTORS = new Set(["dentistas", "clinicas", "fisioterapia", "veterinarias", "peluquerias", "gimnasios", "restaurantes", "hoteles", "educacion"]);
const JS_NOTE = " El HTML recibido contiene muy poco contenido: la web probablemente se genera con JavaScript y esta comprobación estática puede no verlo.";

export function runChecks(input: CheckInput): FindingDraft[] {
  const { facts, page, robots, sitemap, psi, sectorKey, year } = input;
  const out: FindingDraft[] = [];
  const js = facts.likelyJsRendered;
  const partial = page.truncated ? " La página era muy grande y solo se analizó su primera parte." : "";

  /** Ausencia observada → problema/oportunidad; si el contenido puede ser dinámico, se rebaja a hipótesis. */
  const absence = (d: Omit<FindingDraft, "kind" | "limitations"> & { limitations: string; kind?: "verified_issue" | "opportunity" }): FindingDraft => {
    const kind = d.kind ?? "opportunity";
    return js
      ? { ...d, kind: "hypothesis", confidence: "low", limitations: d.limitations + JS_NOTE }
      : { ...d, kind, limitations: d.limitations + partial };
  };
  const passed = (d: Omit<FindingDraft, "kind" | "impact" | "limitations" | "confidence"> & { confidence?: FindingDraft["confidence"] }): FindingDraft => ({
    ...d, kind: "check_passed", confidence: d.confidence ?? "high", impact: null, limitations: null,
  });

  // --- Experiencia web ---------------------------------------------------
  if (page.finalUrl.startsWith("https://")) {
    out.push(passed({ code: "https", category: "web_experience", title: "La web usa HTTPS", description: "La página se sirve por una conexión cifrada.", evidence: { finalUrl: page.finalUrl }, serviceKeys: [] }));
  } else {
    out.push({
      code: "no_https", category: "web_experience", kind: "verified_issue", title: "La web no usa HTTPS",
      description: "La URL final de la página es http://, sin cifrado.", evidence: { finalUrl: page.finalUrl, redirects: page.redirects },
      confidence: "high", impact: "Los navegadores la marcan como «no segura», lo que resta confianza y puede perjudicar el posicionamiento.",
      limitations: "Se comprobó únicamente la URL registrada para la empresa; podría existir una versión HTTPS no enlazada.", serviceKeys: ["web_design", "seo"],
    });
  }

  if (facts.viewport) {
    out.push(passed({ code: "viewport", category: "web_experience", title: "Declara la etiqueta viewport para móviles", description: "La página incluye <meta name=\"viewport\">, requisito básico de una web adaptable.", evidence: { viewport: facts.viewport }, serviceKeys: [] }));
  } else {
    out.push({
      code: "no_viewport", category: "web_experience", kind: "verified_issue", title: "Falta la etiqueta viewport (adaptación a móvil)",
      description: "El HTML recibido no incluye <meta name=\"viewport\">.", evidence: { htmlBytes: page.bytes },
      confidence: "high", impact: "Sin ella, los móviles suelen mostrar la versión de escritorio reducida, con mala legibilidad.",
      limitations: "Se verifica la presencia de la etiqueta en el HTML, no el aspecto real en un dispositivo.", serviceKeys: ["web_design"],
    });
  }

  if (page.ttfbMs > 2000 || page.totalMs > 5000) {
    out.push({
      code: "slow_response", category: "performance", kind: "verified_issue", title: "Respuesta del servidor lenta",
      description: `El servidor tardó ${page.ttfbMs} ms en empezar a responder y ${page.totalMs} ms en entregar la página.`,
      evidence: { ttfbMs: page.ttfbMs, totalMs: page.totalMs, bytes: page.bytes }, confidence: "medium",
      impact: "Una carga lenta aumenta el abandono, sobre todo en móvil.",
      limitations: "Una única medición desde el servidor de LocalLead; la latencia real de los visitantes puede diferir.", serviceKeys: ["web_design", "seo"],
    });
  } else if (page.ttfbMs <= 800) {
    out.push(passed({ code: "fast_response", category: "performance", title: "Respuesta del servidor rápida", description: `Primer byte en ${page.ttfbMs} ms.`, evidence: { ttfbMs: page.ttfbMs, totalMs: page.totalMs }, confidence: "medium", serviceKeys: [] }));
  }

  if (!facts.lang) {
    out.push({
      code: "no_lang", category: "accessibility", kind: "verified_issue", title: "No se declara el idioma de la página",
      description: "La etiqueta <html> no tiene el atributo lang.", evidence: {}, confidence: "high",
      impact: "Los lectores de pantalla y los buscadores pueden interpretar mal el idioma.", limitations: "Mejora menor de accesibilidad técnica.", serviceKeys: ["web_design"],
    });
  }

  if (facts.images.total >= 3 && facts.images.withoutAlt / facts.images.total > 0.3) {
    out.push({
      code: "images_without_alt", category: "accessibility", kind: "verified_issue", title: "Imágenes sin texto alternativo",
      description: `${facts.images.withoutAlt} de ${facts.images.total} imágenes no tienen atributo alt.`, evidence: { ...facts.images },
      confidence: "high", impact: "Reduce la accesibilidad y el aprovechamiento SEO de las imágenes.",
      limitations: "Cuenta imágenes del HTML inicial; las cargadas dinámicamente no se evalúan.", serviceKeys: ["web_design", "seo"],
    });
  }

  if (facts.links.internal < 4 && !facts.hasNav && !js) {
    out.push(absence({
      code: "few_internal_links", category: "web_experience", kind: "opportunity", title: "Navegación mínima",
      description: `La página principal enlaza solo ${facts.links.internal} páginas internas y no usa un bloque <nav>.`,
      evidence: { internalLinks: facts.links.internal, hasNav: facts.hasNav }, confidence: "low",
      impact: "Puede indicar una web de una sola página con poca información accesible.", limitations: "Solo se analizó la página principal.", serviceKeys: ["web_design"],
    }));
  }

  if (facts.cta.count === 0) {
    out.push(absence({
      code: "no_cta", category: "web_experience", title: "No se detectan llamadas a la acción claras",
      description: "No hay botones ni enlaces con textos de acción habituales (contactar, reservar, pedir cita, solicitar presupuesto…).",
      evidence: { ctaCount: 0 }, confidence: "low", impact: "Sin una acción clara, los visitantes interesados no saben cómo dar el siguiente paso.",
      limitations: "Detección por palabras clave en español; llamadas a la acción con otros textos o imágenes no se reconocen.", serviceKeys: ["web_design", "lead_capture_improvement"],
    }));
  } else {
    out.push(passed({ code: "cta", category: "web_experience", title: "Hay llamadas a la acción", description: `Se detectan ${facts.cta.count} elementos de acción.`, evidence: { samples: facts.cta.samples }, confidence: "medium", serviceKeys: [] }));
  }

  // --- SEO técnico -------------------------------------------------------
  if (/noindex/i.test(facts.robotsMeta ?? "")) {
    out.push({
      code: "noindex", category: "seo", kind: "verified_issue", title: "La página pide a Google que no la indexe",
      description: "Incluye <meta name=\"robots\"> con noindex.", evidence: { robotsMeta: facts.robotsMeta }, confidence: "high",
      impact: "La página principal no aparecería en los resultados de búsqueda.", limitations: "Puede ser intencionado en webs en construcción.", serviceKeys: ["seo", "web_design"],
    });
  }

  if (!facts.title) {
    out.push({ code: "no_title", category: "seo", kind: "verified_issue", title: "La página no tiene título (<title>)", description: "No se encontró el elemento <title>.", evidence: {}, confidence: "high", impact: "El título es clave para el posicionamiento y para cómo se muestra el resultado en Google.", limitations: partial || null, serviceKeys: ["seo"] });
  } else if (facts.title.length < 15 || facts.title.length > 65) {
    out.push({ code: "title_length", category: "seo", kind: "opportunity", title: "Título de página fuera de la longitud recomendada", description: `El título tiene ${facts.title.length} caracteres (recomendado: unos 15–65).`, evidence: { title: facts.title, length: facts.title.length }, confidence: "medium", impact: "Un título demasiado corto o largo desaprovecha o trunca el espacio en los resultados de búsqueda.", limitations: "La longitud ideal es orientativa.", serviceKeys: ["seo"] });
  } else {
    out.push(passed({ code: "title_ok", category: "seo", title: "Título de página adecuado", description: `«${facts.title}» (${facts.title.length} caracteres).`, evidence: { title: facts.title }, serviceKeys: [] }));
  }

  if (!facts.metaDescription) {
    out.push({ code: "no_meta_description", category: "seo", kind: "verified_issue", title: "Falta la metadescripción", description: "No se encontró <meta name=\"description\">.", evidence: {}, confidence: "high", impact: "Google generará el extracto por su cuenta, con menos control sobre el mensaje.", limitations: partial || null, serviceKeys: ["seo"] });
  } else if (facts.metaDescription.length < 70 || facts.metaDescription.length > 170) {
    out.push({ code: "meta_description_length", category: "seo", kind: "opportunity", title: "Metadescripción fuera de la longitud recomendada", description: `Tiene ${facts.metaDescription.length} caracteres (recomendado: unos 70–160).`, evidence: { length: facts.metaDescription.length }, confidence: "medium", impact: "Puede quedar truncada o desaprovechar espacio de captación.", limitations: "La longitud ideal es orientativa.", serviceKeys: ["seo"] });
  }

  if (facts.h1.length === 0) {
    out.push(absence({ code: "no_h1", category: "seo", kind: "verified_issue", title: "La página no tiene encabezado principal (H1)", description: "No hay ningún elemento <h1>.", evidence: { headings: facts.headings }, confidence: "high", impact: "Debilita la estructura del contenido para buscadores y lectores de pantalla.", limitations: "", serviceKeys: ["seo", "web_design"] }));
  }

  if (!facts.canonical && !js) {
    out.push(absence({ code: "no_canonical", category: "seo", title: "No declara URL canónica", description: "No hay <link rel=\"canonical\">.", evidence: {}, confidence: "medium", impact: "Facilita contenido duplicado entre variantes de la URL.", limitations: "Mejora técnica menor.", serviceKeys: ["seo"] }));
  }

  if (!(facts.openGraph.title && facts.openGraph.image) && !js) {
    out.push(absence({ code: "no_open_graph", category: "seo", title: "Sin etiquetas Open Graph completas", description: "Faltan og:title u og:image, que controlan cómo se ve la web al compartirla.", evidence: { ...facts.openGraph }, confidence: "high", impact: "Al compartir el enlace en redes o WhatsApp se muestra sin imagen ni título cuidados.", limitations: "Mejora menor.", serviceKeys: ["digital_marketing", "seo"] }));
  }

  const localTypes = facts.structuredDataTypes.filter((t) => /LocalBusiness|Organization|Dentist|Physician|MedicalBusiness|MedicalClinic|Restaurant|Store|Hotel|LodgingBusiness|HealthAndBeautyBusiness|ProfessionalService|AutoRepair|LegalService|VeterinaryCare|SportsActivityLocation|HairSalon|BeautySalon/i.test(t));
  if (localTypes.length === 0) {
    out.push(absence({ code: "no_structured_data", category: "seo", title: "Sin datos estructurados de negocio local", description: "No se detectan marcados schema.org (JSON-LD) de empresa u organización.", evidence: { typesFound: facts.structuredDataTypes }, confidence: "medium", impact: "Los datos estructurados ayudan a Google a mostrar horarios, valoraciones y contacto en los resultados.", limitations: "Solo se detecta JSON-LD; el marcado en microdatos no se evalúa.", serviceKeys: ["seo"] }));
  } else {
    out.push(passed({ code: "structured_data", category: "seo", title: "Incluye datos estructurados de negocio", description: `Tipos detectados: ${localTypes.join(", ")}.`, evidence: { types: localTypes }, serviceKeys: [] }));
  }

  const hasSitemap = sitemap.exists === true || robots.sitemaps.length > 0;
  if (sitemap.exists === false && robots.sitemaps.length === 0) {
    out.push({ code: "no_sitemap", category: "seo", kind: "opportunity", title: "No se encuentra un sitemap", description: `${sitemap.url} no existe y robots.txt no declara ningún sitemap.`, evidence: { checked: sitemap.url, robotsState: robots.state }, confidence: "medium", impact: "Un sitemap ayuda a que los buscadores descubran todas las páginas.", limitations: "Podría estar publicado en otra ruta no estándar.", serviceKeys: ["seo"] });
  } else if (hasSitemap) {
    out.push(passed({ code: "sitemap", category: "seo", title: "Publica un sitemap", description: robots.sitemaps[0] ?? sitemap.url, evidence: { sitemaps: robots.sitemaps, url: sitemap.url }, confidence: "medium", serviceKeys: [] }));
  }

  // --- Captación comercial ----------------------------------------------
  const hasForm = facts.forms.contactLike > 0 || facts.forms.embeddedProviders.length > 0;
  if (hasForm) {
    out.push(passed({ code: "contact_form", category: "lead_capture", title: "Dispone de formulario de contacto", description: facts.forms.embeddedProviders.length ? `Formulario incrustado (${facts.forms.embeddedProviders.join(", ")}).` : "Se detecta un formulario de contacto en la página principal.", evidence: { contactForms: facts.forms.contactLike, providers: facts.forms.embeddedProviders }, confidence: "medium", serviceKeys: [] }));
  } else {
    out.push(absence({ code: "no_contact_form", category: "lead_capture", title: "No se detecta formulario de contacto en la página principal", description: "No hay formularios de contacto ni formularios incrustados (HubSpot, Typeform, Google Forms…) en la página analizada.", evidence: { forms: facts.forms.total }, confidence: "medium", impact: "Sin formulario, quien no quiere llamar no tiene una vía sencilla de contacto, y las solicitudes no se centralizan.", limitations: "Solo se analizó la página principal; podría existir un formulario en otra página (p. ej. /contacto).", serviceKeys: ["forms", "lead_capture_improvement", "crm_integration"] }));
  }

  const bookingRelevant = BOOKING_SECTORS.has(sectorKey ?? "");
  const hasBooking = facts.booking.providers.length > 0 || facts.booking.evidence.length > 0;
  if (hasBooking) {
    out.push(passed({ code: "online_booking", category: "lead_capture", title: "Ofrece reserva o cita desde la web", description: facts.booking.providers.length ? `Sistema detectado: ${facts.booking.providers.join(", ")}.` : `Enlaces/botones: ${facts.booking.evidence.join(" · ")}.`, evidence: { ...facts.booking }, confidence: "medium", serviceKeys: [] }));
  } else if (bookingRelevant) {
    out.push(absence({ code: "no_online_booking", category: "lead_capture", title: "No se detecta reserva o cita online", description: "No hay enlaces, botones ni sistemas conocidos de reserva/cita online en la página principal.", evidence: { ...facts.booking }, confidence: "medium", impact: "En este tipo de negocio, la reserva online reduce llamadas y fricción, y permite captar fuera de horario.", limitations: "Solo se analizó la página principal; la reserva podría gestionarse por teléfono o en otra página.", serviceKeys: ["booking_systems", "lead_capture_improvement", "admin_automation"] }));
  }

  const visiblePhone = facts.contact.telLinks > 0 || facts.contact.phoneInText;
  const visibleEmail = facts.contact.mailtoLinks > 0 || facts.contact.emailInText;
  if (!visiblePhone && !visibleEmail && !facts.contact.whatsapp && !hasForm) {
    out.push(absence({ code: "no_contact_info", category: "contact_info", kind: "verified_issue", title: "No se localiza información de contacto en la página principal", description: "No se detectan teléfono, email, WhatsApp ni formulario en el HTML de la página principal.", evidence: { telLinks: facts.contact.telLinks, mailtoLinks: facts.contact.mailtoLinks }, confidence: "medium", impact: "Quien quiera contactar tendrá que buscar el dato en otra parte.", limitations: "Solo se analizó la página principal.", serviceKeys: ["web_design", "lead_capture_improvement"] }));
  } else {
    out.push(passed({ code: "contact_info", category: "contact_info", title: "Información de contacto visible", description: [visiblePhone && "teléfono", visibleEmail && "email", facts.contact.whatsapp && "WhatsApp"].filter(Boolean).join(", ") + " detectado(s) en la página principal.", evidence: { phone: visiblePhone, email: visibleEmail, whatsapp: facts.contact.whatsapp }, confidence: "medium", serviceKeys: [] }));
  }

  if (!facts.contact.whatsapp && facts.chat.length === 0) {
    out.push(absence({ code: "no_chat_or_whatsapp", category: "lead_capture", title: "Sin chat ni WhatsApp en la web", description: "No se detectan widgets de chat ni enlaces de WhatsApp.", evidence: {}, confidence: "medium", impact: "Un canal de mensajería inmediato suele aumentar las consultas.", limitations: "Los widgets cargados tras el consentimiento de cookies pueden no aparecer en el HTML inicial.", serviceKeys: ["conversational_assistants", "request_classification"] }));
  } else {
    out.push(passed({ code: "chat_or_whatsapp", category: "lead_capture", title: "Ofrece un canal de mensajería", description: [facts.contact.whatsapp && "Enlace a WhatsApp", ...facts.chat].filter(Boolean).join(", "), evidence: { whatsapp: facts.contact.whatsapp, chat: facts.chat }, confidence: "medium", serviceKeys: [] }));
  }

  if (facts.social.length === 0) {
    out.push(absence({ code: "no_social_links", category: "web_experience", title: "No enlaza a redes sociales", description: "La página principal no enlaza a perfiles de Facebook, Instagram, LinkedIn, X, YouTube o TikTok.", evidence: {}, confidence: "medium", impact: "Puede indicar poca presencia o poca integración de las redes con la web.", limitations: "El negocio puede tener perfiles que la web no enlaza.", serviceKeys: ["digital_marketing"] }));
  }

  // --- Automatización y marketing ---------------------------------------
  if (visiblePhone && !hasForm && !hasBooking && facts.chat.length === 0 && !facts.contact.whatsapp && !js) {
    out.push({ code: "phone_only_channel", category: "automation", kind: "opportunity", title: "El teléfono parece el único canal de contacto visible", description: "Se muestra un teléfono, pero no formulario, reserva, chat ni WhatsApp.", evidence: { phone: true }, confidence: "medium", impact: "Todas las solicitudes dependen de la atención telefónica, lo que limita la capacidad de respuesta y la trazabilidad.", limitations: "Solo se analizó la página principal; no se conoce cómo gestiona el negocio sus consultas internamente.", serviceKeys: ["request_classification", "admin_automation", "conversational_assistants", "forms"] });
  }

  if (facts.analytics.length === 0) {
    out.push({ code: "no_analytics", category: "automation", kind: "hypothesis", title: "No se detecta analítica web", description: "No hay scripts conocidos de Google Analytics, Tag Manager, Meta Pixel u otros en el HTML inicial.", evidence: {}, confidence: "low", impact: "Si no se mide, es difícil saber qué canales aportan clientes.", limitations: "La analítica puede cargarse tras aceptar cookies o por una vía no detectable. Debe confirmarse con el negocio.", serviceKeys: ["digital_marketing", "market_research"] });
  } else {
    out.push(passed({ code: "analytics", category: "automation", title: "Usa herramientas de analítica", description: facts.analytics.join(", "), evidence: { tools: facts.analytics }, confidence: "medium", serviceKeys: [] }));
  }

  if (facts.copyrightYear && facts.copyrightYear <= year - 3) {
    out.push({ code: "outdated_copyright", category: "web_experience", kind: "opportunity", title: "El pie de página indica un año antiguo", description: `El aviso de copyright muestra ${facts.copyrightYear}.`, evidence: { copyrightYear: facts.copyrightYear }, confidence: "low", impact: "Puede reflejar una web sin mantenimiento reciente.", limitations: "Muchas webs mantienen un año fijo aunque se actualicen; es solo un indicio.", serviceKeys: ["web_design"] });
  }

  out.push({
    code: "value_proposition", category: "web_experience", kind: "hypothesis", title: "Claridad de la propuesta de valor: revisión humana",
    description: facts.h1[0] ? `El titular principal es «${facts.h1[0]}». Que comunique con claridad qué ofrece el negocio debe valorarlo una persona.` : "No hay titular principal que evaluar. La claridad de la propuesta de valor debe valorarla una persona.",
    evidence: { h1: facts.h1, firstParagraph: facts.firstParagraph }, confidence: "low", impact: null,
    limitations: "La calidad del mensaje comercial no puede medirse automáticamente.", serviceKeys: ["digital_marketing"],
  });

  out.push({
    code: "internal_processes", category: "automation", kind: "unavailable", title: "Procesos internos no observables",
    description: "No es posible saber desde el exterior si el negocio usa CRM, respuestas automáticas, facturación u otros sistemas internos. Conviene preguntarlo en una primera conversación.",
    evidence: {}, confidence: "high", impact: null, limitations: "Información que solo el propio negocio puede confirmar.", serviceKeys: ["sales_automation", "crm_integration", "admin_automation"],
  });

  // --- Lighthouse (PageSpeed Insights) ------------------------------------
  if (psi) {
    const s = psi.scores;
    const lh = (score: number | null, code: string, category: FindingCategory, label: string, services: ServiceKey[], failing: { id: string; title: string }[] = []) => {
      if (score === null) return;
      const evidence = { score, strategy: "móvil", lighthouse: psi.lighthouseVersion, metrics: code === "psi_performance" ? psi.metrics : undefined, failingAudits: failing };
      if (score >= 90) out.push(passed({ code: `${code}_ok`, category, title: `Lighthouse (${label}): ${score}/100`, description: "Resultado bueno en la medición de Lighthouse en móvil.", evidence, serviceKeys: [] }));
      else out.push({ code, category, kind: score < 50 ? "verified_issue" : "opportunity", title: `Lighthouse (${label}): ${score}/100`, description: `Lighthouse puntúa ${label.toLowerCase()} con ${score}/100 en la emulación móvil.${failing.length ? ` Principales fallos: ${failing.map((f) => f.title).join("; ")}.` : ""}`, evidence, confidence: "high", impact: label === "Rendimiento" ? "Una web lenta en móvil pierde visitantes antes de mostrar contenido." : null, limitations: "Medición de laboratorio (Google PageSpeed Insights, móvil, red simulada); no refleja datos reales de usuarios.", serviceKeys: services });
    };
    lh(s.performance, "psi_performance", "performance", "Rendimiento", ["web_design", "seo"]);
    lh(s.accessibility, "psi_accessibility", "accessibility", "Accesibilidad", ["web_design"], psi.failing.accessibility);
    lh(s.seo, "psi_seo", "seo", "SEO", ["seo"], psi.failing.seo);
  } else {
    out.push({
      code: "psi_unavailable", category: "performance", kind: "unavailable", title: "Medición Lighthouse no disponible",
      description: input.psiReason === "no_key" ? "No se ejecutó Lighthouse porque no hay clave de PageSpeed Insights configurada." : "La medición de Lighthouse (PageSpeed Insights) no pudo completarse esta vez.",
      evidence: { reason: input.psiReason ?? "unavailable" }, confidence: "high", impact: null, limitations: "La velocidad solo se estima con el tiempo de respuesta del servidor.", serviceKeys: [],
    });
  }

  return out;
}
