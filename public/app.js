const app = document.querySelector("#app");
const state = {
  token: localStorage.getItem("token"),
  user: JSON.parse(localStorage.getItem("user") || "null")
};

const fallbackImage = "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80";

function setSession(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  syncNav();
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  syncNav();
}

function syncNav() {
  document.querySelectorAll(".auth-only").forEach(el => {
    el.style.display = state.user ? "" : "none";
  });
  document.querySelectorAll(".guest-only").forEach(el => {
    el.style.display = state.user ? "none" : "";
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function route(name, params = {}) {
  const encoded = new URLSearchParams(params).toString();
  location.hash = encoded ? `${name}?${encoded}` : name;
}

function getRoute() {
  const [name = "home", query = ""] = location.hash.replace("#", "").split("?");
  return { name: name || "home", params: Object.fromEntries(new URLSearchParams(query)) };
}

function formatDate(value) {
  return new Date(`${value}Z`).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pageTitle(title, subtitle = "") {
  return `
    <section class="page-title">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </section>
  `;
}

function renderPostCard(post) {
  const template = document.querySelector("#postCardTemplate");
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector("img").src = post.imageUrl || fallbackImage;
  card.querySelector("img").alt = post.title;
  card.querySelector(".meta").textContent = `${post.author.name} · ${formatDate(post.createdAt)}`;
  card.querySelector("h2").textContent = post.title;
  card.querySelector("p").textContent = post.excerpt;
  const tags = card.querySelector(".tags");
  tags.innerHTML = post.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  card.querySelector("button").addEventListener("click", () => route("post", { id: post.id }));
  return card;
}

async function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Inkline</h1>
        <p>Write useful posts, manage your own articles, and keep the conversation going through comments.</p>
        <div class="actions">
          <button class="button primary" data-action="write">Write a post</button>
          <button class="button" data-action="dashboard">My dashboard</button>
        </div>
      </div>
      <div class="hero-panel"><strong>Full-stack content management with users, posts, APIs, and a relational database.</strong></div>
    </section>
    <section class="grid" id="postsGrid"></section>
  `;

  app.querySelector("[data-action='write']").addEventListener("click", () => route(state.user ? "new-post" : "login"));
  app.querySelector("[data-action='dashboard']").addEventListener("click", () => route(state.user ? "dashboard" : "login"));

  const { posts } = await api("/api/posts");
  const grid = app.querySelector("#postsGrid");
  if (!posts.length) {
    grid.outerHTML = `<div class="empty">No posts yet. Register or log in to publish the first article.</div>`;
    return;
  }
  posts.forEach(post => grid.appendChild(renderPostCard(post)));
}

function authForm(mode) {
  const isRegister = mode === "register";
  app.innerHTML = `
    ${pageTitle(isRegister ? "Create Account" : "Login", isRegister ? "Start writing and commenting with your own profile." : "Welcome back.")}
    <section class="panel">
      <form class="form compact">
        <div id="formError"></div>
        ${isRegister ? `<label>Name <input name="name" autocomplete="name" required /></label>` : ""}
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Password <input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="6" required /></label>
        <div class="actions">
          <button class="button primary" type="submit">${isRegister ? "Register" : "Login"}</button>
          <button class="button" type="button" data-switch>${isRegister ? "Use existing account" : "Create account"}</button>
        </div>
      </form>
    </section>
  `;

  app.querySelector("[data-switch]").addEventListener("click", () => route(isRegister ? "login" : "register"));
  app.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await api(`/api/${mode}`, { method: "POST", body: JSON.stringify(payload) });
      setSession(data);
      route("dashboard");
    } catch (error) {
      app.querySelector("#formError").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    }
  });
}

async function renderDashboard() {
  if (!state.user) return route("login");
  const { posts } = await api("/api/me");
  app.innerHTML = `
    ${pageTitle("Dashboard", `Manage posts for ${state.user.name}.`)}
    <div class="actions"><button class="button primary" data-new>New post</button></div>
    <section class="grid" id="postsGrid"></section>
  `;
  app.querySelector("[data-new]").addEventListener("click", () => route("new-post"));
  const grid = app.querySelector("#postsGrid");
  if (!posts.length) {
    grid.outerHTML = `<div class="empty">You have not published anything yet.</div>`;
    return;
  }
  posts.forEach(post => {
    const card = renderPostCard(post);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `
      <button class="button primary">Edit</button>
      <button class="button danger">Delete</button>
    `;
    actions.children[0].addEventListener("click", () => route("edit-post", { id: post.id }));
    actions.children[1].addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      renderDashboard();
    });
    card.querySelector(".post-body").appendChild(actions);
    grid.appendChild(card);
  });
}

async function postForm(postId = null) {
  if (!state.user) return route("login");
  let post = { title: "", content: "", tags: [], imageUrl: "" };
  if (postId) {
    const data = await api(`/api/posts/${postId}`);
    post = data.post;
    if (post.author.id !== state.user.id) return route("dashboard");
  }

  app.innerHTML = `
    ${pageTitle(postId ? "Edit Post" : "Create Post", "Add a title, body, optional image URL, and comma-separated tags.")}
    <section class="panel">
      <form class="form">
        <div id="formError"></div>
        <label>Title <input name="title" value="${escapeHtml(post.title)}" required /></label>
        <label>Image URL <input name="imageUrl" value="${escapeHtml(post.imageUrl || "")}" /></label>
        <label>Tags <input name="tags" value="${escapeHtml((post.tags || []).join(", "))}" placeholder="javascript, backend, design" /></label>
        <label>Content <textarea name="content" required>${escapeHtml(post.content)}</textarea></label>
        <div class="actions">
          <button class="button primary" type="submit">${postId ? "Save changes" : "Publish"}</button>
          <button class="button" type="button" data-cancel>Cancel</button>
        </div>
      </form>
    </section>
  `;

  app.querySelector("[data-cancel]").addEventListener("click", () => route("dashboard"));
  app.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (postId) {
        await api(`/api/posts/${postId}`, { method: "PUT", body: JSON.stringify(payload) });
        route("post", { id: postId });
      } else {
        const data = await api("/api/posts", { method: "POST", body: JSON.stringify(payload) });
        route("post", { id: data.id });
      }
    } catch (error) {
      app.querySelector("#formError").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    }
  });
}

async function renderPost(id) {
  const { post, comments } = await api(`/api/posts/${id}`);
  const canEdit = state.user && state.user.id === post.author.id;
  app.innerHTML = `
    <article class="article">
      <img class="article-image" src="${escapeHtml(post.imageUrl || fallbackImage)}" alt="${escapeHtml(post.title)}" />
      <div>
        <div class="meta">${escapeHtml(post.author.name)} · ${formatDate(post.createdAt)}</div>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="tags">${post.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        ${canEdit ? `<div class="actions"><button class="button primary" data-edit>Edit</button></div>` : ""}
      </div>
      <div class="article-content">${escapeHtml(post.content).replaceAll("\n", "<br />")}</div>
      <section class="panel">
        <h2>Comments</h2>
        <div id="commentNotice"></div>
        ${state.user ? `
          <form class="form" id="commentForm">
            <label>Add a comment <textarea name="body" required></textarea></label>
            <button class="button primary" type="submit">Comment</button>
          </form>
        ` : `<div class="notice">Log in to join the discussion.</div>`}
        <div class="comments" id="comments"></div>
      </section>
    </article>
  `;

  if (canEdit) app.querySelector("[data-edit]").addEventListener("click", () => route("edit-post", { id }));
  const list = app.querySelector("#comments");
  list.innerHTML = comments.length
    ? comments.map(comment => `
      <div class="comment">
        <div class="meta">${escapeHtml(comment.author.name)} · ${formatDate(comment.createdAt)}</div>
        <p>${escapeHtml(comment.body)}</p>
      </div>
    `).join("")
    : `<div class="empty">No comments yet.</div>`;

  const form = app.querySelector("#commentForm");
  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      await api(`/api/posts/${id}/comments`, { method: "POST", body: JSON.stringify(payload) });
      renderPost(id);
    });
  }
}

async function renderProfile() {
  if (!state.user) return route("login");
  const { posts } = await api("/api/me");
  app.innerHTML = `
    ${pageTitle("Profile", "Your account and publishing activity.")}
    <section class="panel">
      <h2>${escapeHtml(state.user.name)}</h2>
      <p class="meta">${escapeHtml(state.user.email)}</p>
      <p>You have published ${posts.length} post${posts.length === 1 ? "" : "s"}.</p>
    </section>
  `;
}

async function render() {
  syncNav();
  const { name, params } = getRoute();
  try {
    if (name === "register") return authForm("register");
    if (name === "login") return authForm("login");
    if (name === "dashboard") return renderDashboard();
    if (name === "new-post") return postForm();
    if (name === "edit-post") return postForm(params.id);
    if (name === "post") return renderPost(params.id);
    if (name === "profile") return renderProfile();
    return renderHome();
  } catch (error) {
    app.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

document.querySelectorAll("[data-route]").forEach(button => {
  button.addEventListener("click", () => route(button.dataset.route));
});

document.querySelector("#logoutBtn").addEventListener("click", () => {
  clearSession();
  route("home");
});

window.addEventListener("hashchange", render);
render();
