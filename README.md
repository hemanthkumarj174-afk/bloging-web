# Blogging Platform

A small full-stack blogging platform for learning authentication, REST APIs, SQLite database relationships, CRUD, and user interaction.

## Features

- User registration and login with hashed passwords
- Token-based authentication
- Create, read, update, and delete blog posts
- Ownership checks so users can only edit or delete their own posts
- Comment system for logged-in users
- SQLite database tables for users, posts, and comments
- Vanilla frontend connected to RESTful backend APIs

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created at `data/blog.sqlite` the first time the server runs.

## API Overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/register` | Create an account |
| POST | `/api/login` | Log in |
| GET | `/api/me` | Current user and their posts |
| GET | `/api/posts` | List all posts |
| POST | `/api/posts` | Create a post |
| GET | `/api/posts/:id` | Read a post with comments |
| PUT | `/api/posts/:id` | Edit an owned post |
| DELETE | `/api/posts/:id` | Delete an owned post |
| POST | `/api/posts/:id/comments` | Add a comment |

## Notes

This app intentionally avoids external dependencies so it is easy to inspect. For production, set `AUTH_SECRET`, serve over HTTPS, add rate limiting, and use a mature session/JWT library.
