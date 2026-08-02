const { OpenAI } = require("openai");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");
const Post = require("../models/Post");
const User = require("../models/User");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");

const openAiClient = String(process.env.OPENAI_API_KEY || "").trim()
  ? new OpenAI({ apiKey: String(process.env.OPENAI_API_KEY || "").trim() })
  : null;

const GLOBAL_POST_TOPICS = [
  // Car-first pool (~20 of every 21 picks)
  { key: "supercars", label: "Supercars", query: "Ferrari Lamborghini McLaren supercar launch", pool: "cars" },
  { key: "ferrari", label: "Ferrari", query: "Ferrari new model launch supercar", pool: "cars" },
  { key: "lamborghini", label: "Lamborghini", query: "Lamborghini new model supercar", pool: "cars" },
  { key: "porsche", label: "Porsche", query: "Porsche 911 Cayenne new model", pool: "cars" },
  { key: "mercedes", label: "Mercedes-Benz", query: "Mercedes-AMG Mercedes-Benz luxury car launch", pool: "cars" },
  { key: "toyota_luxury", label: "Toyota / Lexus", query: "Toyota Lexus luxury SUV Land Cruiser new model", pool: "cars" },
  { key: "luxury_cars", label: "Autos de lujo", query: "Bentley Rolls-Royce Bentley luxury car", pool: "cars" },
  { key: "hypercars", label: "Hypercars", query: "Bugatti Koenigsegg Pagani hypercar", pool: "cars" },
  { key: "celebrity_cars", label: "Celebridades y autos", query: "celebrity buys luxury car Ferrari Lamborghini", pool: "cars" },
  { key: "bmw_audi", label: "BMW / Audi", query: "BMW M Audi RS luxury performance car", pool: "cars" },
  { key: "classic_cars", label: "Clásicos", query: "classic car auction Ferrari Porsche collector automobile -game -gta", pool: "cars" },
  { key: "motorsport", label: "Motorsport", query: "Formula 1 race car Le Mans GT racing", pool: "cars" },
  { key: "ev_luxury", label: "Eléctricos de lujo", query: "Porsche Taycan Lucid Rivian luxury electric car", pool: "cars" },
  { key: "private_jets", label: "Jets privados", query: "private jet luxury aviation Gulfstream", pool: "cars" },
  // Nautical pool (~1 of every 21 picks)
  { key: "yachts", label: "Yates", query: "luxury yacht megayacht launch", pool: "nautical" },
  { key: "sport_boats", label: "Lanchas deportivas", query: "sport yacht powerboat luxury boat", pool: "nautical" },
  { key: "marine_lifestyle", label: "Estilo náutico", query: "superyacht marina luxury yacht lifestyle", pool: "nautical" },
];

const DAILY_REGENERATE_LIMIT = Math.max(1, Number(process.env.POSTS_REGENERATE_DAILY_LIMIT || 2));
const AdminQuota = require("../models/AdminQuota");

function normalizeText(value) {
  return String(value || "").trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(block || "").match(regex);
  return decodeXmlEntities(match?.[1] || "");
}

function extractAttribute(block, tagName, attributeName) {
  const regex = new RegExp(`<${tagName}[^>]*${attributeName}=["']([^"']+)["'][^>]*/?>`, "i");
  const match = String(block || "").match(regex);
  return normalizeText(match?.[1] || "");
}

function buildGoogleNewsRssUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: "es-419",
    gl: "CO",
    ceid: "CO:es",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function getBogotaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function resolveSlotKey(date = new Date()) {
  const { dateKey, hour, minute } = getBogotaParts(date);
  if (hour === 16 && minute <= 14) {
    return `${dateKey}-16`;
  }
  return "";
}

function pickTopic(slotKey = "") {
  const hash = String(slotKey || Date.now())
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  // 20 car picks : 1 nautical pick
  const carTopics = GLOBAL_POST_TOPICS.filter((topic) => topic.pool !== "nautical");
  const nauticalTopics = GLOBAL_POST_TOPICS.filter((topic) => topic.pool === "nautical");
  const useNautical = hash % 21 === 0;
  const pool = useNautical && nauticalTopics.length ? nauticalTopics : carTopics;
  return pool[hash % pool.length];
}

