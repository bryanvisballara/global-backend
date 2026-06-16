const GlobalHeroScore = require("../models/GlobalHeroScore");

function serializeLeaderboardEntry(entry, rank) {
  return {
    rank,
    playerName: String(entry?.playerName || "Jugador").trim() || "Jugador",
    score: Number(entry?.score || 0),
    createdAt: entry?.createdAt || null,
  };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPlayerKeyExpression() {
  return {
    $cond: [
      { $ifNull: ["$userId", false] },
      { $concat: ["user:", { $toString: "$userId" }] },
      { $concat: ["name:", { $toLower: { $trim: { input: "$playerName" } } }] },
    ],
  };
}

async function listGlobalHeroLeaderboard(req, res) {
  try {
    const entries = await GlobalHeroScore.aggregate([
      { $sort: { score: -1, createdAt: -1 } },
      {
        $group: {
          _id: buildPlayerKeyExpression(),
          playerName: { $first: "$playerName" },
          score: { $first: "$score" },
          createdAt: { $first: "$createdAt" },
        },
      },
      { $sort: { score: -1, createdAt: -1 } },
      { $limit: 50 },
    ]);

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

    const userId = req.user?._id || null;
    const normalizedName = playerName.slice(0, 80);
    const playerFilter = userId
      ? { userId }
      : {
          userId: null,
          playerName: { $regex: new RegExp(`^${escapeRegex(normalizedName)}$`, "i") },
        };

    const existingBest = await GlobalHeroScore.findOne(playerFilter).sort({ score: -1, createdAt: -1 });

    if (existingBest && score <= existingBest.score) {
      return res.status(200).json({
        message: "Score saved",
        entry: serializeLeaderboardEntry(existingBest.toObject(), null),
      });
    }

    let entry;

    if (existingBest) {
      existingBest.score = score;
      existingBest.playerName = normalizedName;
      entry = await existingBest.save();
      await GlobalHeroScore.deleteMany({
        ...playerFilter,
        _id: { $ne: entry._id },
      });
    } else {
      entry = await GlobalHeroScore.create({
        userId,
        playerName: normalizedName,
        score,
      });
    }

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
