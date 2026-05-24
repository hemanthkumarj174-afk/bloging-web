const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/blogging-platform" : path.join(__dirname, "data"));
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_PATH = path.join(DATA_DIR, "blog.sqlite");
const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'writer',
    reset_token_hash TEXT DEFAULT '',
    reset_expires_at INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    author_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'writer'");
ensureColumn("users", "reset_token_hash", "TEXT DEFAULT ''");
ensureColumn("users", "reset_expires_at", "INTEGER DEFAULT 0");

const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
const firstUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
if (!adminUser && firstUser) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

function createToken(user) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  });
  const data = `${header}.${payload}`;
  return `${data}.${sign(data)}`;
}

function getUserFromToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  const expected = sign(data);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return db.prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?").get(parsed.sub) || null;
  } catch {
    return null;
  }
}

function requireUser(req, res) {
  const user = getUserFromToken(req);
  if (!user) {
    json(res, 401, { error: "Authentication required" });
    return null;
  }
  return user;
}

function validateRequired(fields, body) {
  for (const field of fields) {
    if (!String(body[field] || "").trim()) return `${field} is required`;
  }
  return "";
}

function cleanRole(role) {
  return ["reader", "writer", "admin"].includes(role) ? role : "writer";
}

function canWritePosts(user) {
  return user && ["writer", "admin"].includes(user.role);
}

function canModifyPost(user, post) {
  return user && (user.role === "admin" || post.author_id === user.id);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at
  };
}

