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

function canWritePosts() {
  return state.user && ["writer", "admin"].includes(state.user.role);
}

function isAdmin() {
  return state.user && state.user.role === "admin";
}

function syncNav() {
  document.querySelectorAll(".auth-only").forEach(el => {
    el.style.display = state.user ? "" : "none";
  });
  document.querySelectorAll(".guest-only").forEach(el => {
    el.style.display = state.user ? "none" : "";
  });
  document.querySelectorAll(".writer-only").forEach(el => {
    el.style.display = canWritePosts() ? "" : "none";
  });
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = isAdmin() ? "" : "none";
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

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON but received ${response.status} ${response.statusText}. Check the API route or deployment logs.`);
    }
  }

  if (!response.ok) throw new Error(data.error || data.message || "Something went wrong");
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

function userRoleLabel(user = state.user) {
  if (!user) return "guest";
  return user.role || "writer";
}

function canModifyPost(post) {
  return state.user && (isAdmin() || state.user.id === post.author.id);
}

function renderPostCard(post) {
  const template = document.querySelector("#postCardTemplate");
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector("img").src = post.imageUrl || fallbackImage;
  card.querySelector("img").alt = post.title;
  card.querySelector(".meta").textContent = `${post.author.name} - ${formatDate(post.createdAt)}`;
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
        <p>Write useful posts, manage articles by role, and keep the conversation going through comments.</p>
        <div class="actions">
          <button class="button primary" data-action="write">Write a post</button>
          <button class="button" data-action="dashboard">My dashboard</button>
        </div>
      </div>
      <div class="hero-panel"><strong>Full-stack content management with auth, roles, posts, comments, and reset flows.</strong></div>
    </section>
    <section class="grid" id="postsGrid"></section>
  `;

  app.querySelector("[data-action='write']").addEventListener("click", () => route(state.user ? "new-post" : "login"));
  app.querySelector("[data-action='dashboard']").addEventListener("click", () => route(state.user ? "dashboard" : "login"));

  const { posts } = await api("/api/posts");
  const grid = app.querySelector("#postsGrid");
  if (!posts.length) {
    grid.outerHTML = `<div class="empty">No posts yet. Register as a writer or log in as admin to publish.</div>`;
    return;
  }
  posts.forEach(post => grid.appendChild(renderPostCard(post)));
}

function authForm(mode) {
  const isRegister = mode === "register";
  app.innerHTML = `
    ${pageTitle(isRegister ? "Create Account" : "Login", isRegister ? "Choose reader for comments or writer for blog publishing." : "Welcome back.")}
    <section class="panel">
      <form class="form compact">
        <div id="formError"></div>
        ${isRegister ? `<label>Name <input name="name" autocomplete="name" required /></label>` : ""}
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Password <input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="6" required /></label>
        ${isRegister ? `
          <label>Account type
            <select name="role">
              <option value="writer">Blog writer</option>
              <option value="reader">Reader</option>
            </select>
          </label>
        ` : ""}
        <div class="actions">
          <button class="button primary" type="submit">${isRegister ? "Register" : "Login"}</button>
          <button class="button" type="button" data-switch>${isRegister ? "Use existing account" : "Create account"}</button>
          ${isRegister ? "" : `<button class="button" type="button" data-forgot>Forgot password</button>`}
        </div>
      </form>
    </section>
  `;

  app.querySelector("[data-switch]").addEventListener("click", () => route(isRegister ? "login" : "register"));
  const forgot = app.querySelector("[data-forgot]");
  if (forgot) forgot.addEventListener("click", () => route("forgot-password"));
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

function forgotPasswordForm() {
  app.innerHTML = `
    ${pageTitle("Forgot Password", "Generate a reset code for a local/dev account.")}
    <section class="panel">
      <form class="form compact">
        <div id="formMessage"></div>
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <button class="button primary" type="submit">Generate reset code</button>
      </form>
    </section>
  `;

  app.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await api("/api/forgot-password", { method: "POST", body: JSON.stringify(payload) });
      const tokenHtml = data.resetToken
        ? `<p><strong>Reset code:</strong> <code>${escapeHtml(data.resetToken)}</code></p>`
        : "";
      app.querySelector("#formMessage").innerHTML = `
        <div class="notice">
          ${escapeHtml(data.message)}
          ${tokenHtml}
          <button class="button primary" type="button" data-reset>Continue to reset</button>
        </div>
      `;
      app.querySelector("[data-reset]").addEventListener("click", () => route("reset-password", { email: payload.email, token: data.resetToken || "" }));
    } catch (error) {
      app.querySelector("#formMessage").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    }
  });
}