async function fetchRssItems(topic) {
  const response = await fetch(buildGoogleNewsRssUrl(topic.query), {
    headers: {
      "User-Agent": "GlobalImportsPostsBot/1.0",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo consultar noticias (${response.status}).`);
  }

  const xml = await response.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match = itemRegex.exec(xml);

  while (match && items.length < 12) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const source = extractTag(block, "source");
    const description = extractTag(block, "description");
    const imageUrl =
      extractAttribute(block, "enclosure", "url") || extractAttribute(block, "media:content", "url") || "";

    if (title && link) {
      items.push({
        title,
        url: link,
        publisher: source,
        description,
        imageUrl,
        topic: topic.label,
        topicKey: topic.key,
      });
    }

    match = itemRegex.exec(xml);
  }

  return items;
}

async function findUnusedStory(topic, { excludeUrls = [] } = {}) {
  const excluded = new Set((excludeUrls || []).map((url) => String(url || "").trim()).filter(Boolean));
  const items = await fetchRssItems(topic);

  for (const item of items) {
    if (excluded.has(item.url)) {
      continue;
    }

    const exists = await Post.findOne({ "source.url": item.url }).select("_id").lean();
    if (!exists) {
      return item;
    }
  }

  return null;
}

function cleanFallbackTitle(title) {
  return normalizeText(title)
    .replace(/\s+[-–|]\s+[^-–|]{2,40}$/u, "")
    .slice(0, 110);
}

async function generateCopyWithOpenAi(story) {
  if (!openAiClient) {
    const cleanTitle = cleanFallbackTitle(story.title);
    return {
      title: cleanTitle,
      body: story.description
        ? `${story.description.slice(0, 420)}${story.description.length > 420 ? "…" : ""}`
        : `Una historia del mundo ${story.topic.toLowerCase()} que vale la pena mirar. En Global Imports te traemos lo más entretenido del lujo sobre ruedas, agua y cielo.`,
      model: "fallback",
    };
  }

  const prompt = [
    "Eres el editor de contenido de Global Imports, marca premium de importación de vehículos de lujo en Colombia.",
    "A partir de la noticia fuente, genera un título y un texto corto en español, con tono elegante, entretenido y aspiracional.",
    "Prioriza siempre autos, supercars y marcas premium (Ferrari, Lamborghini, Porsche, Mercedes, Toyota/Lexus, BMW, etc.).",
    "Si la noticia no es de autos, reencuadra el ángulo hacia el mundo automotriz de lujo cuando sea razonable.",
    "No inventes datos. No uses clickbait exagerado. No suenes como publicidad agresiva.",
    "Devuelve SOLO JSON válido con esta forma: {\"title\":\"...\",\"body\":\"...\"}",
    `Tema: ${story.topic}`,
    `Título fuente: ${story.title}`,
    `Resumen fuente: ${story.description || "(sin resumen)"}`,
    `Medio: ${story.publisher || "(desconocido)"}`,
    "El título debe salir completo (sin puntos suspensivos), idealmente entre 45 y 78 caracteres, máximo 90.",
    "El body debe tener entre 280 y 520 caracteres, 1 o 2 párrafos cortos, y también completo (sin cortar con …).",
  ].join("\n");

  const response = await openAiClient.responses.create({
    model: String(process.env.OPENAI_MODEL || "gpt-5-mini").trim(),
    input: prompt,
  });

  const raw = normalizeText(response?.output_text || "");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error("OpenAI no devolvió JSON válido para el borrador.");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const title = normalizeText(parsed.title)
    .replace(/\u2026/g, "")
    .replace(/\.{2,}$/g, "")
    .trim()
    .slice(0, 120);
  const body = normalizeText(parsed.body)
    .replace(/\u2026\s*$/g, "")
    .replace(/\.{2,}\s*$/g, "")
    .trim()
    .slice(0, 1200);

  if (!title || !body) {
    throw new Error("OpenAI devolvió título o texto vacío.");
  }

  return {
    title,
    body,
    model: String(process.env.OPENAI_MODEL || "gpt-5-mini").trim(),
  };
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWordsToLines(title, maxChars = 28) {
  const words = normalizeText(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [normalizeText(title) || "Global Imports"];
}

function fitTitleForImage(title) {
  const attempts = [
    { maxChars: 28, maxLines: 4, fontSize: 48, lineHeight: 58 },
    { maxChars: 32, maxLines: 5, fontSize: 42, lineHeight: 52 },
    { maxChars: 36, maxLines: 6, fontSize: 36, lineHeight: 46 },
    { maxChars: 40, maxLines: 7, fontSize: 32, lineHeight: 40 },
    { maxChars: 44, maxLines: 8, fontSize: 28, lineHeight: 36 },
  ];

  for (const attempt of attempts) {
    const lines = wrapWordsToLines(title, attempt.maxChars);
    if (lines.length <= attempt.maxLines) {
      return { lines, fontSize: attempt.fontSize, lineHeight: attempt.lineHeight };
    }
  }

  const fallback = attempts[attempts.length - 1];
  return {
    lines: wrapWordsToLines(title, fallback.maxChars),
    fontSize: fallback.fontSize,
    lineHeight: fallback.lineHeight,
  };
}

function pickImageLayout(seed = "") {
  const layouts = ["leftClassic", "bottomHero", "rightEditorial", "topBanner", "lowerLeftWide"];
  const hash = String(seed || Date.now())
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return layouts[hash % layouts.length];
}

function pickImageTagline(topic = "", seed = "") {
  const carLines = [
    "Lujo sobre ruedas",
    "Autos que marcan época",
    "Prestigio en movimiento",
    "El arte de conducir",
    "Exclusividad al volante",
  ];
  const nauticalLines = [
    "Horizonte de lujo",
    "Estilo sobre el agua",
    "Náutica de élite",
  ];
  const topicText = String(topic || "").toLowerCase();
  const pool =
    topicText.includes("yate") || topicText.includes("lancha") || topicText.includes("náut")
      ? nauticalLines
      : carLines;
  const hash = String(seed || topic || Date.now())
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return pool[hash % pool.length];
}

function buildOverlayLayout({
  width,
  height,
  title,
  topic,
  layout,
  tagline,
}) {
  const fitted = fitTitleForImage(title);
  const topicLabel = escapeXml(String(topic || "Lifestyle").toUpperCase());
  const safeTagline = escapeXml(tagline);
  const titleBlock = fitted.lines
    .map((line, index) => {
      const y =
        layout === "topBanner"
          ? 168 + index * fitted.lineHeight
          : layout === "bottomHero"
            ? height - 210 - (fitted.lines.length - 1 - index) * fitted.lineHeight
            : layout === "rightEditorial"
              ? 250 + index * fitted.lineHeight
              : layout === "lowerLeftWide"
                ? 320 + index * fitted.lineHeight
                : 230 + index * fitted.lineHeight;
      const x = layout === "rightEditorial" ? 560 : 64;
      return `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${fitted.fontSize}" font-weight="700" fill="#FFF8EA">${escapeXml(line)}</text>`;
    })
    .join("");

  if (layout === "bottomHero") {
    const accentY = height - 150;
    return {
      logo: { top: 36, left: 1080 },
      svg: `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bottomHero" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
              <stop offset="45%" stop-color="rgba(8,6,4,0.25)"/>
              <stop offset="100%" stop-color="rgba(8,6,4,0.88)"/>
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#bottomHero)"/>
          <rect x="64" y="54" width="236" height="34" rx="17" fill="rgba(216,170,82,0.95)"/>
          <text x="182" y="77" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
          <text x="64" y="${accentY - fitted.lines.length * fitted.lineHeight - 28}" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${topicLabel}</text>
          ${titleBlock}
          <rect x="64" y="${accentY}" width="72" height="4" rx="2" fill="#D8AA52"/>
          <text x="64" y="${accentY + 42}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">${safeTagline}</text>
        </svg>
      `,
    };
  }

  if (layout === "rightEditorial") {
    return {
      logo: { top: 560, left: 64 },
      svg: `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rightShade" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stop-color="rgba(8,6,4,0.86)"/>
              <stop offset="55%" stop-color="rgba(8,6,4,0.42)"/>
              <stop offset="100%" stop-color="rgba(8,6,4,0.05)"/>
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#rightShade)"/>
          <rect x="900" y="54" width="236" height="34" rx="17" fill="rgba(216,170,82,0.95)"/>
          <text x="1018" y="77" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
          <text x="560" y="170" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${topicLabel}</text>
          ${titleBlock}
          <rect x="560" y="520" width="64" height="4" rx="2" fill="#D8AA52"/>
          <text x="560" y="568" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">${safeTagline}</text>
        </svg>
      `,
    };
  }

  if (layout === "topBanner") {
    return {
      logo: { top: 560, left: 1080 },
      svg: `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(8,6,4,0.88)"/>
              <stop offset="55%" stop-color="rgba(8,6,4,0.35)"/>
              <stop offset="100%" stop-color="rgba(8,6,4,0.08)"/>
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#topShade)"/>
          <rect x="64" y="42" width="236" height="34" rx="17" fill="rgba(216,170,82,0.95)"/>
          <text x="182" y="65" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
          <text x="64" y="118" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${topicLabel}</text>
          ${titleBlock}
          <rect x="64" y="${168 + fitted.lines.length * fitted.lineHeight + 18}" width="64" height="4" rx="2" fill="#D8AA52"/>
          <text x="64" y="${168 + fitted.lines.length * fitted.lineHeight + 58}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">${safeTagline}</text>
        </svg>
      `,
    };
  }

  if (layout === "lowerLeftWide") {
    return {
      logo: { top: 48, left: 1080 },
      svg: `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="wideShade" x1="0" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stop-color="rgba(8,6,4,0.2)"/>
              <stop offset="40%" stop-color="rgba(8,6,4,0.55)"/>
              <stop offset="100%" stop-color="rgba(8,6,4,0.86)"/>
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#wideShade)"/>
          <rect x="64" y="54" width="236" height="34" rx="17" fill="rgba(216,170,82,0.95)"/>
          <text x="182" y="77" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
          <text x="64" y="270" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${topicLabel}</text>
          ${titleBlock}
          <rect x="64" y="560" width="88" height="4" rx="2" fill="#D8AA52"/>
          <text x="64" y="608" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">${safeTagline}</text>
        </svg>
      `,
    };
  }

  // leftClassic (default)
  return {
    logo: { top: 560, left: 1080 },
    svg: `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="rgba(8,6,4,0.82)"/>
            <stop offset="42%" stop-color="rgba(8,6,4,0.48)"/>
            <stop offset="100%" stop-color="rgba(8,6,4,0.08)"/>
          </linearGradient>
          <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#shade)"/>
        <rect width="${width}" height="${height}" fill="url(#bottom)"/>
        <rect x="64" y="54" width="236" height="34" rx="17" fill="rgba(216,170,82,0.95)"/>
        <text x="182" y="77" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
        <text x="64" y="150" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${topicLabel}</text>
        ${titleBlock}
        <rect x="64" y="${230 + fitted.lines.length * fitted.lineHeight + 24}" width="64" height="4" rx="2" fill="#D8AA52"/>
        <text x="64" y="${230 + fitted.lines.length * fitted.lineHeight + 68}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">${safeTagline}</text>
      </svg>
    `,
  };
}

async function loadBrandLogoBuffer() {
  const candidates = [
    path.resolve(process.cwd(), "public/logoblancoleon.png"),
    path.resolve(process.cwd(), "host/logoblancoleon.png"),
    path.resolve(__dirname, "../../public/logoblancoleon.png"),
    path.resolve(__dirname, "../../host/logoblancoleon.png"),
  ];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // try next
    }
  }

  return null;
}

