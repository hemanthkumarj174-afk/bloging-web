# Blogging Platform

A small full-stack blogging platform for learning authentication, REST APIs, SQLite database relationships, CRUD, and user interaction.

## Features

- User registration and login with hashed passwords
- Token-based authentication
- Role-based access control for readers, blog writers, and admins
- Forgot password and reset password flow for local/dev use
- Create, read, update, and delete blog posts
- Blog writers can manage their own posts; admins can manage all posts
- Comment system for logged-in users
- SQLite database tables for users, posts, and comments
- Vanilla frontend connected to RESTful backend APIs

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created at `data/blog.sqlite` the first time the server runs.

Run checks and API smoke tests:

```bash
npm test
```

On Vercel, the API runs as a serverless function and uses `/tmp/blogging-platform/blog.sqlite`.
That storage is temporary, so demo data can disappear when the function cold-starts. Use a hosted
database such as Vercel Postgres, Neon, Supabase, or Turso for persistent production data.

## API Overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/register` | Create an account |
| POST | `/api/login` | Log in |
| POST | `/api/forgot-password` | Generate a dev reset code |
| POST | `/api/reset-password` | Reset password with code |
| GET | `/api/me` | Current user and their posts |
| GET | `/api/users` | Admin: list users |
| PUT | `/api/users/:id/role` | Admin: update user role |
| GET | `/api/posts` | List all posts |
| POST | `/api/posts` | Create a post |
| GET | `/api/posts/:id` | Read a post with comments |
| PUT | `/api/posts/:id` | Edit an owned post |
| DELETE | `/api/posts/:id` | Delete an owned post |
| POST | `/api/posts/:id/comments` | Add a comment |

## Notes

This app intentionally avoids external dependencies so it is easy to inspect. For production, set `AUTH_SECRET`, serve over HTTPS, add rate limiting, and use a mature session/JWT library.
