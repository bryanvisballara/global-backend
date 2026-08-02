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

async function buildBrandedImageBuffer({ title, topic, storyImageUrl = "" }) {
  const width = 1200;
  const height = 675;
  const lines = wrapTitleLines(title, 30, 3);
  const titleSvg = lines
    .map(
      (line, index) =>
        `<text x="72" y="${250 + index * 58}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" fill="#F7E7C4">${escapeXml(line)}</text>`
    )
    .join("");

  const storyBuffer = await downloadImageBuffer(storyImageUrl);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#14110D"/>
          <stop offset="55%" stop-color="#1C1812"/>
          <stop offset="100%" stop-color="#2A2118"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="36" fill="url(#bg)"/>
      <rect x="48" y="48" width="250" height="42" rx="21" fill="rgba(216,170,82,0.16)"/>
      <text x="72" y="76" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#D8AA52">GLOBAL IMPORTS</text>
      <text x="72" y="150" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#B8A07A">${escapeXml(topic || "Lifestyle")}</text>
      ${titleSvg}
      <rect x="72" y="470" width="72" height="8" rx="4" fill="#D8AA52"/>
      <text x="72" y="530" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#C9B896">Lujo sobre ruedas, agua y cielo</text>
    </svg>
  `;

  const base = sharp(Buffer.from(svg)).png();
  const composites = [];

  if (storyBuffer) {
    composites.push({
      input: await sharp(storyBuffer).resize(360, 360, { fit: "cover" }).png().toBuffer(),
      top: 150,
      left: 760,
    });
  }

  const logo = await loadBrandLogoBuffer();
  if (logo) {
    composites.push({
      input: await sharp(logo)
        .resize(88, 88, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      top: 540,
      left: 1050,
    });
  }

  if (composites.length) {
    return base.composite(composites).png().toBuffer();
  }

  return base.png().toBuffer();
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
  });
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
