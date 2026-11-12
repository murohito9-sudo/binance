(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_FILES = 4;
  const ALLOWED_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  const MODE_DESCRIPTIONS = {
    balanced: "Seimbang untuk kebutuhan sehari-hari",
    concise: "Ringkas untuk jawaban cepat",
    creative: "Kreatif untuk ide dan eksplorasi",
  };
  const state = {
    ownerId: getOwnerId(),
    conversationId: null,
    conversations: [],
    files: [],
    busy: false,
    uploading: false,
    controller: null,
    searchTimer: null,
    listRequestId: 0,
    messageRequestId: 0,
    lastUserMessageId: null,
    activeMode: ["balanced", "concise", "creative"].includes(
      localStorage.getItem("nalar:mode"),
    )
      ? localStorage.getItem("nalar:mode")
      : "balanced",
  };

  const ui = {
    shell: $("#appShell"),
    sidebar: $("#sidebar"),
    sidebarScrim: $("#sidebarScrim"),
    openSidebar: $("#openSidebar"),
    closeSidebar: $("#closeSidebar"),
    newChat: $("#newChat"),
    search: $("#searchInput"),
    conversationList: $("#conversationList"),
    historyCount: $("#historyCount"),
    conversationTitle: $("#conversationTitle"),
    renameCurrent: $("#renameCurrent"),
    mode: $("#modeSelect"),
    modeDescription: $("#modeDescription"),
    chatScroll: $("#chatScroll"),
    welcome: $("#welcomePanel"),
    messages: $("#messages"),
    form: $("#composerForm"),
    input: $("#promptInput"),
    send: $("#sendButton"),
    attachButton: $("#attachButton"),
    fileInput: $("#fileInput"),
    tray: $("#attachmentTray"),
    composerZone: $("#composerZone"),
    dropOverlay: $("#dropOverlay"),
    toastRegion: $("#toastRegion"),
    renameDialog: $("#renameDialog"),
    renameForm: $("#renameForm"),
    renameInput: $("#renameInput"),
    privacyDialog: $("#privacyDialog"),
  };

  function getOwnerId() {
    let id = localStorage.getItem("nalar:visitor");
    if (!id) {
      id =
        globalThis.crypto?.randomUUID?.() ||
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 3) | 8).toString(16);
        });
      localStorage.setItem("nalar:visitor", id);
    }
    return id;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body instanceof Blob
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      let message = `Permintaan gagal (${response.status}).`;
      try {
        message = (await response.json()).error || message;
      } catch {
        /* response can be text */
      }
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }

  function toast(message, kind = "default") {
    const item = document.createElement("div");
    item.className = `toast ${kind === "error" ? "error" : ""}`;
    item.textContent = message;
    ui.toastRegion.append(item);
    window.setTimeout(() => item.remove(), 4300);
  }

  function setSidebar(open) {
    ui.shell.classList.toggle("sidebar-open", open);
    if (open) ui.closeSidebar.focus();
  }

  function safeFileName(name) {
    return String(name || "Lampiran")
      .replace(/[\\/\u0000-\u001f]/g, "_")
      .slice(0, 140);
  }

  function formatBytes(size) {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function fileIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/></svg>';
  }

  function renderFileTray() {
    ui.tray.replaceChildren();
    ui.tray.hidden = state.files.length === 0;
    state.files.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-preview";
      const icon = document.createElement("span");
      icon.className = "attachment-preview-icon";
      icon.innerHTML = fileIcon();
      const info = document.createElement("span");
      info.className = "attachment-preview-text";
      const name = document.createElement("strong");
      name.textContent = safeFileName(file.name);
      const size = document.createElement("small");
      size.textContent = formatBytes(file.size);
      info.append(name, size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-attachment";
      remove.dataset.removeFile = String(index);
      remove.setAttribute("aria-label", `Lepaskan ${safeFileName(file.name)}`);
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      chip.append(icon, info, remove);
      ui.tray.append(chip);
    });
  }

  function addFiles(fileList) {
    if (state.busy || state.uploading)
      return toast(
        "Tunggu sampai pengiriman saat ini selesai sebelum menambah lampiran.",
      );
    const incoming = [...fileList];
    for (const file of incoming) {
      if (!ALLOWED_TYPES.has(file.type)) {
        toast(
          `${safeFileName(file.name)}: format belum didukung. Gunakan PDF, PNG, JPEG, atau WebP.`,
          "error",
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast(`${safeFileName(file.name)} melebihi batas 10 MB.`, "error");
        continue;
      }
      if (state.files.length >= MAX_FILES) {
        toast(`Maksimal ${MAX_FILES} berkas untuk satu pesan.`, "error");
        break;
      }
      if (
        state.files.some(
          (existing) =>
            existing.name === file.name && existing.size === file.size,
        )
      )
        continue;
      state.files.push(file);
    }
    renderFileTray();
    ui.fileInput.value = "";
  }

  function escapeHtml(text) {
    return String(text).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }

  function inlineMarkdown(text) {
    let value = text;
    value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
    value = value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    value = value.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, href) => {
        const safeHref = href
          .replace(/&amp;/g, "&")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      },
    );
    return value;
  }

  function renderMarkdown(source) {
    const codeBlocks = [];
    let text = escapeHtml(source || "");
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const token = `\u0000CODE${codeBlocks.length}\u0000`;
      const language = /^[\w+-]{1,24}$/.test(lang)
        ? ` data-language="${lang}"`
        : "";
      codeBlocks.push(
        `<pre${language}><code>${code.replace(/\n$/, "")}</code></pre>`,
      );
      return token;
    });
    const lines = text.split("\n");
    const output = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];
    const closeList = () => {
      if (!listType) return;
      output.push(
        `<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`,
      );
      listType = null;
      listItems = [];
    };
    const closeParagraph = () => {
      if (paragraph.length) {
        output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
        paragraph = [];
      }
    };
    for (const line of lines) {
      const tokenMatch = line.match(/^\u0000CODE(\d+)\u0000$/);
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const quote = line.match(/^&gt;\s?(.*)$/);
      if (!line.trim()) {
        closeParagraph();
        closeList();
        continue;
      }
      if (tokenMatch) {
        closeParagraph();
        closeList();
        output.push(codeBlocks[Number(tokenMatch[1])]);
        continue;
      }
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (bullet || ordered) {
        closeParagraph();
        const nextType = bullet ? "ul" : "ol";
        if (listType && listType !== nextType) closeList();
        listType = nextType;
        listItems.push((bullet || ordered)[1]);
        continue;
      }
      if (quote) {
        closeParagraph();
        closeList();
        output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }
      closeList();
      paragraph.push(line);
    }
    closeParagraph();
    closeList();
    return output.join("");
  }

  function fileChips(files) {
    if (!Array.isArray(files) || !files.length) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "message-attachments";
    files.forEach((file) => {
      const chip = document.createElement("span");
      chip.className = "file-chip";
      chip.innerHTML = fileIcon();
      const name = document.createElement("span");
      name.textContent = safeFileName(file.name);
      chip.append(name);
      wrapper.append(chip);
    });
    return wrapper;
  }

  function actionIcon(name) {
    const icons = {
      copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
      like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3Zm0 0 5-8a3 3 0 0 1 2 3l-1 5h6a3 3 0 0 1 3 4l-2 8H7"/></svg>',
      dislike:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3Zm0 0 5 8a3 3 0 0 0 2-3l-1-5h6a3 3 0 0 0 3-4l-2-8H7"/></svg>',
      redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg>',
    };
    return icons[name];
  }

  function makeTool(label, action, icon, message, feedbackValue = null) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-tool";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.dataset.action = action;
    button.dataset.messageId = message.id || "";
    if (action === "feedback") button.dataset.feedback = String(feedbackValue);
    button.innerHTML = icon;
    if (action === "feedback" && message.feedback === feedbackValue)
      button.classList.add("selected");
    return button;
  }

  function makeMessage(message, options = {}) {
    const role = message.role === "user" ? "user" : "assistant";
    const row = document.createElement("article");
    row.className = `message ${role}${options.streaming ? " streaming" : ""}`;
    row.dataset.messageId = message.id || "";
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML =
      role === "user"
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
        : '<svg viewBox="0 0 32 32"><path d="M8 23V9l16 14V9"/></svg>';
    const body = document.createElement("div");
    body.className = "message-body";
    const header = document.createElement("div");
    header.className = "message-header";
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = role === "user" ? "Kamu" : "Nalar";
    header.append(author);
    const content = document.createElement("div");
    content.className = "message-content";
    if (options.thinking) {
      content.innerHTML =
        '<div class="thinking-row"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="loading-label">Sedang menyusun jawaban…</span></div>';
    } else {
      content.innerHTML = renderMarkdown(message.content || "");
    }
    body.append(header);
    const attachments = fileChips(message.attachments);
    if (attachments) body.append(attachments);
    body.append(content);
    if (role === "assistant" && !options.streaming) {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      tools.append(
        makeTool("Salin jawaban", "copy", actionIcon("copy"), message),
        makeTool("Suka jawaban", "feedback", actionIcon("like"), message, 1),
        makeTool(
          "Kurang membantu",
          "feedback",
          actionIcon("dislike"),
          message,
          -1,
        ),
      );
      if (options.lastAssistant)
        tools.append(
          makeTool(
            "Buat ulang jawaban",
            "regenerate",
            actionIcon("redo"),
            message,
          ),
        );
      body.append(tools);
    }
    row.append(avatar, body);
    return row;
  }

  function appendMessage(message, options) {
    const node = makeMessage(message, options);
    ui.messages.append(node);
    scrollToBottom();
    return node;
  }

  function scrollToBottom() {
    requestAnimationFrame(() =>
      ui.chatScroll.scrollTo({
        top: ui.chatScroll.scrollHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      }),
    );
  }

  function showWelcome(show) {
    ui.welcome.hidden = !show;
    ui.messages.hidden = show;
    if (show) ui.messages.replaceChildren();
  }

  function normalizeAttachments(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function loadMessages(id) {
    const requestId = ++state.messageRequestId;
    const result = await api(
      `/api/conversations/${encodeURIComponent(id)}/messages?ownerId=${encodeURIComponent(state.ownerId)}`,
    );
    if (requestId !== state.messageRequestId || id !== state.conversationId)
      return;
    ui.messages.replaceChildren();
    const messages = result.messages || [];
    state.lastUserMessageId =
      [...messages].reverse().find((message) => message.role === "user")?.id ||
      null;
    const lastAssistantId = [...messages]
      .reverse()
      .find((message) => message.role === "assistant")?.id;
    messages.forEach((message) =>
      appendMessage(
        { ...message, attachments: normalizeAttachments(message.attachments) },
        { lastAssistant: message.id === lastAssistantId },
      ),
    );
    showWelcome(messages.length === 0);
    scrollToBottom();
  }

  function conversationIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-4-.9L3 21l1.6-4.4A8.4 8.4 0 1 1 21 11.5Z"/></svg>';
  }

  function renderConversationList() {
    ui.conversationList.replaceChildren();
    ui.historyCount.textContent = state.conversations.length
      ? String(state.conversations.length)
      : "";
    if (!state.conversations.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = ui.search.value.trim()
        ? "Tidak ada percakapan yang cocok."
        : "Percakapanmu akan muncul di sini.";
      ui.conversationList.append(empty);
      return;
    }
    for (const convo of state.conversations) {
      const row = document.createElement("div");
      row.className = `conversation-item${convo.id === state.conversationId ? " active" : ""}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "conversation-item-main";
      open.dataset.openConversation = convo.id;
      open.title = convo.title;
      open.innerHTML = conversationIcon();
      const title = document.createElement("span");
      title.textContent = convo.title || "Percakapan baru";
      open.append(title);
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "history-action";
      rename.dataset.renameConversation = convo.id;
      rename.setAttribute("aria-label", `Ubah nama ${convo.title}`);
      rename.title = "Ubah nama";
      rename.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20H4v-4z"/></svg>';
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "history-action";
      remove.dataset.deleteConversation = convo.id;
      remove.setAttribute("aria-label", `Hapus ${convo.title}`);
      remove.title = "Hapus";
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>';
      row.append(open, rename, remove);
      ui.conversationList.append(row);
    }
  }

  async function loadConversations() {
    const requestId = ++state.listRequestId;
    const q = ui.search.value.trim();
    const result = await api(
      `/api/conversations?ownerId=${encodeURIComponent(state.ownerId)}&q=${encodeURIComponent(q)}`,
    );
    if (requestId !== state.listRequestId) return;
    state.conversations = result.conversations || [];
    renderConversationList();
  }

  function selectedConversation() {
    return state.conversations.find((item) => item.id === state.conversationId);
  }

  function setTitle(title) {
    ui.conversationTitle.textContent = title || "Percakapan baru";
    ui.renameCurrent.hidden = !state.conversationId;
  }

  async function openConversation(id) {
    if (state.busy || state.uploading)
      return toast(
        "Selesaikan unggahan atau hentikan jawaban sebelum berpindah percakapan.",
      );
    state.conversationId = id;
    const item = state.conversations.find((convo) => convo.id === id);
    if (item?.mode && ["balanced", "concise", "creative"].includes(item.mode)) {
      state.activeMode = item.mode;
      ui.mode.value = item.mode;
      ui.modeDescription.textContent = MODE_DESCRIPTIONS[item.mode];
      localStorage.setItem("nalar:mode", item.mode);
    }
    setTitle(item?.title);
    setSidebar(false);
    showWelcome(false);
    try {
      await loadMessages(id);
      renderConversationList();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function startNewChat(focus = true) {
    if (state.busy || state.uploading)
      return toast(
        "Selesaikan unggahan atau hentikan jawaban sebelum memulai percakapan baru.",
      );
    state.messageRequestId += 1;
    state.conversationId = null;
    state.lastUserMessageId = null;
    state.files = [];
    renderFileTray();
    ui.input.value = "";
    resizeInput();
    setTitle("Percakapan baru");
    showWelcome(true);
    renderConversationList();
    setSidebar(false);
    if (focus) ui.input.focus();
  }

  async function ensureConversation(title = "Percakapan baru") {
    if (state.conversationId) return state.conversationId;
    const result = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        ownerId: state.ownerId,
        title: title.slice(0, 120),
        mode: state.activeMode,
      }),
    });
    state.conversationId = result.conversation.id;
    setTitle(result.conversation.title);
    await loadConversations();
    renderConversationList();
    return state.conversationId;
  }

  async function uploadFile(file, conversationId) {
    const query = new URLSearchParams({
      ownerId: state.ownerId,
      conversationId,
      name: safeFileName(file.name),
    });
    const response = await fetch(`/api/uploads?${query}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      let message = `Gagal mengunggah ${safeFileName(file.name)}.`;
      try {
        message = (await response.json()).error || message;
      } catch {
        /* no JSON body */
      }
      throw new Error(message);
    }
    return response.json();
  }

  function updateSendButton() {
    if (state.busy) {
      ui.send.classList.add("loading", "stop-mode");
      ui.send.type = "button";
      ui.send.setAttribute("aria-label", "Hentikan jawaban");
      ui.send.title = "Hentikan jawaban";
    } else if (state.uploading) {
      ui.send.classList.add("loading");
      ui.send.classList.remove("stop-mode");
      ui.send.type = "button";
      ui.send.setAttribute("aria-label", "Mengunggah lampiran");
      ui.send.title = "Mengunggah lampiran";
      ui.send.disabled = true;
    } else {
      ui.send.classList.remove("loading", "stop-mode");
      ui.send.type = "submit";
      ui.send.setAttribute("aria-label", "Kirim pesan");
      ui.send.title = "Kirim pesan";
      ui.send.disabled = !ui.input.value.trim() && state.files.length === 0;
    }
  }

  function resizeInput() {
    ui.input.style.height = "auto";
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 180)}px`;
    updateSendButton();
  }

  function parseSseBlock(block) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async function streamChat({
    prompt = "",
    attachments = [],
    regenerateFor = null,
    showUser = true,
  }) {
    if (state.busy) return;
    state.busy = true;
    state.controller = new AbortController();
    updateSendButton();
    ui.input.disabled = true;
    ui.attachButton.disabled = true;
    showWelcome(false);
    const streamingNode = appendMessage(
      { role: "assistant", content: "" },
      { thinking: true, streaming: true },
    );
    let streamContent = "";
    let userMessageId = regenerateFor;
    let conversationId = state.conversationId;
    let gotMeta = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: state.controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: state.ownerId,
          conversationId,
          prompt,
          attachments,
          mode: state.activeMode,
          regenerateFor,
        }),
      });
      if (!response.ok) {
        let message = `Layanan belum dapat menjawab (${response.status}).`;
        try {
          message = (await response.json()).error || message;
        } catch {
          /* response might not be JSON */
        }
        throw new Error(message);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.type === "meta") {
            gotMeta = true;
            conversationId = event.conversationId;
            state.conversationId = conversationId;
            userMessageId = event.userMessageId || userMessageId;
            state.lastUserMessageId = userMessageId;
            setTitle(
              event.title || selectedConversation()?.title || "Percakapan baru",
            );
            if (showUser && !regenerateFor) {
              const userNode = makeMessage({
                id: userMessageId,
                role: "user",
                content: event.prompt || prompt,
                attachments:
                  event.attachments ||
                  attachments.map((item) => ({ name: item.name })),
              });
              ui.messages.insertBefore(userNode, streamingNode);
              ui.input.value = "";
              state.files = [];
              renderFileTray();
              resizeInput();
              showWelcome(false);
            }
            await loadConversations();
          } else if (event.type === "delta") {
            streamContent += event.text || "";
            if (streamingNode.isConnected) {
              const content = $(".message-content", streamingNode);
              content.innerHTML = renderMarkdown(streamContent);
              streamingNode.classList.add("assistant");
              $(".message-avatar", streamingNode).innerHTML =
                '<svg viewBox="0 0 32 32"><path d="M8 23V9l16 14V9"/></svg>';
              scrollToBottom();
            }
          } else if (event.type === "error") {
            throw new Error(event.message || "Jawaban tidak dapat dibuat.");
          } else if (event.type === "done") {
            if (!streamContent.trim())
              throw new Error("Model belum mengembalikan jawaban. Coba lagi.");
            streamingNode.remove();
            if (regenerateFor) await loadMessages(conversationId);
            else
              appendMessage(
                {
                  id: event.messageId,
                  role: "assistant",
                  content: streamContent,
                },
                { lastAssistant: true },
              );
            showWelcome(false);
            await loadConversations();
          }
        }
      }
      if (!streamContent.trim() && !state.controller.signal.aborted)
        throw new Error("Aliran jawaban terputus sebelum teks diterima.");
      if (state.controller.signal.aborted) {
        streamingNode.remove();
        if (showUser && !regenerateFor && gotMeta)
          toast("Jawaban dihentikan. Pesanmu tetap tersimpan.");
      }
    } catch (error) {
      streamingNode.remove();
      if (error.name === "AbortError") {
        if (showUser && gotMeta)
          toast("Jawaban dihentikan. Pesanmu tetap tersimpan.");
      } else {
        toast(
          error.message || "Terjadi gangguan saat meminta jawaban.",
          "error",
        );
        const retryId = userMessageId;
        if (!regenerateFor && showUser && gotMeta) {
          const errorNode = document.createElement("article");
          errorNode.className = "message assistant";
          const avatar = document.createElement("div");
          avatar.className = "message-avatar";
          avatar.setAttribute("aria-hidden", "true");
          avatar.innerHTML =
            '<svg viewBox="0 0 32 32"><path d="M8 23V9l16 14V9"/></svg>';
          const body = document.createElement("div");
          body.className = "message-body";
          const card = document.createElement("div");
          card.className = "error-card";
          card.textContent = error.message || "Jawaban belum tersedia.";
          const retry = document.createElement("button");
          retry.type = "button";
          retry.dataset.retry = retryId || "";
          retry.textContent = "Coba lagi";
          card.append(document.createElement("br"), retry);
          body.append(card);
          errorNode.append(avatar, body);
          ui.messages.append(errorNode);
        }
      }
    } finally {
      state.busy = false;
      state.controller = null;
      ui.input.disabled = false;
      ui.attachButton.disabled = false;
      ui.input.focus();
      updateSendButton();
    }
  }

  async function sendCurrentMessage() {
    if (state.busy || state.uploading) return;
    const prompt = ui.input.value.trim();
    const files = [...state.files];
    if (!prompt && files.length === 0) return;
    if (files.length > MAX_FILES)
      return toast(`Maksimal ${MAX_FILES} berkas.`, "error");
    state.uploading = true;
    ui.input.disabled = true;
    ui.attachButton.disabled = true;
    updateSendButton();
    try {
      const titleSeed =
        prompt || files.map((file) => file.name).join(", ") || "Berkas baru";
      const conversationId = await ensureConversation(titleSeed.slice(0, 70));
      const uploaded = [];
      for (let index = 0; index < files.length; index++) {
        $(".composer-hint").textContent =
          `Mengunggah ${index + 1}/${files.length}…`;
        uploaded.push(await uploadFile(files[index], conversationId));
      }
      $(".composer-hint").textContent = "PDF atau gambar, maks. 10 MB";
      const effectivePrompt =
        prompt ||
        (uploaded.length
          ? "Tolong jelaskan isi berkas yang saya lampirkan."
          : "");
      showWelcome(false);
      await streamChat({ prompt: effectivePrompt, attachments: uploaded });
    } catch (error) {
      $(".composer-hint").textContent = "PDF atau gambar, maks. 10 MB";
      toast(error.message || "Pesan belum dapat dikirim.", "error");
    } finally {
      state.uploading = false;
      ui.input.disabled = false;
      ui.attachButton.disabled = false;
      updateSendButton();
    }
  }

  async function renameConversation(id, initialTitle = "") {
    const conversation = state.conversations.find((item) => item.id === id);
    ui.renameInput.value = initialTitle || conversation?.title || "";
    ui.renameDialog.dataset.conversationId = id;
    ui.renameDialog.showModal();
    requestAnimationFrame(() => {
      ui.renameInput.focus();
      ui.renameInput.select();
    });
  }

  async function deleteConversation(id) {
    if ((state.busy || state.uploading) && state.conversationId === id)
      return toast(
        "Selesaikan unggahan atau hentikan jawaban sebelum menghapus percakapan ini.",
      );
    const title =
      state.conversations.find((item) => item.id === id)?.title ||
      "percakapan ini";
    const ok = window.confirm(
      `Hapus “${title}”? Riwayat chat dihapus. Berkas yang sudah diunggah tidak otomatis terhapus dari penyimpanan.`,
    );
    if (!ok) return;
    try {
      await api(
        `/api/conversations/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(state.ownerId)}`,
        { method: "DELETE" },
      );
      if (state.conversationId === id) startNewChat(false);
      await loadConversations();
      toast("Riwayat percakapan dihapus.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function changeMode(mode) {
    if (!["balanced", "concise", "creative"].includes(mode)) return;
    state.activeMode = mode;
    localStorage.setItem("nalar:mode", mode);
    if (!state.conversationId) return;
    try {
      await api(
        `/api/conversations/${encodeURIComponent(state.conversationId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ownerId: state.ownerId, mode }),
        },
      );
      const current = selectedConversation();
      if (current) current.mode = mode;
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function setFeedbackButtonState(button, value) {
    const row = button.closest(".message-tools");
    if (!row) return;
    $$('[data-action="feedback"]', row).forEach((item) =>
      item.classList.toggle(
        "selected",
        Number(item.dataset.feedback) === value,
      ),
    );
  }

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendCurrentMessage();
  });
  ui.input.addEventListener("input", resizeInput);
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!state.busy) ui.form.requestSubmit();
    }
  });
  ui.send.addEventListener("click", () => {
    if (state.busy) state.controller?.abort();
  });
  ui.attachButton.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", (event) =>
    addFiles(event.target.files),
  );
  ui.tray.addEventListener("click", (event) => {
    if (state.busy || state.uploading)
      return toast(
        "Tunggu sampai pengiriman saat ini selesai sebelum melepas lampiran.",
      );
    const remove = event.target.closest("[data-remove-file]");
    if (!remove) return;
    state.files.splice(Number(remove.dataset.removeFile), 1);
    renderFileTray();
    updateSendButton();
  });
  ui.newChat.addEventListener("click", () => startNewChat());
  ui.openSidebar.addEventListener("click", () => setSidebar(true));
  ui.closeSidebar.addEventListener("click", () => setSidebar(false));
  ui.sidebarScrim.addEventListener("click", () => setSidebar(false));
  ui.privacyDialog.addEventListener("click", (event) => {
    if (event.target === ui.privacyDialog) ui.privacyDialog.close();
  });
  $("#privacyInfo").addEventListener("click", () =>
    ui.privacyDialog.showModal(),
  );
  ui.mode.value = state.activeMode;
  ui.modeDescription.textContent = MODE_DESCRIPTIONS[state.activeMode];
  ui.mode.addEventListener("change", (event) => {
    ui.modeDescription.textContent = MODE_DESCRIPTIONS[event.target.value];
    changeMode(event.target.value);
  });
  ui.search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(
      () => loadConversations().catch((error) => toast(error.message, "error")),
      220,
    );
  });
  ui.conversationList.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-conversation]");
    const rename = event.target.closest("[data-rename-conversation]");
    const remove = event.target.closest("[data-delete-conversation]");
    if (open) openConversation(open.dataset.openConversation);
    else if (rename) renameConversation(rename.dataset.renameConversation);
    else if (remove) deleteConversation(remove.dataset.deleteConversation);
  });
  ui.renameCurrent.addEventListener("click", () => {
    if (state.conversationId) renameConversation(state.conversationId);
  });
  ui.renameForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const id = ui.renameDialog.dataset.conversationId;
    const title = ui.renameInput.value.trim();
    if (!id || !title) return;
    try {
      await api(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerId: state.ownerId, title }),
      });
      ui.renameDialog.close();
      if (state.conversationId === id) setTitle(title);
      await loadConversations();
      toast("Nama percakapan diperbarui.");
    } catch (error) {
      toast(error.message, "error");
    }
  });
  ui.messages.addEventListener("click", async (event) => {
    const retry = event.target.closest("[data-retry]");
    if (retry) {
      const id = retry.dataset.retry;
      retry.disabled = true;
      await streamChat({ regenerateFor: id, showUser: false });
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const messageId = button.dataset.messageId;
    if (action === "copy") {
      const message = button.closest(".message");
      const text = $(".message-content", message)?.innerText || "";
      try {
        await navigator.clipboard.writeText(text);
        toast("Jawaban disalin.");
      } catch {
        toast("Tidak dapat menyalin otomatis di browser ini.", "error");
      }
    } else if (action === "feedback") {
      const value = Number(button.dataset.feedback);
      try {
        await api("/api/feedback", {
          method: "POST",
          body: JSON.stringify({ ownerId: state.ownerId, messageId, value }),
        });
        setFeedbackButtonState(button, value);
        toast(
          value === 1 ? "Terima kasih atas masukannya." : "Masukan dicatat.",
        );
      } catch (error) {
        toast(error.message, "error");
      }
    } else if (action === "regenerate") {
      const lastUser = [...$$(".message.user", ui.messages)].reverse()[0];
      if (!lastUser || !state.lastUserMessageId) {
        toast("Tidak dapat menemukan pesan untuk dibuat ulang.", "error");
        return;
      }
      await streamChat({
        regenerateFor: state.lastUserMessageId,
        showUser: false,
      });
    }
  });
  ui.welcome.addEventListener("click", (event) => {
    const card = event.target.closest("[data-prompt]");
    if (!card) return;
    ui.input.value = card.dataset.prompt;
    resizeInput();
    ui.form.requestSubmit();
  });
  ui.renameDialog.addEventListener("click", (event) => {
    if (event.target === ui.renameDialog) ui.renameDialog.close();
  });
  ui.composerZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropOverlay.classList.add("visible");
  });
  ui.composerZone.addEventListener("dragleave", (event) => {
    if (!ui.composerZone.contains(event.relatedTarget))
      ui.dropOverlay.classList.remove("visible");
  });
  ui.composerZone.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.dropOverlay.classList.remove("visible");
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      startNewChat();
    } else if (event.key === "/" && !editing) {
      event.preventDefault();
      ui.search.focus();
    } else if (
      event.key === "Escape" &&
      ui.shell.classList.contains("sidebar-open")
    ) {
      setSidebar(false);
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 800) setSidebar(false);
  });

  (async function init() {
    resizeInput();
    showWelcome(true);
    try {
      await loadConversations();
    } catch (error) {
      toast(`Riwayat belum dapat dimuat: ${error.message}`, "error");
    }
    ui.input.focus({ preventScroll: true });
  })();
})();
