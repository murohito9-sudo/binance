(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const nav = $("#spotNav");
  const back = $("#spotBack");
  const main = $(".main-area");
  const panel = $("#spotPanel");
  const status = $("#spotStatus");
  const syncButton = $("#syncBinance");
  const balanceTable = $("#spotBalances");
  const assetSelect = $("#spotAsset");
  const form = $("#spotAnalysisForm");
  const result = $("#spotResult");
  const state = {
    balances: [],
    title: "Percakapan baru",
    synced: false,
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
      syncButton.focus();
    } else {
      $("#conversationTitle").textContent = state.title;
      $("#promptInput").focus({ preventScroll: true });
    }
  }

  function setStatus(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  async function loadStatus() {
    try {
      const data = await request("/api/binance/status");
      if (data.configured) {
        setStatus(
          "Kredensial tersedia di server. Sinkronisasi hanya berjalan saat kamu menekan tombol.",
          "good",
        );
        syncButton.disabled = false;
      } else {
        setStatus(
          "Koneksi Binance belum dikonfigurasi. Sinkronisasi dinonaktifkan sampai API key baca-saja dan kunci Ed25519 disimpan sebagai secrets proyek.",
          "warning",
        );
        syncButton.disabled = true;
      }
    } catch (error) {
      setStatus(error.message, "warning");
      syncButton.disabled = true;
    }
  }

  function renderBalances(data) {
    state.balances = data.balances || [];
    state.synced = true;
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
    setStatus(
      `Saldo dibaca dari ${data.source} · ${stamp}. Data ini hanya ada di sesi browser ini dan tidak disimpan.`,
      "good",
    );
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
        values.textContent = `Level skenario ${scenario.stopPrice} USDT · jarak ${scenario.distancePct}% · estimasi rugi ${scenario.estimatedLossUsdt} USDT${scenario.overRiskBudget ? " · MELEBIHI batas risiko" : " · dalam batas risiko"}${scenario.aboveEntry ? " · level di atas harga masuk; rugi terhadap entry dihitung 0 sebelum biaya" : ""}.`;
      }
      card.append(heading, values);
      cards.append(card);
    });
    const notice = document.createElement("p");
    notice.className = "spot-disclaimer";
    notice.textContent = data.note;
    result.append(title, metadata, summary, cards, notice);
  }

  syncButton.addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    syncButton.disabled = true;
    setStatus("Meminta saldo Spot baca-saja dari Binance…", "info");
    try {
      renderBalances(await request("/api/binance/sync", "POST"));
    } catch (error) {
      setStatus(error.message, "warning");
    } finally {
      state.busy = false;
      syncButton.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.synced)
      return setStatus(
        "Sinkronkan saldo terlebih dahulu; Nalar tidak menerima saldo ketikan dari browser.",
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
  window.NalarAuth.ready.then((authenticated) => {
    if (authenticated) loadStatus();
  });
})();
