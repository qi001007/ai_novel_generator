# AI Novel Generator

自用单机 Web 应用，用于 AI 网文长篇连载生成。项目采用流水线审稿模式：AI 负责生成和七维自检，人工逐段终审后，确认过的事实才会进入设定库和摘要时间线。

## 技术栈

- 后端：FastAPI、SQLModel、SQLite、Alembic
- 前端：React、Vite、TypeScript
- 测试：pytest、Vitest

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

启动后访问 `http://localhost:5173`。开发环境下 Vite 会把 `/api` 请求代理到后端 `http://localhost:8000`。

## 验证

```bash
cd backend
pytest

cd ../frontend
npm run test -- --run
npm run build
```
