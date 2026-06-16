const GlobalHeroScore = require("../models/GlobalHeroScore");

function serializeLeaderboardEntry(entry, rank) {
  return {
    rank,
    playerName: String(entry?.playerName || "Jugador").trim() || "Jugador",
    score: Number(entry?.score || 0),
    createdAt: entry?.createdAt || null,
  };
}

async function listGlobalHeroLeaderboard(req, res) {
  try {
    const entries = await GlobalHeroScore.find({})
      .sort({ score: -1, createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      entries: entries.map((entry, index) => serializeLeaderboardEntry(entry, index + 1)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading leaderboard" });
  }
}

async function submitGlobalHeroScore(req, res) {
  try {
    const score = Number.parseInt(String(req.body?.score ?? ""), 10);

    if (!Number.isFinite(score) || score < 0) {
      return res.status(400).json({ message: "Puntaje invalido" });
    }

    const playerName = String(req.user?.name || req.body?.playerName || "").trim();

    if (!playerName) {
      return res.status(400).json({ message: "Nombre de jugador requerido" });
    }

    const entry = await GlobalHeroScore.create({
      userId: req.user?._id || null,
      playerName: playerName.slice(0, 80),
      score,
    });

    return res.status(201).json({
      message: "Score saved",
      entry: serializeLeaderboardEntry(entry.toObject(), null),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error saving score" });
  }
}

module.exports = {
  listGlobalHeroLeaderboard,
  submitGlobalHeroScore,
};