function postListRow(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.content.length > 180 ? `${row.content.slice(0, 180)}...` : row.content,
    content: row.content,
    tags: row.tags ? row.tags.split(",").map(tag => tag.trim()).filter(Boolean) : [],
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: row.author_id, name: row.author_name }
  };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/register") {
    const body = await readBody(req);
    const missing = validateRequired(["name", "email", "password"], body);
    if (missing) return json(res, 400, { error: missing });
    if (!String(body.email).includes("@")) return json(res, 400, { error: "A valid email is required" });
    if (String(body.password).length < 6) return json(res, 400, { error: "Password must be at least 6 characters" });

    try {
      const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
      const requestedRole = cleanRole(String(body.role || "writer"));
      const role = userCount === 0 ? "admin" : requestedRole === "admin" ? "writer" : requestedRole;
      const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(
        String(body.name).trim(),
        String(body.email).trim().toLowerCase(),
        hashPassword(String(body.password))
      );
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, result.lastInsertRowid);
      const user = db.prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?").get(result.lastInsertRowid);
      return json(res, 201, { token: createToken(user), user: publicUser(user) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return json(res, 409, { error: "Email is already registered" });
      throw error;
    }
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await readBody(req);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(body.email || "").trim().toLowerCase());
    if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) {
      return json(res, 401, { error: "Invalid email or password" });
    }
    return json(res, 200, {
      token: createToken(user),
      user: publicUser(user)
    });
  }

  if (method === "POST" && pathname === "/api/forgot-password") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (!user) {
      return json(res, 200, { message: "If that email exists, a reset code has been generated." });
    }

    const resetToken = crypto.randomBytes(18).toString("hex");
    const expiresAt = Date.now() + 15 * 60 * 1000;
    db.prepare("UPDATE users SET reset_token_hash = ?, reset_expires_at = ? WHERE id = ?").run(
      hashToken(resetToken),
      expiresAt,
      user.id
    );
    return json(res, 200, {
      message: "Reset code generated. In production this would be emailed.",
      resetToken,
      expiresAt
    });
  }

  if (method === "POST" && pathname === "/api/reset-password") {
    const body = await readBody(req);
    const missing = validateRequired(["email", "token", "password"], body);
    if (missing) return json(res, 400, { error: missing });
    if (String(body.password).length < 6) return json(res, 400, { error: "Password must be at least 6 characters" });

    const email = String(body.email || "").trim().toLowerCase();
    const user = db.prepare("SELECT id, reset_token_hash, reset_expires_at FROM users WHERE email = ?").get(email);
    if (!user || !user.reset_token_hash || user.reset_token_hash !== hashToken(String(body.token))) {
      return json(res, 400, { error: "Invalid reset code" });
    }
    if (Number(user.reset_expires_at) < Date.now()) {
      return json(res, 400, { error: "Reset code expired" });
    }

    db.prepare(`
      UPDATE users
      SET password_hash = ?, reset_token_hash = '', reset_expires_at = 0
      WHERE id = ?
    `).run(hashPassword(String(body.password)), user.id);
    return json(res, 200, { ok: true, message: "Password reset successful" });
  }

  if (method === "GET" && pathname === "/api/me") {
    const user = requireUser(req, res);
    if (!user) return;
    const sql = user.role === "admin" ? `
      SELECT posts.*, users.name AS author_name
      FROM posts
      JOIN users ON users.id = posts.author_id
      ORDER BY updated_at DESC
    ` : `
      SELECT posts.*, users.name AS author_name
      FROM posts
      JOIN users ON users.id = posts.author_id
      WHERE author_id = ?
      ORDER BY updated_at DESC
    `;
    const posts = user.role === "admin"
      ? db.prepare(sql).all().map(postListRow)
      : db.prepare(sql).all(user.id).map(postListRow);
    return json(res, 200, { user, posts });
  }

  if (method === "GET" && pathname === "/api/users") {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.role !== "admin") return json(res, 403, { error: "Admin access required" });
    const users = db.prepare("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC").all();
    return json(res, 200, { users });
  }

  const userRoleMatch = pathname.match(/^\/api\/users\/(\d+)\/role$/);
  if (userRoleMatch && method === "PUT") {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.role !== "admin") return json(res, 403, { error: "Admin access required" });
    const body = await readBody(req);
    const role = cleanRole(String(body.role || ""));
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, Number(userRoleMatch[1]));
    return json(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/posts") {
    const posts = db.prepare(`
      SELECT posts.*, users.name AS author_name
      FROM posts
      JOIN users ON users.id = posts.author_id
      ORDER BY posts.created_at DESC
    `).all().map(postListRow);
    return json(res, 200, { posts });
  }

  if (method === "POST" && pathname === "/api/posts") {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canWritePosts(user)) return json(res, 403, { error: "Only admins and blog writers can create posts" });
    const body = await readBody(req);
    const missing = validateRequired(["title", "content"], body);
    if (missing) return json(res, 400, { error: missing });

    const result = db.prepare(`
      INSERT INTO posts (title, content, tags, image_url, author_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(body.title).trim(),
      String(body.content).trim(),
      String(body.tags || "").trim(),
      String(body.imageUrl || "").trim(),
      user.id
    );
    return json(res, 201, { id: result.lastInsertRowid });
  }

  const postMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch && method === "GET") {
    const post = db.prepare(`
      SELECT posts.*, users.name AS author_name
      FROM posts
      JOIN users ON users.id = posts.author_id
      WHERE posts.id = ?
    `).get(Number(postMatch[1]));
    if (!post) return json(res, 404, { error: "Post not found" });

    const comments = db.prepare(`
      SELECT comments.*, users.name AS author_name
      FROM comments
      JOIN users ON users.id = comments.author_id
      WHERE post_id = ?
      ORDER BY comments.created_at ASC
    `).all(post.id).map(comment => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      author: { id: comment.author_id, name: comment.author_name }
    }));
    return json(res, 200, { post: postListRow(post), comments });
  }

  if (postMatch && (method === "PUT" || method === "DELETE")) {
    const user = requireUser(req, res);
    if (!user) return;

    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(Number(postMatch[1]));
    if (!post) return json(res, 404, { error: "Post not found" });
    if (!canModifyPost(user, post)) return json(res, 403, { error: "Only admins or the post author can change this post" });

    if (method === "DELETE") {
      db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
      return json(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const missing = validateRequired(["title", "content"], body);
    if (missing) return json(res, 400, { error: missing });
    db.prepare(`
      UPDATE posts
      SET title = ?, content = ?, tags = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(body.title).trim(),
      String(body.content).trim(),
      String(body.tags || "").trim(),
      String(body.imageUrl || "").trim(),
      post.id
    );
    return json(res, 200, { ok: true });
  }

  const commentsMatch = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (commentsMatch && method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const missing = validateRequired(["body"], body);
    if (missing) return json(res, 400, { error: missing });
    const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(Number(commentsMatch[1]));
    if (!post) return json(res, 404, { error: "Post not found" });

    const result = db.prepare("INSERT INTO comments (body, post_id, author_id) VALUES (?, ?, ?)").run(
      String(body.body).trim(),
      post.id,
      user.id
    );
    return json(res, 201, { id: result.lastInsertRowid });
  }

  json(res, 404, { error: "API route not found" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "Server error" });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Blogging platform running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