async function downloadImageBuffer(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "GlobalImportsPostsBot/1.0" },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.startsWith("image/")) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

function buildImagePrompt({ title, topic }) {
  const topicHints = {
    Supercars: "exotic supercar on a coastal highway at golden hour",
    Ferrari: "red Ferrari supercar on a winding coastal road at sunset",
    Lamborghini: "Lamborghini supercar with sharp angles under dramatic studio light",
    Porsche: "Porsche 911 on an alpine road at dusk",
    "Mercedes-Benz": "Mercedes-AMG luxury performance car in a modern city night",
    "Toyota / Lexus": "Lexus luxury SUV on a scenic mountain overlook",
    "Autos de lujo": "luxury sedan in a modern showroom with dramatic lighting",
    Hypercars: "hypercar on an empty mountain road at dusk",
    "Celebridades y autos": "celebrity stepping toward a luxury supercar outside a premium venue",
    "BMW / Audi": "BMW M performance coupe on a wet city street at night",
    Yates: "luxury megayacht on calm Mediterranean water at sunset",
    "Lanchas deportivas": "sport yacht cutting through turquoise water",
    "Jets privados": "private jet on a premium airport tarmac at blue hour",
    Clásicos: "classic collector car in a refined garage",
    Motorsport: "motorsport race car on track with motion and sparks",
    "Eléctricos de lujo": "sleek luxury electric car in a futuristic city night",
    "Estilo náutico": "luxury marina with yachts and warm evening lights",
  };

  const scene = topicHints[topic] || "luxury supercar editorial scene, premium automotive photography";

  return [
    "Photorealistic editorial photograph for a luxury brand magazine cover.",
    `Subject: ${scene}.`,
    `Inspired by: ${title}.`,
    "Cinematic lighting, rich contrast, premium atmosphere, shallow depth of field.",
    "No text, no logos, no watermarks, no people faces close-up.",
    "Horizontal 16:9 composition with dark left side suitable for text overlay.",
  ].join(" ");
}

