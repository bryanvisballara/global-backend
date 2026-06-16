(() => {
  const STORAGE_KEY = "globalImportsSequoiaFlappyBest";
  const PLAYER_NAME_KEY = "globalHeroPlayerName";
  const COVER_URL = "/global-hero-cover.png";
  const SPRITE_URL = "/lion-hero-fly.png";
  const BACKGROUND_URL = "/sequoia-game-bg.png?v=20260616-gamebg01";
  const TRAFFIC_RED_URL = "/srojo.png";
  const TRAFFIC_GREEN_URL = "/sverde.png";

  const DEFAULTS = {
    gravity: 0.42,
    flapVelocity: -7.4,
    pipeSpeed: 2.8,
    pipeGap: 168,
    pipeWidth: 72,
    spawnEveryMs: 1650,
    groundHeight: 56,
  };

  function resolveApiBaseUrl() {
    const { origin, hostname } = window.location;
    const isPrivateIpv4Address = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(
      hostname
    );

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      isPrivateIpv4Address ||
      hostname === "global-backend-bdbx.onrender.com"
    ) {
      return origin;
    }

    return "https://global-backend-bdbx.onrender.com";
  }

  function getAuthToken() {
    return localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadBestScore() {
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function saveBestScore(score) {
    localStorage.setItem(STORAGE_KEY, String(score));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resolvePlayerName(options = {}) {
    const token = getAuthToken();

    if (options.authenticated && token) {
      return "";
    }

    if (typeof options.getPlayerName === "function") {
      const callbackName = String(options.getPlayerName() || "").trim();
      if (callbackName) {
        return callbackName.slice(0, 80);
      }
    }

    const optionName = String(options.playerName || "").trim();

    if (optionName) {
      return optionName.slice(0, 80);
    }

    const storedName = String(localStorage.getItem(PLAYER_NAME_KEY) || "").trim();

    if (storedName) {
      return storedName.slice(0, 80);
    }

    const promptedName = window.prompt("Escribe tu nombre para el ranking:")?.trim();
    if (promptedName) {
      localStorage.setItem(PLAYER_NAME_KEY, promptedName.slice(0, 80));
      return promptedName.slice(0, 80);
    }

    return "Jugador";
  }

  async function fetchLeaderboard(options = {}) {
    const baseUrl = resolveApiBaseUrl();
    const token = getAuthToken();
    const useAuth = Boolean(options.authenticated && token);
    const path = useAuth ? "/api/client/global-hero/leaderboard" : "/api/public/global-hero/leaderboard";
    const headers = { "Content-Type": "application/json" };

    if (useAuth) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, { headers });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo cargar el ranking");
    }

    return data;
  }

  async function submitScoreToLeaderboard(score, options = {}) {
    const baseUrl = resolveApiBaseUrl();
    const token = getAuthToken();
    const useAuth = Boolean(options.authenticated && token);
    const path = useAuth ? "/api/client/global-hero/scores" : "/api/public/global-hero/scores";
    const headers = { "Content-Type": "application/json" };
    const payload = { score };

    if (useAuth) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      payload.playerName = resolvePlayerName(options);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo guardar el puntaje");
    }

    return data;
  }

  function drawPixelCloud(ctx, x, y, scale) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    const unit = 6 * scale;
    [
      [0, 1, 1, 1, 0],
      [1, 1, 1, 1, 1],
      [0, 1, 1, 1, 0],
    ].forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell) {
          ctx.fillRect(x + colIndex * unit, y + rowIndex * unit, unit, unit);
        }
      });
    });
    ctx.restore();
  }

  function drawFallbackTrafficLight(ctx, x, y, height, width, isGreen = false) {
    const poleWidth = Math.max(8, width * 0.18);
    const boxWidth = width;
    const boxHeight = width * 1.55;
    const poleHeight = Math.max(0, height - boxHeight);

    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(x + (width - poleWidth) / 2, y + boxHeight, poleWidth, poleHeight);

    ctx.fillStyle = "#111111";
    ctx.fillRect(x, y, boxWidth, boxHeight);

    const lightRadius = boxWidth * 0.22;
    const centerX = x + boxWidth / 2;
    const lights = isGreen ? ["#3a1010", "#4d4217", "#21e06f"] : ["#ff2b2b", "#4d4217", "#0c5128"];
    lights.forEach((color, index) => {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(centerX, y + boxHeight * (0.22 + index * 0.28), lightRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function drawTrafficLight(ctx, image, x, y, height, width, options = {}) {
    const { flipped = false, isGreen = false } = options;

    if (!image?.complete || image.naturalWidth <= 0) {
      drawFallbackTrafficLight(ctx, x, y, height, width, isGreen);
      return;
    }

    const drawWidth = width;
    const drawHeight = drawWidth * (image.naturalHeight / image.naturalWidth);
    const drawX = x;
    const drawY = flipped ? y + height - drawHeight : y;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - width * 0.12, y, width * 1.24, height);
    ctx.clip();

    if (flipped) {
      ctx.translate(drawX, y + height);
      ctx.scale(1, -1);
      ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
    } else {
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  function createGame(root, options = {}) {
    const shell = document.createElement("div");
    shell.className = "sequoia-game-shell";

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "sequoia-game-back";
    backButton.textContent = "← Menú";
    shell.appendChild(backButton);

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Global Hero mini juego");
    shell.appendChild(canvas);
    root.replaceChildren(shell);

    const ctx = canvas.getContext("2d");
    const sprite = new Image();
    sprite.src = SPRITE_URL;
    const background = new Image();
    background.src = BACKGROUND_URL;
    const trafficRed = new Image();
    trafficRed.src = TRAFFIC_RED_URL;
    const trafficGreen = new Image();
    trafficGreen.src = TRAFFIC_GREEN_URL;

    let width = 360;
    let height = 640;
    let dpr = 1;
    let animationId = 0;
    let lastFrame = 0;
    let lastSpawn = 0;
    let paused = false;
    let mounted = true;
    let scoreSubmitted = false;

    const state = {
      mode: "ready",
      score: 0,
      best: loadBestScore(),
      car: { x: 88, y: 0, vy: 0, w: 132, h: 60 },
      pipes: [],
      clouds: [
        { x: 40, y: 48, scale: 1.1, speed: 0.35 },
        { x: 220, y: 92, scale: 0.9, speed: 0.28 },
        { x: 300, y: 36, scale: 0.75, speed: 0.22 },
      ],
    };

    function resize() {
      const bounds = shell.getBoundingClientRect();
      width = Math.max(280, Math.round(bounds.width || 360));
      height = Math.max(420, Math.round(bounds.height || 640));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resetCarPosition(false);
    }

    function resetCarPosition(resetVelocity = true) {
      state.car.y = height * 0.42;
      if (resetVelocity) {
        state.car.vy = 0;
      }
    }

    function resetGame() {
      state.mode = "ready";
      state.score = 0;
      state.pipes = [];
      lastSpawn = 0;
      scoreSubmitted = false;
      resetCarPosition(true);
    }

    function spawnPipe(now) {
      const minGapY = 120;
      const maxGapY = height - DEFAULTS.groundHeight - DEFAULTS.pipeGap - 120;
      const gapY = minGapY + Math.random() * Math.max(40, maxGapY - minGapY);

      state.pipes.push({
        x: width + 20,
        gapY,
        passed: false,
      });
      lastSpawn = now;
    }

    function drawBackground() {
      if (background.complete && background.naturalWidth > 0) {
        const scale = Math.max(width / background.naturalWidth, height / background.naturalHeight);
        const drawWidth = background.naturalWidth * scale;
        const drawHeight = background.naturalHeight * scale;
        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;

        ctx.drawImage(background, offsetX, offsetY, drawWidth, drawHeight);
        ctx.fillStyle = "rgba(5, 7, 13, 0.18)";
        ctx.fillRect(0, 0, width, height);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, "#0d1b2a");
        gradient.addColorStop(0.55, "#1b263b");
        gradient.addColorStop(1, "#05070d");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      state.clouds.forEach((cloud) => {
        drawPixelCloud(ctx, cloud.x, cloud.y, cloud.scale * 0.75);
      });

      ctx.fillStyle = "rgba(9, 11, 16, 0.88)";
      ctx.fillRect(0, height - DEFAULTS.groundHeight, width, DEFAULTS.groundHeight);
      ctx.fillStyle = "rgba(216, 170, 82, 0.45)";
      ctx.fillRect(0, height - DEFAULTS.groundHeight, width, 3);
    }

    function drawCar() {
      const { x, y, w, h } = state.car;

      if (sprite.complete && sprite.naturalWidth > 0) {
        const aspect = sprite.naturalWidth / sprite.naturalHeight;
        const drawHeight = h;
        const drawWidth = drawHeight * aspect;
        const angle = clamp(state.car.vy * 0.045, -0.32, 0.42);

        ctx.save();
        ctx.translate(x + drawWidth * 0.42, y);
        ctx.rotate(angle);
        ctx.drawImage(sprite, -drawWidth * 0.42, -drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();
        return;
      }

      ctx.fillStyle = "#2ec4e8";
      ctx.fillRect(x, y - h / 2, w, h * 0.55);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + w * 0.12, y - h * 0.18, w * 0.72, h * 0.28);
    }

    function drawPipes() {
      state.pipes.forEach((pipe) => {
        const topHeight = pipe.gapY;
        const bottomY = pipe.gapY + DEFAULTS.pipeGap;
        const bottomHeight = height - DEFAULTS.groundHeight - bottomY;
        const trafficImage = pipe.passed ? trafficGreen : trafficRed;
        drawTrafficLight(ctx, trafficImage, pipe.x, 0, topHeight, DEFAULTS.pipeWidth, {
          flipped: true,
          isGreen: pipe.passed,
        });
        drawTrafficLight(ctx, trafficImage, pipe.x, bottomY, bottomHeight, DEFAULTS.pipeWidth, {
          isGreen: pipe.passed,
        });
      });
    }

    function drawHud() {
      ctx.fillStyle = "#ffffff";
      ctx.font = '800 42px "Syne", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(String(state.score), width / 2, 72);

      ctx.font = '600 13px "Manrope", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.fillText(`RÉCORD ${state.best}`, width / 2, 96);

      if (state.mode === "ready") {
        ctx.font = '700 18px "Manrope", sans-serif';
        ctx.fillStyle = "#f4ead3";
        ctx.fillText("TOCA PARA VOLAR", width / 2, height * 0.58);
        ctx.font = '500 14px "Manrope", sans-serif';
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.fillText("Evita los semáforos", width / 2, height * 0.58 + 28);
      }

      if (state.mode === "over") {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, height * 0.34, width, 150);
        ctx.fillStyle = "#ffffff";
        ctx.font = '800 28px "Syne", sans-serif';
        ctx.fillText("GAME OVER", width / 2, height * 0.42);
        ctx.font = '600 15px "Manrope", sans-serif';
        ctx.fillStyle = "#f4ead3";
        ctx.fillText("Toca para reintentar", width / 2, height * 0.48);
      }
    }

    function hitTest() {
      const carBox = {
        x: state.car.x + 16,
        y: state.car.y - state.car.h * 0.32,
        w: state.car.w - 28,
        h: state.car.h * 0.58,
      };

      if (carBox.y <= 0 || carBox.y + carBox.h >= height - DEFAULTS.groundHeight) {
        return true;
      }

      return state.pipes.some((pipe) => {
        const pipeBox = { x: pipe.x, w: DEFAULTS.pipeWidth };
        const overlapsX = carBox.x + carBox.w > pipeBox.x && carBox.x < pipeBox.x + pipeBox.w;
        const hitsTop = carBox.y < pipe.gapY;
        const hitsBottom = carBox.y + carBox.h > pipe.gapY + DEFAULTS.pipeGap;
        return overlapsX && (hitsTop || hitsBottom);
      });
    }

    function endGame() {
      state.mode = "over";

      if (state.score > state.best) {
        state.best = state.score;
        saveBestScore(state.best);
      }

      if (!scoreSubmitted) {
        scoreSubmitted = true;
        options.onGameOver?.(state.score);
      }
    }

    function flap() {
      if (state.mode === "ready") {
        state.mode = "playing";
        state.car.vy = DEFAULTS.flapVelocity;
        return;
      }

      if (state.mode === "over") {
        resetGame();
        state.mode = "playing";
        state.car.vy = DEFAULTS.flapVelocity;
        return;
      }

      state.car.vy = DEFAULTS.flapVelocity;
    }

    function update(now) {
      state.clouds.forEach((cloud) => {
        cloud.x -= cloud.speed;
        if (cloud.x < -80) {
          cloud.x = width + 40;
        }
      });

      if (state.mode !== "playing") {
        state.car.y += Math.sin(now / 280) * 0.35;
        return;
      }

      state.car.vy += DEFAULTS.gravity;
      state.car.vy = clamp(state.car.vy, -9, 11);
      state.car.y += state.car.vy;

      if (!lastSpawn || now - lastSpawn >= DEFAULTS.spawnEveryMs) {
        spawnPipe(now);
      }

      state.pipes.forEach((pipe) => {
        pipe.x -= DEFAULTS.pipeSpeed;
        if (!pipe.passed && pipe.x + DEFAULTS.pipeWidth < state.car.x) {
          pipe.passed = true;
          state.score += 1;
        }
      });

      state.pipes = state.pipes.filter((pipe) => pipe.x + DEFAULTS.pipeWidth > -20);

      if (hitTest()) {
        endGame();
      }
    }

    function render() {
      drawBackground();
      drawPipes();
      drawCar();
      drawHud();
    }

    function loop(now) {
      if (!mounted) {
        return;
      }

      if (!paused) {
        update(now);
        render();
      }

      lastFrame = now;
      animationId = window.requestAnimationFrame(loop);
    }

    function onPointerDown(event) {
      if (event.target === backButton) {
        return;
      }

      event.preventDefault();
      flap();
    }

    function onKeyDown(event) {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        flap();
      }
    }

    backButton.addEventListener("click", () => {
      options.onExit?.();
    });

    shell.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", resize);

    sprite.addEventListener("load", () => {
      if (mounted) {
        render();
      }
    });

    background.addEventListener("load", () => {
      if (mounted) {
        render();
      }
    });

    [trafficRed, trafficGreen].forEach((image) => {
      image.addEventListener("load", () => {
        if (mounted) {
          render();
        }
      });
    });

    resize();
    resetGame();
    animationId = window.requestAnimationFrame(loop);

    return {
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
        lastFrame = 0;
      },
      destroy() {
        mounted = false;
        window.cancelAnimationFrame(animationId);
        shell.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("resize", resize);
        root.replaceChildren();
      },
    };
  }

  function renderRankingList(listElement, entries) {
    if (!entries.length) {
      listElement.innerHTML = '<p class="global-hero-ranking-empty">Aún no hay puntajes registrados.</p>';
      return;
    }

    listElement.innerHTML = entries
      .map(
        (entry) => `
          <li class="global-hero-ranking-item">
            <span class="global-hero-ranking-rank">#${entry.rank}</span>
            <span class="global-hero-ranking-name">${escapeHtml(entry.playerName)}</span>
            <span class="global-hero-ranking-score">${entry.score} semáforos</span>
          </li>
        `
      )
      .join("");
  }

  function createHub(root, options = {}) {
    root.className = "global-hero-hub";

    const menuScreen = document.createElement("section");
    menuScreen.className = "global-hero-screen global-hero-menu is-active";

    const coverImage = document.createElement("img");
    coverImage.className = "global-hero-cover";
    coverImage.src = COVER_URL;
    coverImage.alt = "Global Hero";
    coverImage.decoding = "async";
    coverImage.loading = "eager";

    const menuOverlay = document.createElement("div");
    menuOverlay.className = "global-hero-menu-overlay";

    const menuActions = document.createElement("div");
    menuActions.className = "global-hero-menu-actions";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "global-hero-play-button";
    playButton.textContent = "Jugar ahora";

    const rankingButton = document.createElement("button");
    rankingButton.type = "button";
    rankingButton.className = "global-hero-ranking-button";
    rankingButton.textContent = "Ranking";

    menuActions.append(playButton, rankingButton);
    menuOverlay.appendChild(menuActions);
    menuScreen.append(coverImage, menuOverlay);

    const gameScreen = document.createElement("section");
    gameScreen.className = "global-hero-screen global-hero-game";
    const gameMount = document.createElement("div");
    gameMount.className = "global-hero-game-mount";
    gameScreen.appendChild(gameMount);

    const rankingScreen = document.createElement("section");
    rankingScreen.className = "global-hero-screen global-hero-ranking";

    const rankingHeader = document.createElement("header");
    rankingHeader.className = "global-hero-ranking-header";

    const rankingBackButton = document.createElement("button");
    rankingBackButton.type = "button";
    rankingBackButton.className = "global-hero-back-button";
    rankingBackButton.textContent = "← Volver";

    const rankingTitle = document.createElement("h3");
    rankingTitle.textContent = "Top 50 ranking";

    const rankingSubtitle = document.createElement("p");
    rankingSubtitle.textContent = "Más semáforos superados = mejor posición.";

    const rankingList = document.createElement("ol");
    rankingList.className = "global-hero-ranking-list";

    rankingHeader.append(rankingBackButton, rankingTitle, rankingSubtitle);
    rankingScreen.append(rankingHeader, rankingList);

    root.replaceChildren(menuScreen, gameScreen, rankingScreen);

    let activeScreen = "menu";
    let gameInstance = null;

    function showScreen(screenName) {
      activeScreen = screenName;
      menuScreen.classList.toggle("is-active", screenName === "menu");
      gameScreen.classList.toggle("is-active", screenName === "game");
      rankingScreen.classList.toggle("is-active", screenName === "ranking");
    }

    async function loadRanking() {
      rankingList.innerHTML = '<p class="global-hero-ranking-loading">Cargando ranking...</p>';

      try {
        const data = await fetchLeaderboard(options);
        renderRankingList(rankingList, data.entries || []);
      } catch (error) {
        rankingList.innerHTML = `<p class="global-hero-ranking-empty">${escapeHtml(error.message || "No se pudo cargar el ranking.")}</p>`;
      }
    }

    function stopGame() {
      if (gameInstance) {
        gameInstance.destroy();
        gameInstance = null;
      }
    }

    function startGame() {
      const token = getAuthToken();
      const isAuthenticatedSession = Boolean(options.authenticated && token);

      if (!isAuthenticatedSession) {
        resolvePlayerName(options);
      }

      stopGame();
      showScreen("game");

      gameInstance = createGame(gameMount, {
        ...options,
        onGameOver(score) {
          submitScoreToLeaderboard(score, options).catch(() => null);
        },
        onExit() {
          stopGame();
          showScreen("menu");
        },
      });
    }

    playButton.addEventListener("click", startGame);

    rankingButton.addEventListener("click", () => {
      showScreen("ranking");
      loadRanking();
    });

    rankingBackButton.addEventListener("click", () => {
      showScreen("menu");
    });

    return {
      pause() {
        if (activeScreen === "game") {
          gameInstance?.pause();
        }
      },
      resume() {
        if (activeScreen === "game") {
          gameInstance?.resume();
        }
      },
      destroy() {
        stopGame();
        root.replaceChildren();
        root.className = "";
      },
    };
  }

  let activeInstance = null;

  window.SequoiaFlappyGame = {
    mount(rootElement, options = {}) {
      if (!rootElement) {
        return null;
      }

      this.unmount();
      activeInstance = createHub(rootElement, options);
      return activeInstance;
    },
    unmount() {
      if (activeInstance) {
        activeInstance.destroy();
        activeInstance = null;
      }
    },
    pause() {
      activeInstance?.pause();
    },
    resume() {
      activeInstance?.resume();
    },
  };
})();