function resetPasswordForm(params = {}) {
  app.innerHTML = `
    ${pageTitle("Reset Password", "Use the reset code to set a new password.")}
    <section class="panel">
      <form class="form compact">
        <div id="formMessage"></div>
        <label>Email <input name="email" type="email" value="${escapeHtml(params.email || "")}" required /></label>
        <label>Reset code <input name="token" value="${escapeHtml(params.token || "")}" required /></label>
        <label>New password <input name="password" type="password" minlength="6" required /></label>
        <div class="actions">
          <button class="button primary" type="submit">Reset password</button>
          <button class="button" type="button" data-login>Back to login</button>
        </div>
      </form>
    </section>
  `;

  app.querySelector("[data-login]").addEventListener("click", () => route("login"));
  app.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await api("/api/reset-password", { method: "POST", body: JSON.stringify(payload) });
      app.querySelector("#formMessage").innerHTML = `<div class="notice">${escapeHtml(data.message)}</div>`;
      setTimeout(() => route("login"), 900);
    } catch (error) {
      app.querySelector("#formMessage").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    }
  });
}

async function renderDashboard() {
  if (!state.user) return route("login");
  const { posts } = await api("/api/me");
  app.innerHTML = `
    ${pageTitle("Dashboard", `${state.user.name} - ${userRoleLabel()}.`)}
    <div class="actions">
      ${canWritePosts() ? `<button class="button primary" data-new>New post</button>` : ""}
      ${isAdmin() ? `<button class="button" data-admin>Manage users</button>` : ""}
    </div>
    <section class="grid" id="postsGrid"></section>
  `;
  const newButton = app.querySelector("[data-new]");
  if (newButton) newButton.addEventListener("click", () => route("new-post"));
  const adminButton = app.querySelector("[data-admin]");
  if (adminButton) adminButton.addEventListener("click", () => route("admin"));

  const grid = app.querySelector("#postsGrid");
  if (!posts.length) {
    grid.outerHTML = `<div class="empty">No manageable posts yet.</div>`;
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
  if (!canWritePosts()) return route("dashboard");
  let post = { title: "", content: "", tags: [], imageUrl: "", author: {} };
  if (postId) {
    const data = await api(`/api/posts/${postId}`);
    post = data.post;
    if (!canModifyPost(post)) return route("dashboard");
  }

  app.innerHTML = `
    ${pageTitle(postId ? "Edit Post" : "Create Post", "Admins can manage all posts. Writers can manage their own posts.")}
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
  const editable = canModifyPost(post);
  app.innerHTML = `
    <article class="article">
      <img class="article-image" src="${escapeHtml(post.imageUrl || fallbackImage)}" alt="${escapeHtml(post.title)}" />
      <div>
        <div class="meta">${escapeHtml(post.author.name)} - ${formatDate(post.createdAt)}</div>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="tags">${post.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        ${editable ? `<div class="actions"><button class="button primary" data-edit>Edit</button></div>` : ""}
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

  if (editable) app.querySelector("[data-edit]").addEventListener("click", () => route("edit-post", { id }));
  const list = app.querySelector("#comments");
  list.innerHTML = comments.length
    ? comments.map(comment => `
      <div class="comment">
        <div class="meta">${escapeHtml(comment.author.name)} - ${formatDate(comment.createdAt)}</div>
        <p>${escapeHtml(comment.body)}</p>
      </div>
    `).join("")
    : `<div class="empty">No comments yet.</div>`;

  const form = app.querySelector("#commentForm");
  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      try {
        await api(`/api/posts/${id}/comments`, { method: "POST", body: JSON.stringify(payload) });
        renderPost(id);
      } catch (error) {
        app.querySelector("#commentNotice").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
      }
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
      <p class="meta">${escapeHtml(state.user.email)} - ${userRoleLabel()}</p>
      <p>You can ${canWritePosts() ? "write and manage blog posts" : "read posts and comment"}.</p>
      <p>You have ${posts.length} manageable post${posts.length === 1 ? "" : "s"}.</p>
    </section>
  `;
}

async function renderAdmin() {
  if (!state.user) return route("login");
  if (!isAdmin()) return route("dashboard");
  const { users } = await api("/api/users");
  app.innerHTML = `
    ${pageTitle("Admin", "Manage user roles.")}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
          <tbody>
            ${users.map(user => `
              <tr>
                <td>${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>
                  <select data-role="${user.id}">
                    ${["reader", "writer", "admin"].map(role => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("")}
                  </select>
                </td>
                <td><button class="button primary" data-save="${user.id}">Save</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div id="adminMessage"></div>
    </section>
  `;

  app.querySelectorAll("[data-save]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.save;
      const role = app.querySelector(`[data-role="${id}"]`).value;
      try {
        await api(`/api/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) });
        if (Number(id) === state.user.id) {
          state.user.role = role;
          localStorage.setItem("user", JSON.stringify(state.user));
          syncNav();
        }
        app.querySelector("#adminMessage").innerHTML = `<div class="notice">Role updated.</div>`;
      } catch (error) {
        app.querySelector("#adminMessage").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
      }
    });
  });
}

async function render() {
  syncNav();
  const { name, params } = getRoute();
  try {
    if (name === "register") return authForm("register");
    if (name === "login") return authForm("login");
    if (name === "forgot-password") return forgotPasswordForm();
    if (name === "reset-password") return resetPasswordForm(params);
    if (name === "dashboard") return renderDashboard();
    if (name === "new-post") return postForm();
    if (name === "edit-post") return postForm(params.id);
    if (name === "post") return renderPost(params.id);
    if (name === "profile") return renderProfile();
    if (name === "admin") return renderAdmin();
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