async function generateBackgroundWithOpenAi({ title, topic }) {
  if (!openAiClient) {
    return null;
  }

  const model = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
  const prompt = buildImagePrompt({ title, topic });

  try {
    const response = await openAiClient.images.generate({
      model,
      prompt,
      size: model.includes("dall-e-3") ? "1792x1024" : "1536x1024",
      quality: model.includes("dall-e-3") ? "standard" : "high",
      n: 1,
    });

    const first = response?.data?.[0];
    if (first?.b64_json) {
      return Buffer.from(first.b64_json, "base64");
    }

    if (first?.url) {
      return downloadImageBuffer(first.url);
    }
  } catch (error) {
    console.warn("[POSTS_AUTO] OpenAI image generation failed:", error.message || error);

    if (model !== "dall-e-3") {
      try {
        const fallback = await openAiClient.images.generate({
          model: "dall-e-3",
          prompt,
          size: "1792x1024",
          quality: "standard",
          n: 1,
        });
        const first = fallback?.data?.[0];
        if (first?.b64_json) {
          return Buffer.from(first.b64_json, "base64");
        }
        if (first?.url) {
          return downloadImageBuffer(first.url);
        }
      } catch (fallbackError) {
        console.warn("[POSTS_AUTO] DALL-E fallback failed:", fallbackError.message || fallbackError);
      }
    }
  }

  return null;
}

