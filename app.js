(function () {
  "use strict";

  var LS_ITEMS = "priorities.items";
  var LS_QUEUE = "priorities.queue";
  var LS_SHOW_DONE = "priorities.showDone";
  var LS_ADD_TOP = "priorities.addToTop";
  var STEP = 1024;

  var cfg = window.PRIORITIES_CONFIG || {};
  var syncConfigured = Boolean(cfg.supabaseUrl && cfg.supabaseKey);

  // ---------- storage ----------

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function now() { return new Date().toISOString(); }

  // ---------- state ----------

  var items = load(LS_ITEMS, []);   // {id, text, done, position, created_at, updated_at, done_at}
  var queue = load(LS_QUEUE, {});   // id -> {op: "upsert", row} | {op: "delete"}  (only while signed in)
  var showDone = load(LS_SHOW_DONE, false);
  var addToTop = load(LS_ADD_TOP, false);

  var client = null;
  var session = null;
  var channel = null;
  var syncState = "idle";
  var lastError = "";

  var dragging = false;
  var editingId = null;
  var renderPending = false;

  function byPosition(a, b) {
    return a.position - b.position || String(a.created_at).localeCompare(String(b.created_at));
  }
  function activeItems() { return items.filter(function (i) { return !i.done; }).sort(byPosition); }
  function doneItems() {
    return items.filter(function (i) { return i.done; })
      .sort(function (a, b) { return String(b.done_at || "").localeCompare(String(a.done_at || "")); });
  }
  function findItem(id) { return items.find(function (i) { return i.id === id; }); }
  function pendingCount() { return Object.keys(queue).length; }

  function persist() {
    store(LS_ITEMS, items);
    store(LS_QUEUE, queue);
  }

  // Every change goes through here: update local list, queue it for the server, redraw.
  function commit(changed, removedIds) {
    var t = now();
    changed.forEach(function (c) {
      c.updated_at = t;
      var idx = items.findIndex(function (i) { return i.id === c.id; });
      if (idx === -1) items.push(c); else items[idx] = c;
      if (session) queue[c.id] = { op: "upsert", row: c };
    });
    (removedIds || []).forEach(function (id) {
      items = items.filter(function (i) { return i.id !== id; });
      if (session) queue[id] = { op: "delete" };
    });
    persist();
    render();
    scheduleSync(400);
  }

  // ---------- actions ----------

  function addItem(text) {
    text = text.trim();
    if (!text) return null;
    var list = activeItems();
    var position;
    if (!list.length) position = STEP;
    else if (addToTop) position = list[0].position - STEP;
    else position = list[list.length - 1].position + STEP;
    var t = now();
    var item = { id: uuid(), text: text, done: false, position: position, created_at: t, updated_at: t, done_at: null };
    commit([item]);
    return item;
  }

  function toggleDone(id) {
    var it = findItem(id);
    if (!it) return;
    var done = !it.done;
    commit([Object.assign({}, it, { done: done, done_at: done ? now() : null })]);
  }

  function removeItems(ids, message) {
    var removed = items.filter(function (i) { return ids.indexOf(i.id) !== -1; });
    if (!removed.length) return;
    commit([], ids);
    showToast(message, function () {
      commit(removed.map(function (r) { return Object.assign({}, r); }));
    });
  }

  function reorderFromDom() {
    var changed = [];
    var rows = Array.prototype.filter.call(el.active.children, function (li) { return li.dataset.id; });
    rows.forEach(function (li, i) {
      var it = findItem(li.dataset.id);
      var position = (i + 1) * STEP;
      if (it && it.position !== position) changed.push(Object.assign({}, it, { position: position }));
    });
    if (changed.length) commit(changed); else render();
  }

  // ---------- rendering ----------

  var el = {};
  var ICONS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>'
  };

  function rowFor(it, rank) {
    var li = document.createElement("li");
    li.className = "item";
    li.dataset.id = it.id;
    if (rank) li.dataset.rank = String(rank);

    if (rank) {
      var r = document.createElement("span");
      r.className = "rank";
      r.textContent = String(rank);
      li.appendChild(r);
    }

    var check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.setAttribute("aria-label", it.done ? "Mark not done" : "Mark done");
    check.innerHTML = ICONS.check;
    li.appendChild(check);

    var text = document.createElement("span");
    text.className = "text";
    text.textContent = it.text;
    li.appendChild(text);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", "Delete");
    del.innerHTML = ICONS.del;
    li.appendChild(del);

    if (rank) {
      var handle = document.createElement("span");
      handle.className = "handle";
      handle.setAttribute("aria-label", "Drag to reorder");
      handle.innerHTML = ICONS.grip;
      li.appendChild(handle);
    }
    return li;
  }

  function render() {
    // Redrawing mid-drag or mid-edit would yank the row out from under the user.
    if (dragging || editingId) { renderPending = true; return; }
    renderPending = false;

    var active = activeItems();
    var done = doneItems();

    var frag = document.createDocumentFragment();
    active.forEach(function (it, i) { frag.appendChild(rowFor(it, i + 1)); });
    el.active.replaceChildren(frag);

    var dfrag = document.createDocumentFragment();
    done.forEach(function (it) { dfrag.appendChild(rowFor(it, 0)); });
    el.done.replaceChildren(dfrag);

    el.empty.hidden = active.length > 0;
    el.doneSection.hidden = done.length === 0;
    el.doneCount.textContent = String(done.length);
    el.done.hidden = !showDone;
    el.doneToggle.setAttribute("aria-expanded", String(showDone));

    if (!active.length && !done.length) el.summary.textContent = "";
    else if (!active.length) el.summary.textContent = "All done.";
    else el.summary.textContent = active.length + (active.length === 1 ? " thing" : " things") + " to do";

    el.where.innerHTML = (addToTop ? ICONS.up + "Top" : ICONS.down + "Bottom");
    el.where.title = addToTop ? "New tasks go to the top (tap to change)" : "New tasks go to the bottom (tap to change)";
  }

  function renderStatus() {
    var state, label;
    if (!syncConfigured) { state = "local"; label = "This device only"; }
    else if (!client) { state = "error"; label = "Sync unavailable"; }
    else if (!session) { state = "signed-out"; label = "Sign in to sync"; }
    else if (syncState === "syncing") { state = "syncing"; label = "Syncing…"; }
    else if (!navigator.onLine) { state = "offline"; label = pendingCount() ? "Offline · will sync" : "Offline"; }
    else if (syncState === "error") { state = "error"; label = "Sync problem"; }
    else if (pendingCount()) { state = "syncing"; label = "Syncing…"; }
    else { state = "synced"; label = "Synced"; }
    el.status.dataset.state = state;
    el.status.querySelector(".label").textContent = label;
  }

  function flash(id) {
    var li = el.active.querySelector('[data-id="' + id + '"]');
    if (!li) return;
    li.classList.add("flash");
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(function () { li.classList.remove("flash"); }, 1300);
  }

  // ---------- inline editing ----------

  function startEdit(li) {
    var id = li.dataset.id;
    var it = findItem(id);
    var span = li.querySelector(".text");
    if (!it || !span) return;
    editingId = id;

    var input = document.createElement("input");
    input.className = "edit";
    input.type = "text";
    input.maxLength = 500;
    input.value = it.text;
    input.setAttribute("enterkeyhint", "done");
    input.setAttribute("aria-label", "Edit task");
    span.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    var finished = false;
    function finish(save) {
      if (finished) return;
      finished = true;
      editingId = null;
      var cur = findItem(id);
      var v = input.value.trim();
      if (save && cur && v && v !== cur.text) commit([Object.assign({}, cur, { text: v })]);
      else render();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  // ---------- toast ----------

  var toastTimer = null;
  var toastUndo = null;

  function showToast(message, undo) {
    el.toastMsg.textContent = message;
    toastUndo = undo;
    el.toastUndo.hidden = !undo;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    el.toast.hidden = true;
    toastUndo = null;
  }

  // ---------- sync (Supabase) ----------

  var syncTimer = null;
  var syncing = null;
  var again = false;

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, delay || 0);
  }

  function sync() {
    if (!client || !session) { renderStatus(); return Promise.resolve(); }
    if (syncing) { again = true; return syncing; }
    syncing = (async function () {
      do {
        again = false;
        syncState = "syncing";
        renderStatus();
        try {
          await pushQueue();
          await pull();
          syncState = "synced";
          lastError = "";
        } catch (e) {
          console.warn("Sync failed:", e);
          syncState = "error";
          lastError = (e && e.message) || String(e);
          break;
        }
      } while (again);
      syncing = null;
      renderStatus();
    })();
    return syncing;
  }

  async function pushQueue() {
    var entries = Object.keys(queue).map(function (id) { return [id, queue[id]]; });
    if (!entries.length) return;
    var uid = session.user.id;
    var upserts = entries.filter(function (e) { return e[1].op === "upsert"; })
      .map(function (e) { return Object.assign({}, e[1].row, { user_id: uid }); });
    var deletes = entries.filter(function (e) { return e[1].op === "delete"; })
      .map(function (e) { return e[0]; });

    if (upserts.length) {
      var up = await client.from("todos").upsert(upserts);
      if (up.error) throw up.error;
    }
    if (deletes.length) {
      var del = await client.from("todos").delete().in("id", deletes);
      if (del.error) throw del.error;
    }
    // Only clear what was sent; anything edited again meanwhile stays queued.
    entries.forEach(function (e) { if (queue[e[0]] === e[1]) delete queue[e[0]]; });
    persist();
  }

  async function pull() {
    var res = await client.from("todos").select("id,text,done,position,created_at,updated_at,done_at");
    if (res.error) throw res.error;
    var map = new Map();
    res.data.forEach(function (r) { map.set(r.id, r); });
    // Local changes that haven't reached the server yet win.
    Object.keys(queue).forEach(function (id) {
      if (queue[id].op === "delete") map.delete(id); else map.set(id, queue[id].row);
    });
    items = Array.from(map.values());
    persist();
    render();
  }

  function subscribe() {
    if (channel || !client) return;
    channel = client.channel("todos-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, function () { scheduleSync(300); })
      .subscribe();
  }

  function unsubscribe() {
    if (channel) { client.removeChannel(channel); channel = null; }
  }

  function onSignedIn(newSession) {
    session = newSession;
    // Anything already on this device gets merged into the account.
    items.forEach(function (it) { queue[it.id] = { op: "upsert", row: it }; });
    persist();
    subscribe();
    sync();
  }

  async function signOut() {
    var n = pendingCount();
    if (n && !confirm(n + " change" + (n === 1 ? " hasn't" : "s haven't") + " synced yet and will be lost. Sign out anyway?")) return;
    unsubscribe();
    await client.auth.signOut();
    session = null;
    items = [];
    queue = {};
    persist();
    render();
    renderStatus();
    renderSheet();
  }

  // ---------- sync sheet ----------

  function openSheet() {
    renderSheet();
    el.sheet.hidden = false;
    var first = el.sheetBody.querySelector("input");
    if (first && window.matchMedia("(pointer: fine)").matches) first.focus();
  }

  function closeSheet() { el.sheet.hidden = true; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderSheet() {
    var body = el.sheetBody;
    if (!syncConfigured) {
      body.innerHTML =
        "<p>Your list is saved on this device only. To sync between your PC and iPhone, " +
        "add your Supabase project details to <code>config.js</code> (the steps are in <code>SETUP.md</code>).</p>";
      return;
    }
    if (!client) {
      body.innerHTML = "<p>The sync library didn't load. Check your internet connection and reopen the app.</p>";
      return;
    }
    if (session) {
      var n = pendingCount();
      body.innerHTML =
        "<p>Signed in as <strong>" + escapeHtml(session.user.email || "") + "</strong>. " +
        "Changes sync automatically to every device you sign in on.</p>" +
        (n ? "<p>" + n + " change" + (n === 1 ? "" : "s") + " waiting to sync.</p>" : "") +
        (lastError ? '<p class="msg error">Last sync error: ' + escapeHtml(lastError) + "</p>" : "") +
        '<div class="btn-row"><button type="button" class="btn" id="sync-now">Sync now</button>' +
        '<button type="button" class="btn" id="sign-out">Sign out</button></div>';
      body.querySelector("#sync-now").onclick = function () { sync().then(renderSheet); };
      body.querySelector("#sign-out").onclick = signOut;
      return;
    }
    body.innerHTML =
      "<p>Sign in with the same account on your PC, iPhone and iPod to share one list.</p>" +
      '<form id="auth-form">' +
      '<label for="auth-email">Email</label>' +
      '<input id="auth-email" type="email" autocomplete="email" autocapitalize="off" required>' +
      '<label for="auth-password">Password</label>' +
      '<input id="auth-password" type="password" autocomplete="current-password" minlength="6" required>' +
      '<div class="btn-row"><button type="submit" class="btn primary" id="sign-in">Sign in</button>' +
      '<button type="button" class="btn" id="sign-up">Create account</button></div>' +
      '<p class="msg" id="auth-msg"></p></form>';

    var form = body.querySelector("#auth-form");
    var msg = body.querySelector("#auth-msg");
    var buttons = body.querySelectorAll("button");

    async function run(kind) {
      var email = body.querySelector("#auth-email").value.trim();
      var password = body.querySelector("#auth-password").value;
      if (!email || password.length < 6) {
        msg.className = "msg error";
        msg.textContent = "Enter your email and a password of at least 6 characters.";
        return;
      }
      buttons.forEach(function (b) { b.disabled = true; });
      msg.className = "msg";
      msg.textContent = kind === "up" ? "Creating account…" : "Signing in…";
      var res = kind === "up"
        ? await client.auth.signUp({ email: email, password: password })
        : await client.auth.signInWithPassword({ email: email, password: password });
      buttons.forEach(function (b) { b.disabled = false; });
      if (res.error) {
        msg.className = "msg error";
        msg.textContent = res.error.message;
        return;
      }
      if (!res.data.session) {
        msg.className = "msg ok";
        msg.textContent = "Account created. Open the confirmation email, then come back and sign in.";
        return;
      }
      onSignedIn(res.data.session);
      closeSheet();
    }

    form.addEventListener("submit", function (e) { e.preventDefault(); run("in"); });
    body.querySelector("#sign-up").onclick = function () { run("up"); };
  }

  // ---------- wiring ----------

  function bind() {
    ["active", "done", "empty", "summary", "status", "toast"].forEach(function (id) { el[id] = document.getElementById(id); });
    el.addForm = document.getElementById("add-form");
    el.addInput = document.getElementById("add-input");
    el.where = document.getElementById("add-where");
    el.doneSection = document.getElementById("done-section");
    el.doneToggle = document.getElementById("done-toggle");
    el.doneCount = document.getElementById("done-count");
    el.clearDone = document.getElementById("clear-done");
    el.sheet = document.getElementById("sheet");
    el.sheetBody = document.getElementById("sheet-body");
    el.toastMsg = document.getElementById("toast-msg");
    el.toastUndo = document.getElementById("toast-undo");

    el.addForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var item = addItem(el.addInput.value);
      el.addInput.value = "";
      if (item) flash(item.id);
    });

    el.where.addEventListener("click", function () {
      addToTop = !addToTop;
      store(LS_ADD_TOP, addToTop);
      render();
    });

    function onListClick(e) {
      var li = e.target.closest(".item");
      if (!li) return;
      if (e.target.closest(".check")) toggleDone(li.dataset.id);
      else if (e.target.closest(".del")) removeItems([li.dataset.id], "Task deleted");
      else if (e.target.closest(".text") && li.parentNode === el.active) startEdit(li);
    }
    el.active.addEventListener("click", onListClick);
    el.done.addEventListener("click", onListClick);

    el.doneToggle.addEventListener("click", function () {
      showDone = !showDone;
      store(LS_SHOW_DONE, showDone);
      render();
    });

    el.clearDone.addEventListener("click", function () {
      var ids = doneItems().map(function (i) { return i.id; });
      removeItems(ids, ids.length === 1 ? "Cleared 1 task" : "Cleared " + ids.length + " tasks");
    });

    el.status.addEventListener("click", openSheet);
    el.sheet.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeSheet(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.sheet.hidden) closeSheet();
    });

    el.toastUndo.addEventListener("click", function () {
      var undo = toastUndo;
      hideToast();
      if (undo) undo();
    });

    if (window.Sortable) {
      window.Sortable.create(el.active, {
        handle: ".handle",
        animation: 160,
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 3,
        ghostClass: "ghost",
        dragClass: "drag",
        onStart: function () { dragging = true; },
        onEnd: function (evt) {
          dragging = false;
          if (evt.oldIndex !== evt.newIndex) reorderFromDom();
          else if (renderPending) render();
        }
      });
    }

    window.addEventListener("online", function () { renderStatus(); scheduleSync(0); });
    window.addEventListener("offline", renderStatus);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") scheduleSync(0);
    });

    if (window.matchMedia("(pointer: fine)").matches) el.addInput.focus();
  }

  async function init() {
    bind();
    render();

    if (syncConfigured && window.supabase) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "priorities.auth" }
      });
      client.auth.onAuthStateChange(function (event, s) {
        session = s;
        if (event === "SIGNED_OUT") unsubscribe();
        renderStatus();
      });
      var res = await client.auth.getSession();
      session = res.data.session;
      if (session) { subscribe(); sync(); }
    }
    renderStatus();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("Service worker failed:", e); });
    }
  }

  init();
})();
