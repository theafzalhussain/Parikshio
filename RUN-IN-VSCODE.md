# Parikshio — VS Code me kaise run karein

Bhai, neeche exact steps hain. Total time: **~2 minute** (pehli baar `npm install` me 1–2 min lagta hai).

---

## 0. Ek baar ka setup (prerequisites)

| Chahiye | Kaise check karein | Install |
| --- | --- | --- |
| **Node.js 20 LTS** (18.17+ chalega) | `node -v` | https://nodejs.org — "LTS" version |
| **VS Code** | — | https://code.visualstudio.com |
| Git (optional) | `git -v` | https://git-scm.com |
| Docker Desktop (optional — sirf MongoDB/Redis ke liye) | `docker -v` | https://www.docker.com/products/docker-desktop |

> MongoDB aur Redis **optional** hain. Inke bina bhi app poora chalta hai (in-memory engine + cache mode) — demo ke liye yehi best hai.

---

## 1. Project VS Code me kholo

**Arena workspace se download karke:**
1. Workspace me `axiom` folder (ya `axiom-live.zip`) download karo.
2. Zip ho to extract karo → folder mil jayega: `axiom/`
3. VS Code → **File ▸ Open Folder…** → `axiom` folder select karo (⚠️ `axiom` ke andar wala `src` nahi, poora project root).

Agar terminal se kholna ho:
```bash
cd path/to/axiom
code .
```

Sahi folder khula hai ya nahi — check: VS Code Explorer me `package.json`, `server/`, `src/`, `shared/`, `README.md` dikhne chahiye.

---

## 2. Dependencies install (ek hi baar)

VS Code me terminal kholo: **Ctrl + `** (backtick) ya **Terminal ▸ New Terminal**

```bash
npm install
```

- Windows PowerShell me agar script-block error aaye to: `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"` ya VS Code terminal profile **Command Prompt** kar lo.
- 2–5 min lagega, `node_modules` ban jayega.

---

## 3. Server start karo

```bash
npm run dev
```

Terminal me ye dikhna chahiye:

```
  ⬢  Parikshio  ·  http://localhost:3000
     engine: development  ·  boot 2522ms
     mongo:  ephemeral (no MONGODB_URI)
     redis:  memory-fallback
     data:   26 questions · 3 exams · 51 responses
```

Ab browser me kholo: **http://localhost:3000** 🎉

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Admin / teacher | `admin@axiom.edu` | `admin123` |
| Student | `aarav@axiom.edu` | `student123` |

Live session join code: **`QM4LIVE`** ya **`DSA2026`**

> Server band karna ho: terminal me `Ctrl + C`.

---

## 4. VS Code shortcuts (jo maine already set kar diye hain)

`.vscode/` folder project me included hai, isliye:

- **F5** → *Parikshio · dev* launch (debugger attached + browser khud khulta hai)
- **Ctrl + Shift + B** → tasks menu: `dev: start server`, `check: typecheck`, `next: build`, `infra: mongo + redis`
- Extensions install karne ka suggestion VS Code khud dega (Tailwind, Prettier, ESLint, Error Lens)

Run/Debug panel (Ctrl+Shift+D) me 4 configs ready hain:
1. `Parikshio · dev (Next.js + Express + Socket.io)` ← ye use karo
2. `dev (watch mode)`
3. `production build & run`
4. `Attach to server (port 9229)`

---

## 5. Real-time demo (do windows me)

1. **Window 1 (normal):** `admin@axiom.edu` se login → *Question papers* ya *Question bank* → kisi question par **Push**
2. **Window 2 (incognito / doosra browser):** `aarav@axiom.edu` se login → *QM4LIVE* me enter
3. Student par question + synced timer turant dikhega; answer karte hi admin ke control room me latency + grade live aayega, leaderboard re-rank hoga.

---

## 6. MongoDB + Redis chalu karna (optional, production-jaisa)

```bash
cp .env.example .env      # Windows: copy .env.example .env
docker compose up -d      # mongo:27017 + redis:6379
```

`.env` me:
```env
PORT=3000
JWT_SECRET=koi-lamba-random-string
MONGODB_URI=mongodb://127.0.0.1:27017/axiom_live
REDIS_URL=redis://127.0.0.1:6379
```

Phir `npm run dev` restart karo. Terminal me dikhna chahiye: `mongo: connected` aur `redis: connected`.
Docker nahi hai? `.env` khali chhod do — sab kuch chalega, bas data memory me rahega (server restart = reset).

---

## 7. Production build

```bash
npm run build
npm start
```

---

## 8. Common problems (troubleshooting)

| Problem | Fix |
| --- | --- |
| `Error: listen EADDRINUSE :3000` | Port busy hai. `PORT=3001 npm run dev` (mac/linux) ya `$env:PORT=3001; npm run dev` (PowerShell) |
| `Cannot find module 'next'` / `tsx` | `npm install` dobara chalao, `axiom` root me ho ye check karo |
| Page blank / styles nahi | Terminal me error dekho; `Ctrl + C` → `npm run dev`; browser hard-refresh (Ctrl+Shift+R) |
| `typecheck` errors | `npm run typecheck` — code me kuch edit kiya ho to errors dikhayega (build fail nahi hoga Next me) |
| **Photo/scan upload par OCR kaam nahi kiya** | Pehli OCR call par Tesseract English language data internet se download karta hai (~15 MB). Ek baar net chahiye. Offline ho to **Paste text** tab use karo. |
| PDF se questions nahi mile | Do cases: (a) PDF **scan** hai → page images upload karo (OCR chalega), (b) questions numbered nahi hain → `1.` / `2.` se number karo ya Paste-text tab me paste karke edit kar lo. |
| `docker: command not found` | Docker Desktop install karo, ya `.env` me Mongo/Redis khali chhod do (ephemeral mode). |
| Windows me `cp` command nahi chalti | `copy .env.example .env` use karo |

---

## 9. Kaun-kahan hai (code map)

```
server/index.ts     → Express + Socket.io + Next ek hi port par
server/api.ts       → saare REST routes (auth, questions, papers, exams, answers, analytics)
server/extract.ts   → PDF/Word/OCR text → structured questions parser
server/files.ts     → PDF (pdfjs) · DOCX (mammoth) · OCR (tesseract.js)
server/engine.ts    → push / lock / submit / grading / analytics logic
shared/grade.ts     → grading + ranking (client-server common)
src/app/…           → pages: landing, login, admin/*, student/*
src/components/…    → AdminShell, StudentShell, charts, ui, PushDialog, QuestionEditModal
```

Scripts: `npm run dev` · `npm run build` · `npm start` · `npm run typecheck`

---

Kuch atak jaye to error ka text bhej dena — main exact fix bata dunga. 🚀