async function scrapeOpenGraphImage(articleUrl = "") {
  if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) {
    return null;
  }

  try {
    const response = await fetch(articleUrl, {
      headers: {
        "User-Agent": "GlobalImportsPostsBot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const patterns = [
      /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      const imageUrl = normalizeText(match?.[1] || "");
      if (imageUrl.startsWith("http")) {
        return downloadImageBuffer(imageUrl);
      }
    }
  } catch {
    // ignore scrape failures
  }

  return null;
}

const TOPIC_STOCK_IMAGES = {
  Supercars:
    "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1600&q=80",
  Ferrari:
    "https://images.unsplash.com/photo-1583121274602-3e282f39af0f?auto=format&fit=crop&w=1600&q=80",
  Lamborghini:
    "https://images.unsplash.com/photo-1544829099-b9a0c5303aef?auto=format&fit=crop&w=1600&q=80",
  Porsche:
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80",
  "Mercedes-Benz":
    "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80",
  "Toyota / Lexus":
    "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1600&q=80",
  "Autos de lujo":
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80",
  Hypercars:
    "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80",
  "Celebridades y autos":
    "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1600&q=80",
  "BMW / Audi":
    "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1600&q=80",
  Yates:
    "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?auto=format&fit=crop&w=1600&q=80",
  "Lanchas deportivas":
    "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1600&q=80",
  "Jets privados":
    "https://images.unsplash.com/photo-1474302770733-de1e391ee063?auto=format&fit=crop&w=1600&q=80",
  Clásicos:
    "https://images.unsplash.com/photo-1489824904134-891ab64532f1?auto=format&fit=crop&w=1600&q=80",
  Motorsport:
    "https://images.unsplash.com/photo-1504707748692-419802cf492d?auto=format&fit=crop&w=1600&q=80",
  "Eléctricos de lujo":
    "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1600&q=80",
  "Estilo náutico":
    "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=1600&q=80",
};

async function fetchTopicStockImage(topic = "") {
  const url =
    TOPIC_STOCK_IMAGES[topic] ||
    "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1600&q=80";
  return downloadImageBuffer(url);
}

async function resolveBackgroundBuffer({ title, topic, storyImageUrl = "", storyUrl = "" }) {
  const generated = await generateBackgroundWithOpenAi({ title, topic });
  if (generated) {
    return { buffer: generated, source: "openai" };
  }

  // Prefer curated luxury photography over unreliable news OG graphics.
  const stockBuffer = await fetchTopicStockImage(topic);
  if (stockBuffer) {
    return { buffer: stockBuffer, source: "stock" };
  }

  const storyBuffer = await downloadImageBuffer(storyImageUrl);
  if (storyBuffer && storyBuffer.length > 80_000) {
    return { buffer: storyBuffer, source: "rss" };
  }

  const ogBuffer = await scrapeOpenGraphImage(storyUrl);
  if (ogBuffer && ogBuffer.length > 120_000) {
    return { buffer: ogBuffer, source: "og" };
  }

  return { buffer: null, source: "none" };
}

async function buildBrandedImageBuffer({ title, topic, storyImageUrl = "", storyUrl = "", seed = "" }) {
  const width = 1200;
  const height = 675;
  const layoutSeed = seed || `${title}|${topic}|${Date.now()}`;
  const layout = pickImageLayout(layoutSeed);
  const tagline = pickImageTagline(topic, layoutSeed);
  const overlay = buildOverlayLayout({
    width,
    height,
    title,
    topic,
    layout,
    tagline,
  });

  const { buffer: backgroundBuffer, source: backgroundSource } = await resolveBackgroundBuffer({
    title,
    topic,
    storyImageUrl,
    storyUrl,
  });

  let baseImage;

  if (backgroundBuffer) {
    // Slight crop/position variation so each generation feels different.
    const positions = ["centre", "entropy", "attention", "left", "right"];
    const position = positions[String(layoutSeed).length % positions.length];
    baseImage = sharp(backgroundBuffer)
      .resize(width, height, { fit: "cover", position })
      .modulate({
        brightness: layout === "topBanner" ? 0.86 : 0.9,
        saturation: layout === "rightEditorial" ? 1.12 : 1.08,
      });
  } else {
    const fallbackSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1A1410"/>
            <stop offset="100%" stop-color="#3A2A18"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
      </svg>
    `;
    baseImage = sharp(Buffer.from(fallbackSvg));
  }

  const composites = [
    {
      input: await sharp(Buffer.from(overlay.svg)).png().toBuffer(),
      top: 0,
      left: 0,
    },
  ];

  const logo = await loadBrandLogoBuffer();
  if (logo) {
    composites.push({
      input: await sharp(logo)
        .resize(78, 78, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      top: overlay.logo.top,
      left: overlay.logo.left,
    });
  }

  const output = await baseImage.composite(composites).png().toBuffer();
  output.__backgroundSource = backgroundSource;
  output.__layout = layout;
  return output;
}

async function storeBrandedImage(buffer, preferredName = "global-auto") {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured for auto draft images.");
  }

  const result = await uploadBufferToCloudinary(
    {
      buffer,
      mimetype: "image/png",
      originalname: `${preferredName}.png`,
    },
    process.env.CLOUDINARY_FOLDER || "global-app/posts"
  );

  return {
    type: "image",
    url: result.secure_url,
    caption: "Global Imports",
  };
}

async function resolvePublisherUserId() {
  const publisher = await User.findOne({
    role: { $in: ["admin", "manager"] },
    isActive: { $ne: false },
  })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();

  if (!publisher?._id) {
    throw new Error("No hay un administrador activo para firmar el borrador automático.");
  }

  return publisher._id;
}

async function createDraftFromStory({ story, copy, media, slotKey, publisherId }) {
  const now = new Date();

  return Post.create({
    title: copy.title,
    body: copy.body,
    format: "image",
    media: media ? [media] : [],
    publishedBy: publisherId,
    status: "draft",
    scheduledFor: null,
    publishedAt: null,
    source: {
      url: story.url,
      title: story.title,
      publisher: story.publisher || "",
      topic: story.topic || "",
      fetchedAt: now,
    },
    auto: {
      enabled: true,
      slotKey: slotKey || "",
      generatedAt: now,
      model: copy.model || "",
    },
  });
}

async function generateGlobalDraft({ slotKey = "", force = false } = {}) {
  const resolvedSlot = slotKey || resolveSlotKey(new Date()) || `manual-${Date.now()}`;

  if (!force && !String(resolvedSlot).startsWith("manual-")) {
    const existing = await Post.findOne({ "auto.slotKey": resolvedSlot })
      .select("_id status title createdAt source auto media body format")
      .lean();

    if (existing) {
      return {
        skipped: true,
        reason: "Ya existe un borrador o publicación para este horario.",
        draft: existing,
      };
    }
  }

  const topic = pickTopic(resolvedSlot);
  const story = await findStoryPreferringCars(topic);

  if (!story) {
    throw new Error(`No se encontró una noticia nueva para el tema ${topic.label}.`);
  }

  const copy = await generateCopyWithOpenAi(story);
  const imageBuffer = await buildBrandedImageBuffer({
    title: copy.title,
    topic: story.topic,
    storyImageUrl: story.imageUrl,
    storyUrl: story.url,
    seed: `${resolvedSlot}|${story.url}|${copy.title}`,
  });
  console.info(
    `[POSTS_AUTO] image background source=${imageBuffer.__backgroundSource || "unknown"} layout=${imageBuffer.__layout || "unknown"}`
  );
  const media = await storeBrandedImage(imageBuffer, `global-${resolvedSlot}`);
  const publisherId = await resolvePublisherUserId();
  const draftDoc = await createDraftFromStory({
    story,
    copy,
    media,
    slotKey: resolvedSlot,
    publisherId,
  });

  return {
    skipped: false,
    draft: await Post.findById(draftDoc._id).populate("publishedBy", "name email role"),
  };
}

async function findStoryPreferringCars(preferredTopic, { excludeUrls = [] } = {}) {
  let story = await findUnusedStory(preferredTopic, { excludeUrls });
  if (story) {
    return story;
  }

  const carTopics = GLOBAL_POST_TOPICS.filter((topic) => topic.pool !== "nautical");
  const nauticalTopics = GLOBAL_POST_TOPICS.filter((topic) => topic.pool === "nautical");
  const ordered = [
    ...carTopics.filter((topic) => topic.key !== preferredTopic.key),
    ...nauticalTopics.filter((topic) => topic.key !== preferredTopic.key),
  ];

  for (const fallbackTopic of ordered) {
    story = await findUnusedStory(fallbackTopic, { excludeUrls });
    if (story) {
      return story;
    }
  }

  return null;
}

function getBogotaDateKey(date = new Date()) {
  return getBogotaParts(date).date;
}

async function getRegenerateQuotaStatus(date = new Date()) {
  const dateKey = getBogotaDateKey(date);
  const quota = await AdminQuota.findOne({ key: "draft-regenerate", dateKey }).lean();
  const used = Math.max(0, Number(quota?.count || 0));
  const limit = DAILY_REGENERATE_LIMIT;
  const remaining = Math.max(0, limit - used);

  return {
    dateKey,
    used,
    limit,
    remaining,
    canRegenerate: remaining > 0,
  };
}

class QuotaExceededError extends Error {
  constructor(message, quota) {
    super(message);
    this.name = "QuotaExceededError";
    this.code = "REGENERATE_QUOTA_EXCEEDED";
    this.statusCode = 429;
    this.quota = quota;
  }
}

async function consumeRegenerateQuota({ userId = null, postId = null } = {}) {
  const status = await getRegenerateQuotaStatus();

  if (!status.canRegenerate) {
    throw new QuotaExceededError(
      `Límite diario alcanzado: solo se pueden regenerar ${status.limit} noticias por día (hora Colombia).`,
      status
    );
  }

  await AdminQuota.updateOne(
    { key: "draft-regenerate", dateKey: status.dateKey },
    {
      $setOnInsert: {
        key: "draft-regenerate",
        dateKey: status.dateKey,
        count: 0,
        events: [],
      },
    },
    { upsert: true }
  );

  const updated = await AdminQuota.findOneAndUpdate(
    {
      key: "draft-regenerate",
      dateKey: status.dateKey,
      count: { $lt: status.limit },
    },
    {
      $inc: { count: 1 },
      $push: {
        events: {
          at: new Date(),
          userId: userId || null,
          postId: postId || null,
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    const latest = await getRegenerateQuotaStatus();
    throw new QuotaExceededError(
      `Límite diario alcanzado: solo se pueden regenerar ${latest.limit} noticias por día (hora Colombia).`,
      latest
    );
  }

  return getRegenerateQuotaStatus();
}

async function regenerateExistingDraft(postId, { userId = null } = {}) {
  const draft = await Post.findOne({ _id: postId, status: "draft" });

  if (!draft) {
    const error = new Error("Borrador no encontrado");
    error.statusCode = 404;
    throw error;
  }

  const currentQuota = await getRegenerateQuotaStatus();
  if (!currentQuota.canRegenerate) {
    throw new QuotaExceededError(
      `Límite diario alcanzado: solo se pueden regenerar ${currentQuota.limit} noticias por día (hora Colombia).`,
      currentQuota
    );
  }

  const preferredTopic = pickTopic(`regen-${postId}-${Date.now()}`);
  const excludeUrls = [draft.source?.url].filter(Boolean);
  const story = await findStoryPreferringCars(preferredTopic, { excludeUrls });

  if (!story) {
    throw new Error("No se encontró una noticia nueva distinta a la actual.");
  }

  const copy = await generateCopyWithOpenAi(story);
  const imageBuffer = await buildBrandedImageBuffer({
    title: copy.title,
    topic: story.topic,
    storyImageUrl: story.imageUrl,
    storyUrl: story.url,
    seed: `regen|${postId}|${Date.now()}|${story.url}|${copy.title}`,
  });
  console.info(
    `[POSTS_AUTO] regenerate image background source=${imageBuffer.__backgroundSource || "unknown"} layout=${imageBuffer.__layout || "unknown"}`
  );
  const media = await storeBrandedImage(imageBuffer, `regen-${draft._id}-${Date.now()}`);
  const now = new Date();

  draft.title = copy.title;
  draft.body = copy.body;
  draft.format = "image";
  draft.media = media ? [media] : [];
  draft.source = {
    url: story.url,
    title: story.title,
    publisher: story.publisher || "",
    topic: story.topic || "",
    fetchedAt: now,
  };
  draft.auto = {
    ...(draft.auto?.toObject?.() || draft.auto || {}),
    enabled: true,
    generatedAt: now,
    model: copy.model || draft.auto?.model || "",
    lastRegeneratedAt: now,
  };

  await draft.save();
  const quota = await consumeRegenerateQuota({ userId, postId: draft._id });

  return {
    draft: await Post.findById(draft._id).populate("publishedBy", "name email role"),
    quota,
  };
}

async function runScheduledGlobalDraftJob(now = new Date()) {
  const slotKey = resolveSlotKey(now);

  if (!slotKey) {
    return { ran: false, reason: "Fuera de ventana horaria (16:00 America/Bogota)." };
  }

  const existing = await Post.findOne({ "auto.slotKey": slotKey }).select("_id").lean();

  if (existing) {
    return { ran: false, reason: "Slot ya procesado.", slotKey };
  }

  const result = await generateGlobalDraft({ slotKey, force: false });
  return { ran: true, slotKey, ...result };
}

async function countDraftPosts() {
  return Post.countDocuments({ status: "draft" });
}

module.exports = {
  GLOBAL_POST_TOPICS,
  DAILY_REGENERATE_LIMIT,
  QuotaExceededError,
  resolveSlotKey,
  getBogotaParts,
  generateGlobalDraft,
  regenerateExistingDraft,
  getRegenerateQuotaStatus,
  runScheduledGlobalDraftJob,
  countDraftPosts,
};
