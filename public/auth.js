(() => {
  const $ = (selector) => document.querySelector(selector);
  const gate = $("#loginGate");
  const button = $("#loginButton");
  const message = $("#loginMessage");
  const shell = $("#appShell");
  const state = { csrfToken: "", authenticated: false, session: null };

  function showGate(text = "") {
    state.authenticated = false;
    state.csrfToken = "";
    shell.hidden = true;
    gate.hidden = false;
    message.textContent = text;
  }

  function showApp(session) {
    state.authenticated = true;
    state.csrfToken = session.csrfToken || "";
    state.session = session;
    gate.hidden = true;
    shell.hidden = false;
  }

  function responseError(response, fallback) {
    return response.json().then(
      (data) => data.error || fallback,
      () => fallback,
    );
  }

  async function postJson(path, body, csrf = "") {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(await responseError(response, "Permintaan login gagal."));
    return response.json();
  }

  async function initialize() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthState = params.get("state");
    if (code || oauthState) {
      try {
        if (!code || !oauthState)
          throw new Error("Callback login tidak lengkap. Silakan mulai lagi.");
        const result = await postJson("/api/auth/callback", {
          code,
          state: oauthState,
          origin: window.location.origin,
        });
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
        showApp(result);
        return true;
      } catch (error) {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
        showGate(error.message || "Login belum berhasil. Silakan coba lagi.");
        return false;
      }
    }

    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Sesi belum dapat diperiksa.");
      const session = await response.json();
      if (session.authenticated) {
        showApp(session);
        return true;
      }
      showGate(
        session.loginAvailable
          ? ""
          : "Login pemilik belum dikonfigurasi pada server.",
      );
      button.disabled = !session.loginAvailable;
      return false;
    } catch {
      showGate(
        "Koneksi ke layanan login belum tersedia. Periksa sambungan lalu muat ulang halaman.",
      );
      button.disabled = true;
      return false;
    }
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = "Menghubungkan ke login Manus…";
    try {
      const result = await postJson("/api/auth/start", {
        origin: window.location.origin,
      });
      window.location.assign(result.url);
    } catch (error) {
      message.textContent = error.message || "Login belum dapat dimulai.";
      button.disabled = false;
    }
  });

  const logout = $("#logoutButton");
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await postJson("/api/auth/logout", {}, state.csrfToken);
    } catch {
      // Always clear the browser view; the server cookie also expires naturally.
    }
    showGate("Kamu sudah keluar dari Nalar.");
    window.location.reload();
  });

  window.NalarAuth = {
    ready: null,
    get csrfToken() {
      return state.csrfToken;
    },
    get authenticated() {
      return state.authenticated;
    },
    expire() {
      showGate("Sesi berakhir. Masuk kembali untuk melanjutkan.");
    },
  };
  window.NalarAuth.ready = initialize();
})();
