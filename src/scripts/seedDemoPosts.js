require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { connectToDatabase } = require("../config/db");
const Post = require("../models/Post");
const User = require("../models/User");

function validateSeedEnv() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing required environment variable: MONGODB_URI");
  }
}

function buildSvgDataUrl(title, subtitle, colors) {
  const [startColor, endColor, accentColor] = colors;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${startColor}"/>
          <stop offset="100%" stop-color="${endColor}"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1350" fill="url(#bg)" rx="44"/>
      <circle cx="860" cy="280" r="220" fill="${accentColor}" opacity="0.24"/>
      <circle cx="260" cy="980" r="180" fill="#ffffff" opacity="0.08"/>
      <rect x="84" y="120" width="912" height="700" rx="34" fill="#101114" opacity="0.74"/>
      <path d="M236 620h512l86-148h88l74 148h44v74h-48c-12 58-64 98-126 98-62 0-114-40-126-98H450c-12 58-64 98-126 98-62 0-114-40-126-98h-52v-74h90Zm112-212-74 138h440l-80-138H348Zm22 330a58 58 0 1 0 0-116 58 58 0 0 0 0 116Zm454 0a58 58 0 1 0 0-116 58 58 0 0 0 0 116Z" fill="#ffffff" opacity="0.92"/>
      <text x="84" y="940" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700">Global Imports News</text>
      <text x="84" y="1010" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="800">${title}</text>
      <text x="84" y="1090" fill="#e8dfcf" font-family="Arial, Helvetica, sans-serif" font-size="38">${subtitle}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

const demoPosts = [
  {
    title: "Porsche electrifica su linea GT",
    body:
      "Global Imports analiza la nueva generacion de deportivos electricos con enfoque GT: mas respuesta inmediata, menor centro de gravedad y una puesta a punto pensada para clientes que quieren rendimiento sin renunciar al lujo diario.",
    format: "carousel",
    media: [
      {
        type: "image",
        url: buildSvgDataUrl("Porsche GT EV", "Potencia electrica y tacto deportivo", ["#0f172a", "#7c3aed", "#f59e0b"]),
        caption: "Porsche GT EV",
      },
      {
        type: "image",
        url: buildSvgDataUrl("Arquitectura 800V", "Cargas mas rapidas y mejor eficiencia termica", ["#111827", "#2563eb", "#22c55e"]),
        caption: "Arquitectura 800V",
      },
      {
        type: "image",
        url: buildSvgDataUrl("Interior orientado al conductor", "Pantallas limpias y materiales premium", ["#1f2937", "#6d28d9", "#f97316"]),
        caption: "Cabina premium",
      },
    ],
  },
  {
    title: "Mercedes-Maybach eleva el confort SUV",
    body:
      "La tendencia premium sigue girando hacia SUVs de ultra lujo con cabinas silenciosas, suspension predictiva y configuraciones traseras tipo lounge. Es una categoria que Global Imports ve con alta demanda entre clientes corporativos y familiares.",
    format: "image",
    media: [
      {
        type: "image",
        url: buildSvgDataUrl("Maybach SUV", "Confort executive y presencia urbana", ["#3f2b1d", "#111111", "#d8aa52"]),
        caption: "Mercedes-Maybach SUV",
      },
    ],
  },
  {
    title: "Ferrari apuesta por hibridos mas utilizables",
    body:
      "Los nuevos superdeportivos hibridos no solo buscan cifras de potencia. Tambien mejoran entrega de torque, maniobrabilidad en ciudad y eficiencia en recorridos cortos, una combinacion atractiva para clientes que quieren usar su carro con mayor frecuencia.",
    format: "image",
    media: [
      {
        type: "image",
        url: buildSvgDataUrl("Ferrari Hybrid", "Rendimiento extremo con mejor uso diario", ["#3b0a0a", "#9f1239", "#facc15"]),
        caption: "Ferrari hibrido",
      },
    ],
  },
];

async function seedDemoPosts() {
  validateSeedEnv();
  await connectToDatabase();

  const adminUser = await User.findOne({ role: "admin" }).sort({ createdAt: 1 });

  if (!adminUser) {
    throw new Error("No admin user found. Create an admin before seeding demo posts.");
  }

  for (const postInput of demoPosts) {
    await Post.findOneAndUpdate(
      { title: postInput.title },
      {
        ...postInput,
        status: "published",
        publishedBy: adminUser._id,
        publishedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  }

  console.log("Demo posts seed ready");
  console.log(`posts: ${demoPosts.length}`);
}

if (require.main === module) {
  seedDemoPosts()
    .catch((error) => {
      console.error("Failed to seed demo posts", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  seedDemoPosts,
};