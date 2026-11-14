(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const nav = $("#spotNav");
  const back = $("#spotBack");
  const main = $(".main-area");
  const panel = $("#spotPanel");
  const status = $("#spotStatus");
  const setupFeedback = $("#spotSetupFeedback");
  const checkButton = $("#checkBinanceSecrets");
  const syncButton = $("#syncBinance");
  const balanceTable = $("#spotBalances");
  const assetSelect = $("#spotAsset");
  const form = $("#spotAnalysisForm");
  const result = $("#spotResult");
  const state = {
    balances: [],
    title: "Percakapan baru",
    synced: false,
    configured: false,
    connected: false,
    missing: [],
    invalid: [],
    connectionError: null,
    busy: false,
  };

  function escapeText(value) {
    return String(value ?? "");
  }

  async function request(path, method = "GET", body = {}) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(method === "GET"
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-Token": window.NalarAuth.csrfToken,
            }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) window.NalarAuth.expire();
    if (!response.ok)
      throw new Error(data.error || `Permintaan gagal (${response.status}).`);
    return data;
  }

  function setStatus(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function renderConfiguration(data) {
    state.configured = data.configured === true;
    state.missing = Array.isArray(data.missing) ? data.missing : [];
    state.invalid = Array.isArray(data.invalid) ? data.invalid : [];
    const missing = state.missing;
    const invalid = state.invalid;
    const stepTwo = $("#spotStep2State");
    const stepThree = $("#spotStep3State");

    if (invalid.length) {
      stepTwo.textContent = "Format private key perlu diperbaiki";
      stepTwo.dataset.kind = "warning";
    } else if (missing.length) {
      stepTwo.textContent = `Belum lengkap · ${missing.length} secret`;
      stepTwo.dataset.kind = "warning";
    } else {
      stepTwo.textContent = "Kedua secret tersedia";
      stepTwo.dataset.kind = "good";
    }

    stepThree.textContent = state.connected
      ? "Terhubung · sesi tab ini"
      : state.connectionError
        ? "Belum terhubung · periksa akses"
        : state.configured
          ? "Siap diuji"
          : "Menunggu konfigurasi";
    stepThree.dataset.kind = state.connected
      ? "good"
      : state.connectionError
        ? "warning"
        : state.configured
          ? "ready"
          : "muted";

    syncButton.disabled = !state.configured || state.busy;
    syncButton.textContent = state.connected
      ? "Sinkronkan saldo lagi"
      : "Tes koneksi & sinkronkan saldo";

    if (state.connected) {
      setStatus(
        "Terhubung ke Binance Spot dengan akses baca-saja pada sesi tab ini. Saldo hanya diperbarui saat kamu menekan tombol sinkronisasi.",
        "good",
      );
      return;
    }
    if (invalid.length) {
      setStatus(
        `Format ${invalid.join(", ")} tidak valid. Perbaiki private key Ed25519 di Secrets proyek, lalu periksa kembali.`,
        "warning",
      );
      return;
    }
    if (missing.length) {
      setStatus(
        `Belum siap. Tambahkan ${missing.join(" dan ")} melalui Pengaturan proyek → Secrets, lalu tekan “Periksa konfigurasi”.`,
        "warning",
      );
      return;
    }
    setStatus(
      "Kedua Secrets tersedia dan private key berformat Ed25519. Koneksi Binance belum diuji; tekan tombol tes untuk membaca saldo.",
      "info",
    );
  }

  async function loadStatus(announce = false) {
    try {
      const data = await request("/api/binance/status");
      renderConfiguration(data);
      if (announce) {
        setupFeedback.textContent = state.configured
          ? "Semua Secrets ditemukan dan format private key valid. Langkah berikutnya: tekan “Tes koneksi & sinkronkan saldo”."
          : state.invalid?.length
            ? `Perbaiki format ${state.invalid.join(", ")} melalui Secrets proyek, lalu periksa kembali.`
            : `Belum lengkap. Secret yang perlu ditambahkan: ${(data.missing || []).join(", ")}. Nilainya jangan dikirim lewat chat atau dimasukkan ke halaman ini.`;
      }
      return data;
    } catch (error) {
      state.configured = false;
      syncButton.disabled = true;
      setStatus(error.message, "warning");
      if (announce) setupFeedback.textContent = error.message;
      return null;
    }
  }

  function renderBalances(data) {
    state.balances = data.balances || [];
    state.synced = true;
    state.connected = true;
    state.connectionError = null;
    balanceTable.replaceChildren();
    const head = document.createElement("div");
    head.className = "balance-row balance-head";
    ["Aset", "Free", "Locked", "Total"].forEach((text) => {
      const cell = document.createElement("span");
      cell.textContent = text;
      head.append(cell);
    });
    balanceTable.append(head);
    if (!state.balances.length) {
      const empty = document.createElement("p");
      empty.className = "spot-empty";
      empty.textContent = "Tidak ada saldo non-nol yang dikembalikan Binance.";
      balanceTable.append(empty);
    } else {
      state.balances.forEach((balance) => {
        const row = document.createElement("div");
        row.className = "balance-row";
        [balance.asset, balance.free, balance.locked, balance.total].forEach(
          (text) => {
            const cell = document.createElement("span");
            cell.textContent = escapeText(text);
            row.append(cell);
          },
        );
        balanceTable.append(row);
      });
    }
    assetSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Pilih aset yang ada di saldo Spot";
    assetSelect.append(placeholder);
    state.balances
      .filter((item) => item.asset !== "USDT")
      .forEach((balance) => {
        const option = document.createElement("option");
        option.value = balance.asset;
        option.textContent = `${balance.asset} · ${balance.total}`;
        assetSelect.append(option);
      });
    const stamp = new Date(data.asOf).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    renderConfiguration({ configured: true, missing: [], invalid: [] });
    setStatus(
      `Terhubung · saldo dibaca dari ${data.source} pada ${stamp}. Data ini hanya ada di sesi browser ini dan tidak disimpan.`,
      "good",
    );
    setupFeedback.textContent =
      "Koneksi berhasil. Nalar memakai akses baca-saja; tidak ada order yang dibuat atau dikirim.";
    result.replaceChildren();
  }

  function renderAnalysis(data) {
    result.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = `Skenario ${data.symbol} · ${data.interval}`;
    const metadata = document.createElement("p");
    metadata.className = "spot-meta";
    metadata.textContent = `${data.source} · diambil ${new Date(data.fetchedAt).toLocaleString("id-ID")} · candle selesai ${new Date(data.candleCloseTime).toLocaleString("id-ID")}`;
    const summary = document.createElement("p");
    summary.className = "spot-summary";
    summary.textContent = `Harga saat diambil ${data.currentPrice} USDT · ATR(14) ${data.atr14} · jumlah saldo ${data.positionQuantity} ${data.asset} · harga masuk ${data.entryPrice} USDT · batas risiko ${data.riskBudgetUsdt} USDT.`;
    const indicators = data.indicators;
    const indicatorSection = document.createElement("section");
    indicatorSection.className = "indicator-section";
    indicatorSection.setAttribute("aria-label", "Indikator teknikal");
    const indicatorHeading = document.createElement("h4");
    indicatorHeading.textContent = "Indikator teknikal";
    const indicatorMeta = document.createElement("p");
    indicatorMeta.className = "spot-meta";
    indicatorMeta.textContent = `Dihitung dari ${indicators.sampleSize} candle lengkap. Close terakhir ${indicators.lastClose} USDT pada ${new Date(data.candleCloseTime).toLocaleString("id-ID")}. Ini ringkasan indikator, bukan sinyal order.`;
    const indicatorGrid = document.createElement("div");
    indicatorGrid.className = "indicator-grid";
    const addIndicator = (name, value, detail, tone = "neutral") => {
      const card = document.createElement("article");
      card.className = "indicator-card";
      card.dataset.tone = tone;
      const label = document.createElement("span");
      label.className = "indicator-label";
      label.textContent = name;
      const metric = document.createElement("strong");
      metric.className = "indicator-value";
      metric.textContent = value;
      const explanation = document.createElement("p");
      explanation.textContent = detail;
      card.append(label, metric, explanation);
      indicatorGrid.append(card);
    };
    const bias = indicators.bias;
    const biasLabel =
      bias === "bullish"
        ? "Bullish"
        : bias === "bearish"
          ? "Bearish"
          : "Campuran / netral";
    const biasTone =
      bias === "bullish"
        ? "positive"
        : bias === "bearish"
          ? "negative"
          : "neutral";
    const biasDetail =
      bias === "bullish"
        ? `${indicators.votes.bullish}/4 kondisi mendukung kecenderungan bullish.`
        : bias === "bearish"
          ? `${indicators.votes.bearish}/4 kondisi mendukung kecenderungan bearish.`
          : `${indicators.votes.bullish}/4 kondisi bullish dan ${indicators.votes.bearish}/4 bearish; sinyal belum selaras.`;
    addIndicator(
      "Bias teknikal",
      biasLabel,
      `${biasDetail} Bias bukan instruksi membeli, menjual, atau menahan aset.`,
      biasTone,
    );
    const ema20Above50 = Number(indicators.ema20) > Number(indicators.ema50);
    addIndicator(
      "EMA (20 / 50)",
      `${indicators.ema20} / ${indicators.ema50}`,
      `Close ${Number(indicators.lastClose) > Number(indicators.ema20) ? "di atas" : "di bawah"} EMA20; EMA20 ${ema20Above50 ? "di atas" : "di bawah atau sama dengan"} EMA50.`,
    );
    const rsi = Number(indicators.rsi14);
    const rsiContext =
      rsi >= 70
        ? "Zona tinggi (≥70); bukan bukti harga pasti berbalik."
        : rsi <= 30
          ? "Zona rendah (≤30); bukan bukti harga pasti berbalik."
          : "Zona tengah; periksa bersama indikator dan konteks lain.";
    addIndicator("RSI (14)", indicators.rsi14, rsiContext);
    addIndicator(
      "MACD (12 / 26 / 9)",
      `${indicators.macd.value} · signal ${indicators.macd.signal}`,
      `Histogram ${indicators.macd.histogram}; MACD ${indicators.macd.aboveSignal ? "di atas" : "di bawah atau sama dengan"} garis signal.`,
      indicators.macd.aboveSignal ? "positive" : "neutral",
    );
    addIndicator(
      "Bollinger Bands (20, 2)",
      `${indicators.bollinger.lower} – ${indicators.bollinger.upper}`,
      `Band bawah ${indicators.bollinger.lower} · tengah ${indicators.bollinger.middle} · atas ${indicators.bollinger.upper} USDT.`,
    );
    addIndicator(
      "Volume candle / rata-rata 20",
      indicators.volume?.ratio20 === null || !indicators.volume
        ? "Tidak tersedia"
        : `${indicators.volume.ratio20}×`,
      indicators.volume
        ? `Volume candle terakhir ${indicators.volume.last}; rata-rata 20 candle ${indicators.volume.average20}.`
        : "Volume candle tidak tersedia; indikator lain tetap memakai candle yang sudah ditutup.",
    );
    indicatorSection.append(indicatorHeading, indicatorMeta, indicatorGrid);
    const cards = document.createElement("div");
    cards.className = "scenario-list";
    data.scenarios.forEach((scenario) => {
      const card = document.createElement("article");
      card.className = `scenario-card${scenario.overRiskBudget ? " over-budget" : ""}`;
      const heading = document.createElement("strong");
      heading.textContent = `${scenario.atrMultiple}× ATR`;
      const values = document.createElement("p");
      if (scenario.stopPrice === null) {
        values.textContent =
          "Tidak ditampilkan: level hasil hitung tidak positif; data ini tidak cukup untuk usulan angka.";
      } else {
        const theoreticalSize =
          scenario.maxQuantityForRiskBudget === null
            ? "Ukuran posisi teoritis tidak dihitung karena level stop berada pada/di atas harga masuk."
            : `Ukuran teoritis maksimum ${scenario.maxQuantityForRiskBudget} ${data.asset} (notional ${scenario.maxNotionalAtEntryUsdt} USDT, sebelum biaya).`;
        values.textContent = `Level skenario ${scenario.stopPrice} USDT · jarak ${scenario.distancePct}% · estimasi rugi saldo kini ${scenario.estimatedLossUsdt} USDT${scenario.overRiskBudget ? " · MELEBIHI batas risiko" : " · dalam batas risiko"}${scenario.aboveEntry ? " · level pada/di atas harga masuk; rugi model terhadap entry dihitung 0 sebelum biaya" : ""}. ${theoreticalSize}`;
      }
      card.append(heading, values);
      cards.append(card);
    });
    const notice = document.createElement("p");
    notice.className = "spot-disclaimer";
    notice.textContent = data.note;
    result.append(title, metadata, summary, indicatorSection, cards, notice);
  }

  checkButton.addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    checkButton.disabled = true;
    checkButton.textContent = "Memeriksa…";
    await loadStatus(true);
    state.busy = false;
    checkButton.disabled = false;
    checkButton.textContent = "Periksa konfigurasi";
    syncButton.disabled = !state.configured;
  });

  syncButton.addEventListener("click", async () => {
    if (state.busy || !state.configured) return;
    state.busy = true;
    syncButton.disabled = true;
    checkButton.disabled = true;
    setStatus(
      "Menguji koneksi dengan satu permintaan akun Binance Spot baca-saja…",
      "info",
    );
    setupFeedback.textContent =
      "Menunggu respons Binance. Nalar hanya membaca akun; tidak ada transaksi yang dikirim.";
    try {
      renderBalances(await request("/api/binance/sync", "POST"));
    } catch (error) {
      state.connected = false;
      state.connectionError = error.message;
      const stepThree = $("#spotStep3State");
      stepThree.textContent = "Belum terhubung · periksa akses";
      stepThree.dataset.kind = "warning";
      setStatus(error.message, "warning");
      setupFeedback.textContent = `Koneksi belum berhasil. ${error.message} Periksa permission baca, pembatasan IP, dan format key; jangan mengirim nilainya ke chat.`;
    } finally {
      state.busy = false;
      checkButton.disabled = false;
      syncButton.disabled = !state.configured;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.synced)
      return setStatus(
        "Tes koneksi dan sinkronkan saldo terlebih dahulu; Nalar tidak menerima saldo ketikan dari browser.",
        "warning",
      );
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    result.replaceChildren();
    try {
      const data = await request("/api/binance/analyze", "POST", {
        asset: assetSelect.value,
        interval: $("#spotInterval").value,
        entryPrice: $("#spotEntryPrice").value,
        riskBudgetUsdt: $("#spotRiskBudget").value,
      });
      renderAnalysis(data);
    } catch (error) {
      const note = document.createElement("p");
      note.className = "spot-disclaimer";
      note.textContent = error.message;
      result.replaceChildren(note);
    } finally {
      submit.disabled = false;
    }
  });

  nav.addEventListener("click", () => showPanel(true));
  back.addEventListener("click", () => showPanel(false));
  $("#newChat").addEventListener("click", () => {
    if (main.classList.contains("spot-active")) showPanel(false);
  });
  $("#conversationList").addEventListener("click", () => {
    if (main.classList.contains("spot-active")) showPanel(false);
  });

  function showPanel(open) {
    if (
      open &&
      (window.NalarAuth.authenticated === false ||
        !window.NalarAuth.authenticated)
    )
      return;
    if (open)
      state.title = $("#conversationTitle").textContent || "Percakapan baru";
    main.classList.toggle("spot-active", open);
    panel.hidden = !open;
    nav.setAttribute("aria-current", open ? "page" : "false");
    if (open) {
      $("#appShell").classList.remove("sidebar-open");
      $("#conversationTitle").textContent = "Analisis Binance Spot";
      loadStatus();
      checkButton.focus();
    } else {
      $("#conversationTitle").textContent = state.title;
      $("#promptInput").focus({ preventScroll: true });
    }
  }

  window.NalarAuth.ready.then((authenticated) => {
    if (authenticated) loadStatus();
  });
})();
