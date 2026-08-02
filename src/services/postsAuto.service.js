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
  { key: "supercars", label: "Supercars", query: "supercar exotic car news" },
  { key: "luxury_cars", label: "Autos de lujo", query: "luxury car launch Ferrari Lamborghini Porsche" },
  { key: "hypercars", label: "Hypercars", query: "hypercar Bugatti McLaren Koenigsegg" },
  { key: "yachts", label: "Yates", query: "luxury yacht megayacht launch" },
  { key: "sport_boats", label: "Lanchas deportivas", query: "sport yacht powerboat luxury boat" },
  { key: "private_jets", label: "Jets privados", query: "private jet luxury aviation Gulfstream" },
  { key: "classic_cars", label: "Clásicos", query: "classic car auction collector car" },
  { key: "motorsport", label: "Motorsport", query: "Formula 1 Le Mans GT racing" },
  { key: "ev_luxury", label: "Eléctricos de lujo", query: "luxury electric supercar Rivian Lucid" },
  { key: "marine_lifestyle", label: "Estilo náutico", query: "superyacht marina lifestyle" },
];

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
  return GLOBAL_POST_TOPICS[hash % GLOBAL_POST_TOPICS.length];
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

async function findUnusedStory(topic) {
  const items = await fetchRssItems(topic);

  for (const item of items) {
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
    "Eres el editor de contenido de Global Imports, marca premium de importación de vehículos y lifestyle de lujo en Colombia.",
    "A partir de la noticia fuente, genera un título y un texto corto en español, con tono elegante, entretenido y aspiracional.",
    "Temas válidos: carros, supercars, yates, lanchas deportivas, jets. Mantén el enfoque en eso.",
    "No inventes datos. No uses clickbait exagerado. No suenes como publicidad agresiva.",
    "Devuelve SOLO JSON válido con esta forma: {\"title\":\"...\",\"body\":\"...\"}",
    `Tema: ${story.topic}`,
    `Título fuente: ${story.title}`,
    `Resumen fuente: ${story.description || "(sin resumen)"}`,
    `Medio: ${story.publisher || "(desconocido)"}`,
    "El título debe tener máximo 90 caracteres.",
    "El body debe tener entre 280 y 520 caracteres, 1 o 2 párrafos cortos.",
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
  const title = normalizeText(parsed.title).slice(0, 120);
  const body = normalizeText(parsed.body).slice(0, 1200);

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

function wrapTitleLines(title, maxChars = 28, maxLines = 3) {
  const words = normalizeText(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    } else {
      current = next;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  const leftover = words.join(" ").slice(lines.join(" ").length).trim();
  if (leftover && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`.slice(0, maxChars + 1);
  }

  return lines.slice(0, maxLines);
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
    "Autos de lujo": "luxury sedan in a modern showroom with dramatic lighting",
    Hypercars: "hypercar on an empty mountain road at dusk",
    Yates: "luxury megayacht on calm Mediterranean water at sunset",
    "Lanchas deportivas": "sport yacht cutting through turquoise water",
    "Jets privados": "private jet on a premium airport tarmac at blue hour",
    Clásicos: "classic collector car in a refined garage",
    Motorsport: "motorsport race car on track with motion and sparks",
    "Eléctricos de lujo": "sleek luxury electric car in a futuristic city night",
    "Estilo náutico": "luxury marina with yachts and warm evening lights",
  };

  const scene = topicHints[topic] || "luxury lifestyle scene with cars yachts or private jets";

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
  "Autos de lujo":
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80",
  Hypercars:
    "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1600&q=80",
  Yates:
    "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?auto=format&fit=crop&w=1600&q=80",
  "Lanchas deportivas":
    "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1600&q=80",
  "Jets privados":
    "https://images.unsplash.com/photo-1540962351504-169cc2eecd6e?auto=format&fit=crop&w=1600&q=80",
  Clásicos:
    "https://images.unsplash.com/photo-1489824904134-891ab64532f1?auto=format&fit=crop&w=1600&q=80",
  Motorsport:
    "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1600&q=80",
  "Eléctricos de lujo":
    "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1600&q=80",
  "Estilo náutico":
    "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=1600&q=80",
};

async function fetchTopicStockImage(topic = "") {
  const url =
    TOPIC_STOCK_IMAGES[topic] ||
    "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?auto=format&fit=crop&w=1600&q=80";
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

async function buildBrandedImageBuffer({ title, topic, storyImageUrl = "", storyUrl = "" }) {
  const width = 1200;
  const height = 675;
  const lines = wrapTitleLines(title, 26, 3);
  const titleStartY = 250;
  const titleSvg = lines
    .map(
      (line, index) =>
        `<text x="64" y="${titleStartY + index * 62}" font-family="Georgia, 'Times New Roman', serif" font-size="48" font-weight="700" fill="#FFF8EA">${escapeXml(line)}</text>`
    )
    .join("");

  const { buffer: backgroundBuffer, source: backgroundSource } = await resolveBackgroundBuffer({
    title,
    topic,
    storyImageUrl,
    storyUrl,
  });

  let baseImage;

  if (backgroundBuffer) {
    baseImage = sharp(backgroundBuffer)
      .resize(width, height, { fit: "cover", position: "centre" })
      .modulate({ brightness: 0.9, saturation: 1.08 });
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

  const overlaySvg = `
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
      <text x="82" y="77" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2" fill="#1A1208">GLOBAL IMPORTS</text>
      <text x="64" y="150" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3" fill="#E8C57A">${escapeXml(String(topic || "Lifestyle").toUpperCase())}</text>
      ${titleSvg}
      <rect x="64" y="460" width="64" height="4" rx="2" fill="#D8AA52"/>
      <text x="64" y="510" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-style="italic" fill="#F0E2C4">Lujo sobre ruedas, agua y cielo</text>
    </svg>
  `;

  const composites = [
    {
      input: await sharp(Buffer.from(overlaySvg)).png().toBuffer(),
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
      top: 560,
      left: 1080,
    });
  }

  const output = await baseImage.composite(composites).png().toBuffer();
  output.__backgroundSource = backgroundSource;
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
  let story = await findUnusedStory(topic);

  if (!story) {
    for (const fallbackTopic of GLOBAL_POST_TOPICS) {
      if (fallbackTopic.key === topic.key) {
        continue;
      }
      story = await findUnusedStory(fallbackTopic);
      if (story) {
        break;
      }
    }
  }

  if (!story) {
    throw new Error(`No se encontró una noticia nueva para el tema ${topic.label}.`);
  }

  const copy = await generateCopyWithOpenAi(story);
  const imageBuffer = await buildBrandedImageBuffer({
    title: copy.title,
    topic: story.topic,
    storyImageUrl: story.imageUrl,
    storyUrl: story.url,
  });
  console.info(`[POSTS_AUTO] image background source=${imageBuffer.__backgroundSource || "unknown"}`);
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
  resolveSlotKey,
  getBogotaParts,
  generateGlobalDraft,
  runScheduledGlobalDraftJob,
  countDraftPosts,
};
