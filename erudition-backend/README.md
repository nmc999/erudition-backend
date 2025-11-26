# Erudition Backend API

🎓 Backend server for the Erudition Buxiban (補習班) Management System.

## Features

- **Authentication**: LINE Login OAuth + Email/Password with JWT
- **User Management**: Multi-role support (Admin, Manager, Teacher, Parent, Student)
- **Class Management**: Create classes, enroll students, assign teachers
- **Attendance Tracking**: Mark attendance with automatic LINE notifications to parents
- **Homework Management**: Assign, submit, and grade homework with reminders
- **Messaging**: Parent-teacher communication with auto-translation (zh-TW ↔ en)
- **LINE Integration**: Webhook for incoming messages, push notifications

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma
- **Authentication**: JWT + LINE Login OAuth
- **External APIs**: LINE Messaging API, DeepL Translation

## Quick Start

### Prerequisites

- Node.js 18 or higher
- PostgreSQL database (or Supabase account)
- LINE Developer account with Login and Messaging API channels

### Installation

1. **Clone and install dependencies:**
   ```bash
   cd erudition-backend
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Set up database:**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Push schema to database
   npm run db:push
   
   # (Optional) Seed demo data
   npm run db:seed
   ```

4. **Start the server:**
   ```bash
   # Development (with hot reload)
   npm run dev
   
   # Production
   npm start
   ```

5. **Verify it's running:**
   ```bash
   curl http://localhost:3001/api/health
   ```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/line/login` | Get LINE Login URL |
| POST | `/api/auth/line/callback` | LINE OAuth callback |
| POST | `/api/auth/register` | Register with email |
| POST | `/api/auth/login` | Login with email |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user |

### Schools
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/schools` | Create school |
| GET | `/api/schools/:id` | Get school details |
| PUT | `/api/schools/:id` | Update school |
| GET | `/api/schools/:id/stats` | Get school statistics |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List users |
| GET | `/api/users/:id` | Get user |
| POST | `/api/users` | Create user |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Deactivate user |

### Classes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/classes` | List classes |
| GET | `/api/classes/:id` | Get class details |
| POST | `/api/classes` | Create class |
| PUT | `/api/classes/:id` | Update class |
| DELETE | `/api/classes/:id` | Delete class |
| POST | `/api/classes/:id/enroll` | Enroll students |
| POST | `/api/classes/:id/unenroll` | Remove students |

### Attendance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/attendance` | Get attendance records |
| GET | `/api/attendance/class/:classId/date/:date` | Get class attendance |
| POST | `/api/attendance` | Mark single attendance |
| POST | `/api/attendance/bulk` | Mark bulk attendance |
| PUT | `/api/attendance/:id` | Update attendance |
| GET | `/api/attendance/stats` | Get statistics |

### Homework
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/homework` | List homework |
| GET | `/api/homework/:id` | Get homework details |
| POST | `/api/homework` | Create homework |
| PUT | `/api/homework/:id` | Update homework |
| DELETE | `/api/homework/:id` | Delete homework |
| POST | `/api/homework/:id/submit` | Submit homework |
| PUT | `/api/homework/:id/submissions/:sid/grade` | Grade submission |
| POST | `/api/homework/:id/remind` | Send reminders |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | Get messages |
| GET | `/api/messages/conversations` | Get conversation list |
| GET | `/api/messages/unread-count` | Get unread count |
| POST | `/api/messages` | Send message |
| PUT | `/api/messages/:id/read` | Mark as read |
| PUT | `/api/messages/read-all` | Mark all as read |

### LINE Webhook
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhook/line` | LINE webhook receiver |

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

Tokens are returned from login/register endpoints and expire in 7 days.

## LINE Integration Setup

### LINE Login Channel
1. Go to [LINE Developers Console](https://developers.line.biz/)
2. Create a new channel → LINE Login
3. Add callback URL: `{YOUR_DOMAIN}/auth/line/callback`
4. Copy Channel ID and Channel Secret to `.env`

### LINE Messaging API Channel
1. Create another channel → Messaging API
2. Enable webhooks and set URL: `{YOUR_DOMAIN}/api/webhook/line`
3. Issue Channel Access Token
4. Copy credentials to `.env`

## Project Structure

```
erudition-backend/
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.js            # Demo data seeder
├── src/
│   ├── config/
│   │   └── database.js    # Prisma client
│   ├── middleware/
│   │   ├── auth.js        # JWT authentication
│   │   ├── errorHandler.js
│   │   └── notFound.js
│   ├── routes/
│   │   ├── auth.js        # Authentication routes
│   │   ├── schools.js     # School management
│   │   ├── users.js       # User management
│   │   ├── classes.js     # Class management
│   │   ├── attendance.js  # Attendance tracking
│   │   ├── homework.js    # Homework management
│   │   ├── messages.js    # Messaging system
│   │   └── lineWebhook.js # LINE webhook handler
│   ├── services/
│   │   ├── lineService.js       # LINE API integration
│   │   └── translationService.js # DeepL translation
│   └── index.js           # Express app entry point
├── .env.example           # Environment template
├── package.json
└── README.md
```

## Development

```bash
# Run with hot reload
npm run dev

# Open Prisma Studio (database GUI)
npm run db:studio

# Reset database and reseed
npm run db:push -- --force-reset
npm run db:seed
```

## Deployment

### Railway.app (Recommended for MVP)
1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy!

### Environment Variables for Production
- Set `NODE_ENV=production`
- Use strong `JWT_SECRET`
- Configure proper `DATABASE_URL`
- Set `CLIENT_URL` to your frontend domain

## License

MIT

---

Built with ❤️ for Taiwan's Buxiban community
