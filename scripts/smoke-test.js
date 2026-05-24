const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-smoke-"));
const port = 3100 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${port}`;

const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTH_SECRET: "smoke-test-secret" },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", chunk => {
  output += chunk.toString();
});
server.stderr.on("data", chunk => {
  output += chunk.toString();
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${base}/api/posts`);
      if (response.ok) return;
    } catch {
      await wait(100);
    }
  }
  throw new Error(`Server did not start. Output:\n${output}`);
}

async function request(pathname, options = {}, token = "") {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  await waitForServer();

  const adminReg = await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ name: "Admin User", email: "admin@example.com", password: "secret123", role: "writer" })
  });
  assert(adminReg.response.status === 201, "first registration should succeed");
  assert(adminReg.data.user.role === "admin", "first user should become admin");

  const writerReg = await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ name: "Writer User", email: "writer@example.com", password: "secret123", role: "writer" })
  });
  assert(writerReg.response.status === 201, "writer registration should succeed");
  assert(writerReg.data.user.role === "writer", "writer role should be saved");

  const readerReg = await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ name: "Reader User", email: "reader@example.com", password: "secret123", role: "reader" })
  });
  assert(readerReg.response.status === 201, "reader registration should succeed");
  assert(readerReg.data.user.role === "reader", "reader role should be saved");

  const readerCreate = await request("/api/posts", {
    method: "POST",
    body: JSON.stringify({ title: "Nope", content: "Reader cannot write." })
  }, readerReg.data.token);
  assert(readerCreate.response.status === 403, "reader should not create posts");

  const created = await request("/api/posts", {
    method: "POST",
    body: JSON.stringify({ title: "Smoke Test Post", content: "Created by writer.", tags: "test,api" })
  }, writerReg.data.token);
  assert(created.response.status === 201, "writer should create post");

  const postId = created.data.id;
  const readerEdit = await request(`/api/posts/${postId}`, {
    method: "PUT",
    body: JSON.stringify({ title: "Reader Edit", content: "No." })
  }, readerReg.data.token);
  assert(readerEdit.response.status === 403, "reader should not edit post");

  const adminEdit = await request(`/api/posts/${postId}`, {
    method: "PUT",
    body: JSON.stringify({ title: "Admin Edited", content: "Admin can edit any post.", tags: "admin" })
  }, adminReg.data.token);
  assert(adminEdit.response.status === 200, "admin should edit any post");

  const comment = await request(`/api/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "Reader comment works." })
  }, readerReg.data.token);
  assert(comment.response.status === 201, "reader should comment");

  const forgot = await request("/api/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email: "writer@example.com" })
  });
  assert(forgot.response.status === 200, "forgot password should generate reset code");
  assert(forgot.data.resetToken, "forgot password should expose dev reset token");

  const reset = await request("/api/reset-password", {
    method: "POST",
    body: JSON.stringify({ email: "writer@example.com", token: forgot.data.resetToken, password: "newpass123" })
  });
  assert(reset.response.status === 200, "reset password should succeed");

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: "writer@example.com", password: "newpass123" })
  });
  assert(login.response.status === 200, "login should work with reset password");

  const users = await request("/api/users", { method: "GET" }, adminReg.data.token);
  assert(users.response.status === 200 && users.data.users.length === 3, "admin should list users");

  console.log("Smoke tests passed.");
}

run()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    server.kill();
    await new Promise(resolve => server.once("exit", resolve));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await wait(100);
      }
    }
  });
