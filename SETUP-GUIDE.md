# Erudition Backend - Complete Setup Guide for Beginners

This guide will walk you through setting up the Erudition backend server step by step. No technical background required - just follow along!

---

## 📋 Table of Contents

1. [What You'll Be Setting Up](#1-what-youll-be-setting-up)
2. [Prerequisites Checklist](#2-prerequisites-checklist)
3. [Step 1: Download and Extract the Project](#step-1-download-and-extract-the-project)
4. [Step 2: Open the Project in VS Code](#step-2-open-the-project-in-vs-code)
5. [Step 3: Install Dependencies](#step-3-install-dependencies)
6. [Step 4: Configure Environment Variables](#step-4-configure-environment-variables)
7. [Step 5: Set Up the Database](#step-5-set-up-the-database)
8. [Step 6: Start the Server](#step-6-start-the-server)
9. [Step 7: Test That Everything Works](#step-7-test-that-everything-works)
10. [Troubleshooting Common Problems](#troubleshooting-common-problems)
11. [What's Next?](#whats-next)

---

## 1. What You'll Be Setting Up

The **backend** is like the "brain" of your application. It:
- Stores all your data (schools, students, classes, attendance)
- Handles user login and security
- Sends LINE notifications to parents
- Provides data to your website/app (the frontend)

Think of it like a restaurant kitchen - customers (users) don't see it, but it's where all the work happens!

---

## 2. Prerequisites Checklist

Before starting, make sure you have these ready. Check each box:

### ✅ Software Installed
- [ ] **Node.js** (version 18 or higher)
  - To check: Open Terminal/Command Prompt, type `node --version`
  - Should show something like `v18.17.0` or higher
  
- [ ] **VS Code** (or another code editor)
  - Download from: https://code.visualstudio.com/

### ✅ Accounts Created
- [ ] **Supabase account** with a project created
  - You should have your database URL from earlier
  
- [ ] **LINE Developer account** with channels set up
  - LINE Login channel (for user authentication)
  - LINE Messaging API channel (for notifications)

### ✅ Information You'll Need
Gather these before starting:

```
DATABASE_URL = your Supabase connection string
LINE_LOGIN_CHANNEL_ID = from LINE Developers Console
LINE_LOGIN_CHANNEL_SECRET = from LINE Developers Console  
LINE_MESSAGING_CHANNEL_SECRET = from LINE Developers Console
LINE_MESSAGING_ACCESS_TOKEN = from LINE Developers Console
```

---

## Step 1: Download and Extract the Project

### 1.1 Download the ZIP file
Click the download link I provided to get `erudition-backend.zip`

### 1.2 Extract (Unzip) the file

**On Windows:**
1. Find `erudition-backend.zip` in your Downloads folder
2. Right-click on it
3. Select "Extract All..."
4. Choose where to extract (I recommend your Desktop or a Projects folder)
5. Click "Extract"

**On Mac:**
1. Find `erudition-backend.zip` in your Downloads folder
2. Double-click it
3. A folder called `erudition-backend` will appear

### 1.3 Move to your project location
Move the `erudition-backend` folder to where you want to keep your Erudition project.

**Recommended location:**
```
C:\Users\YourName\Desktop\Erudition\erudition-backend   (Windows)
/Users/YourName/Desktop/Erudition/erudition-backend     (Mac)
```

---

## Step 2: Open the Project in VS Code

### 2.1 Open VS Code

### 2.2 Open the project folder
1. Click **File** → **Open Folder** (or **Open** on Mac)
2. Navigate to your `erudition-backend` folder
3. Click **Select Folder** (or **Open**)

### 2.3 You should see this structure in the left sidebar:
```
erudition-backend
├── prisma/
├── src/
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── SETUP-GUIDE.md  (this file!)
```

✅ **Checkpoint:** You can see files and folders in VS Code's left sidebar.

---

## Step 3: Install Dependencies

"Dependencies" are pre-built code packages that our project uses. Think of them like ingredients for a recipe - we need to gather them before we can cook!

### 3.1 Open the Terminal in VS Code
1. Click **Terminal** in the top menu
2. Click **New Terminal**
3. A panel will open at the bottom of VS Code

### 3.2 Make sure you're in the right folder
The terminal should show something like:
```
C:\Users\YourName\Desktop\Erudition\erudition-backend>
```
or
```
yourname@computer erudition-backend %
```

If not, type this and press Enter:
```bash
cd path/to/your/erudition-backend
```

### 3.3 Install the dependencies
Type this command and press Enter:
```bash
npm install
```

### 3.4 Wait for it to finish
- This will take 1-3 minutes
- You'll see a lot of text scrolling
- It's done when you see the cursor blinking again
- You might see some "warnings" - that's usually okay!

### 3.5 Check that it worked
You should now see a new folder called `node_modules` in your project.

✅ **Checkpoint:** You see a `node_modules` folder in VS Code's sidebar.

---

## Step 4: Configure Environment Variables

Environment variables are secret settings (like passwords) that your app needs but shouldn't be shared publicly.

### 4.1 Create your .env file
1. In VS Code, find the file called `.env.example`
2. Right-click on it
3. Select **Copy**
4. Right-click in the empty space below the files
5. Select **Paste**
6. Right-click on the copy (`.env copy.example` or similar)
7. Select **Rename**
8. Rename it to exactly: `.env` (just ".env", nothing else)

### 4.2 Open the .env file
Double-click on `.env` to open it. You'll see something like:
```
# SERVER CONFIGURATION
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:5173

# DATABASE (Supabase)
DATABASE_URL="postgresql://..."
```

### 4.3 Fill in your values

Replace the placeholder values with your real information:

#### Database URL (from Supabase)
```
DATABASE_URL="postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

**How to find this:**
1. Go to https://supabase.com and log in
2. Select your project
3. Click **Settings** (gear icon) in the left sidebar
4. Click **Database**
5. Scroll down to **Connection string**
6. Select **URI** tab
7. Copy the string and paste it (replace `[YOUR-PASSWORD]` with your actual password)

#### JWT Secret (make up a random string)
```
JWT_SECRET=my-super-secret-random-string-make-this-long-and-random-12345
```
Just type a long random string - this is used to secure user logins.

#### LINE Login Credentials
```
LINE_LOGIN_CHANNEL_ID=1234567890
LINE_LOGIN_CHANNEL_SECRET=abcdef1234567890abcdef
LINE_REDIRECT_URI=http://localhost:5173/auth/line/callback
```

**How to find this:**
1. Go to https://developers.line.biz/
2. Log in and select your LINE Login channel
3. Find **Channel ID** and **Channel secret** on the Basic settings page

#### LINE Messaging API Credentials
```
LINE_MESSAGING_CHANNEL_SECRET=abcdef1234567890
LINE_MESSAGING_ACCESS_TOKEN=very-long-token-string-here
```

**How to find this:**
1. In LINE Developers Console, select your Messaging API channel
2. **Channel secret** is on the Basic settings page
3. **Channel access token**: Go to Messaging API tab, click "Issue" if you haven't already

### 4.4 Save the file
Press **Ctrl+S** (Windows) or **Cmd+S** (Mac)

### 4.5 Example of a completed .env file
```
PORT=3001
NODE_ENV=development
CLIENT_URL=http://localhost:5173

DATABASE_URL="postgresql://postgres.abcdefghijk:MyPassword123@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

JWT_SECRET=erudition-jwt-secret-key-change-this-to-something-random-abc123xyz

LINE_LOGIN_CHANNEL_ID=2001234567
LINE_LOGIN_CHANNEL_SECRET=a1b2c3d4e5f6g7h8i9j0
LINE_REDIRECT_URI=http://localhost:5173/auth/line/callback

LINE_MESSAGING_CHANNEL_SECRET=z9y8x7w6v5u4t3s2r1q0
LINE_MESSAGING_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

DEEPL_API_KEY=your-deepl-key-here
```

✅ **Checkpoint:** You have a `.env` file with all your credentials filled in.

---

## Step 5: Set Up the Database

Now we'll create the database tables that store your data.

### 5.1 Generate Prisma Client
In the VS Code terminal, type:
```bash
npm run db:generate
```

**What this does:** Creates code that lets our app talk to the database.

You should see:
```
✔ Generated Prisma Client
```

### 5.2 Push the Schema to Database
```bash
npm run db:push
```

**What this does:** Creates all the tables in your Supabase database (Schools, Users, Classes, Attendance, etc.)

You should see something like:
```
🚀  Your database is now in sync with your Prisma schema.
```

### 5.3 (Optional) Add Demo Data
If you want to start with some example data to test with:
```bash
npm run db:seed
```

**What this does:** Creates a demo school, teacher, parent, students, and classes.

You'll see:
```
🎉 Database seeded successfully!

Demo Accounts:
─────────────────────────────────
Admin:   admin@happylearning.tw / admin123
Teacher: teacher@happylearning.tw / teacher123
Parent:  parent@example.com / parent123
─────────────────────────────────
```

Save these login credentials for testing!

### 5.4 Verify in Supabase
1. Go to your Supabase dashboard
2. Click **Table Editor** in the left sidebar
3. You should see tables like: schools, users, classes, students, attendance, etc.

✅ **Checkpoint:** You can see tables in your Supabase Table Editor.

---

## Step 6: Start the Server

### 6.1 Start in Development Mode
In the VS Code terminal, type:
```bash
npm run dev
```

### 6.2 You should see:
```
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   🎓 Erudition Server Running                     ║
  ║                                                   ║
  ║   Port: 3001                                      ║
  ║   Mode: development                               ║
  ║   Time: 10:30:45 AM                               ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
```

🎉 **Your server is running!**

### 6.3 Keep this terminal open
The server needs to keep running while you use the app. Don't close this terminal!

To stop the server later, press **Ctrl+C** in the terminal.

✅ **Checkpoint:** You see the "Erudition Server Running" message.

---

## Step 7: Test That Everything Works

### 7.1 Open your web browser
Go to: **http://localhost:3001/api/health**

### 7.2 You should see:
```json
{
  "status": "ok",
  "message": "Erudition API is running",
  "timestamp": "2024-11-25T02:30:45.123Z",
  "version": "1.0.0"
}
```

### 7.3 Test a login (if you seeded demo data)

**Option A: Using your browser**

Go to: http://localhost:3001/api/auth/line/login

You should see a response with a LINE login URL.

**Option B: Using a tool like Postman (more advanced)**

Send a POST request to `http://localhost:3001/api/auth/login` with:
```json
{
  "email": "admin@happylearning.tw",
  "password": "admin123"
}
```

You should get back a token and user information.

✅ **Checkpoint:** The health endpoint returns "status": "ok"

---

## Troubleshooting Common Problems

### ❌ "npm: command not found"
**Problem:** Node.js isn't installed or not in your PATH.
**Solution:** 
1. Download Node.js from https://nodejs.org/
2. Install it (use the LTS version)
3. Close and reopen VS Code
4. Try again

### ❌ "Cannot find module..." errors
**Problem:** Dependencies weren't installed correctly.
**Solution:**
1. Delete the `node_modules` folder
2. Delete the file `package-lock.json` if it exists
3. Run `npm install` again

### ❌ "Database connection failed" or "P1001" error
**Problem:** Can't connect to Supabase.
**Solution:**
1. Check your DATABASE_URL in `.env`
2. Make sure there are no extra spaces
3. Verify your password is correct
4. Check that your Supabase project is running (not paused)

### ❌ "Error: P1001: Can't reach database server"
**Problem:** Wrong database URL format or network issue.
**Solution:**
1. In Supabase, go to Settings → Database
2. Make sure you're using the "Connection pooling" URL (port 6543)
3. Add `?pgbouncer=true` at the end of the URL

### ❌ "EADDRINUSE: address already in use :::3001"
**Problem:** Something else is using port 3001.
**Solution:**
1. Change the PORT in your `.env` file to 3002 or 3003
2. Or find and stop whatever is using port 3001

### ❌ "Invalid LINE signature" in webhook
**Problem:** LINE can't verify your webhook.
**Solution:**
1. Double-check LINE_MESSAGING_CHANNEL_SECRET in `.env`
2. Make sure there are no extra spaces or characters

### ❌ Server crashes immediately after starting
**Problem:** Usually a configuration error.
**Solution:**
1. Read the error message carefully
2. Check your `.env` file for typos
3. Make sure all required values are filled in

---

## What's Next?

Congratulations! 🎉 Your backend server is running!

### Next Steps:

1. **Set up the Frontend**
   - The backend is the "brain" - now you need the "face" (website/app)
   - We'll create the React frontend next

2. **Configure LINE Webhook**
   - For LINE to send messages to your server, you need to deploy it online
   - We'll do this when you're ready to deploy

3. **Deploy to Railway**
   - Railway.app lets you run your server online for free (with limits)
   - This makes it accessible to real users

### Useful Commands Reference:

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start server (development mode with auto-reload) |
| `npm start` | Start server (production mode) |
| `npm run db:studio` | Open database viewer in browser |
| `npm run db:push` | Update database with schema changes |
| `npm run db:seed` | Add demo data |

### Getting Help

If you get stuck:
1. Read the error message carefully - it often tells you what's wrong
2. Check this troubleshooting section
3. Ask me! Share the exact error message you see

---

## Quick Reference Card

Save this for later!

```
📁 Project Location: C:\Users\YourName\Desktop\Erudition\erudition-backend

🚀 Start Server:     npm run dev
🛑 Stop Server:      Ctrl+C
🔍 View Database:    npm run db:studio
🌐 Test URL:         http://localhost:3001/api/health

📧 Demo Logins:
   Admin:   admin@happylearning.tw / admin123
   Teacher: teacher@happylearning.tw / teacher123
   Parent:  parent@example.com / parent123
```

---

*Guide created for Erudition v1.0 - November 2024*
