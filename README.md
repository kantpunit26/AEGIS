# AEGIS Platform (Antimicrobial Resistance & Epidemic Geospatial Intelligence System)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black.svg?logo=three.js&logoColor=white)](https://threejs.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-15--3.3-336791.svg?logo=postgresql&logoColor=white)](https://postgis.net/)
[![Celery](https://img.shields.io/badge/Celery-5.3.6-37814A.svg?logo=celery&logoColor=white)](https://docs.celeryq.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)

**AEGIS** is an enterprise-grade biosurveillance, antimicrobial resistance (AMR) genomics profiling, and geospatial outbreak intelligence platform. It integrates high-throughput NCBI BLAST+ alignment against curated resistance databases (CARD), dynamic SEIR compartmental epidemiological forecasting, hospital containment perimeter simulation, and interactive 3D digital-twin globe visualizations.

---

## 📑 Table of Contents
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Project Directory Structure](#-project-directory-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start with Docker Compose](#-quick-start-with-docker-compose)
- [Manual Setup (Local Development)](#-manual-setup-local-development)
  - [1. Backend Setup](#1-backend-setup)
  - [2. Frontend Setup](#2-frontend-setup)
- [API Endpoints Overview](#-api-endpoints-overview)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [Emergency Alert Dispatch System](#-emergency-alert-dispatch-system)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🚀 Key Features

- **AMR Genomic Sequence Alignment**:
  - Direct FASTA sequence parsing and asynchronous local NCBI BLAST+ alignment against McMaster University's Comprehensive Antibiotic Resistance Database (CARD).
  - High-confidence AMR gene identification with bit-score and E-value metrics.

- **Dynamic SEIR Outbreak Modeling**:
  - Compartmental Susceptible-Exposed-Infectious-Recovered (SEIR) differential equation solvers modeling outbreak trajectory and transmission dynamics over time.
  - Pathogen-specific basic reproduction number ($R_0$) estimation (e.g., elevated virulence indices for carbapenem-resistant NDM variants).

- **Clinical Capacity & Perimeter Containment Simulation**:
  - Real-time simulation of regional hospital stress: ICU bed saturation and mechanical ventilator load projections under varying intervention scenarios.
  - Automated physical quarantine perimeter calculation based on Effective Reproduction Number ($R_{\text{eff}}$).

- **Geospatial & 3D Planetary Visualization**:
  - Interactive WebGL/Three.js 3D surveillance globe with orbital tracking, outbreak coordinate projection, and density heatmap halos.
  - High-precision Deck.gl polygon/scatterplot layers for micro-level spatial cluster analysis and topological site inspections.

- **Real-Time Alert Dispatch Engine**:
  - Live WebSocket channels broadcasting new detections instantly to clinical dashboards.
  - Automated webhook dispatch triggers (Slack, Discord, emergency incident management endpoints) when threshold criteria ($R_0$, ICU capacity) are exceeded.

---

## 🏛 System Architecture

```mermaid
flowchart TD
    subgraph Client ["Frontend (Vite + React 18)"]
        UI["Clinical Surveillance Dashboard"]
        Globe["Three.js / React Three Fiber 3D Globe"]
        Deck["Deck.gl Geospatial Overlay"]
        WSClient["WebSocket Client"]
    end

    subgraph Gateway ["FastAPI Gateway & API Core"]
        API["FastAPI REST & WebSocket Server (:8000)"]
    end

    subgraph Messaging ["Message Broker & State Cache"]
        Redis[("Redis 7 (Pub/Sub & Celery Broker)")]
    end

    subgraph Processing ["Distributed Workers"]
        Worker["Celery Worker Engine"]
        Blast["NCBI BLAST+ Nucleotide Search"]
        CARD[("CARD Database")]
        SEIR["SEIR Mathematical Modeling"]
        Containment["Clinical & Perimeter Simulation"]
    end

    subgraph Storage ["Spatial Database"]
        PostGIS[("PostgreSQL 15 + PostGIS Spatial DB")]
    end

    subgraph External ["External Notifications"]
        Webhook["Slack / Discord Emergency Webhooks"]
    end

    UI -->|Upload FASTA / Queries| API
    API -->|Enqueue Task| Redis
    Redis -->|Consume Task| Worker
    Worker -->|Query Alignment| Blast
    Blast -->|Reference| CARD
    Worker -->|Project Trajectory| SEIR
    Worker -->|Persist Geo-Record| PostGIS
    Worker -->|Publish Detection Event| Redis
    Redis -->|Broadcast amr_live_alerts| API
    API -->|Push Stream| WSClient
    Worker -.->|Critical Outbreak Breach| Webhook
```

---

## 🛠 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, Vite, Three.js, `@react-three/fiber`, `@react-three/drei`, Deck.gl, D3.js, GSAP, TailwindCSS |
| **Backend & Core** | Python 3.11, FastAPI, Celery, SQLAlchemy 2.0, GeoAlchemy2, Pydantic, Biopython |
| **Bioinformatics** | NCBI BLAST+ (`blastn`, `makeblastdb`), McMaster Comprehensive Antibiotic Resistance Database (CARD) |
| **Spatial & Cache DB** | PostgreSQL 15 with PostGIS spatial extensions, Redis 7 (Alpine) |
| **Orchestration** | Docker, Docker Compose |

---

## 📁 Project Directory Structure

```text
aegis-platform/
├── backend/
│   ├── alerts.py            # Webhook dispatch engine (Slack/Discord payloads)
│   ├── card_db/             # Compiled BLAST CARD resistance nucleotide database
│   ├── containment.py       # ICU/ventilator capacity & quarantine perimeter calculator
│   ├── database.py          # SQLAlchemy engine and PostGIS session lifecycle
│   ├── Dockerfile           # Python 3.11 + NCBI BLAST+ container definition
│   ├── main.py              # FastAPI application, routing, and WebSocket pub/sub
│   ├── models.py            # PostGIS OutbreakRecord spatial entity schema
│   ├── requirements.txt     # Python runtime dependencies
│   ├── seir.py              # Mathematical SEIR differential equations model
│   ├── setup_card_db.sh     # Script to download and compile McMaster CARD database
│   └── tasks.py             # Asynchronous Celery BLAST alignment & pipeline tasks
├── frontend/
│   ├── public/              # Static frontend assets
│   ├── src/
│   │   ├── App.jsx          # Dashboard, 3D Globe, Deck.gl view, and analytics UI
│   │   ├── index.css        # Global CSS & Tailwind styling
│   │   └── main.jsx         # React application entry point
│   ├── Dockerfile           # Frontend container build
│   ├── index.html           # HTML container
│   ├── package.json         # Frontend dependencies and scripts
│   ├── tailwind.config.js   # Tailwind design tokens
│   └── vite.config.js       # Vite bundler configuration
├── docker-compose.yml       # Multi-service stack orchestration (PostGIS, Redis, API, Worker, UI)
└── README.md                # Platform documentation
```

---

## 📦 Prerequisites

Ensure you have the following installed locally:
- [Docker](https://docs.docker.com/get-docker/) (v24+) and [Docker Compose](https://docs.docker.com/compose/)
- *Optional for manual local dev*:
  - Python 3.11+
  - Node.js (v18+) & npm
  - NCBI BLAST+ command-line tools
  - PostgreSQL 15+ with PostGIS extension enabled

---

## ⚡ Quick Start with Docker Compose

The fastest way to spin up the entire distributed cluster (PostGIS spatial database, Redis broker, FastAPI backend, Celery BLAST worker, and Vite frontend) is with Docker Compose:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kantpunit26/AEGIS.git
   cd AEGIS
   ```

2. **Launch the stack:**
   ```bash
   docker compose up --build
   ```

3. **Initialize the CARD BLAST database** (run once inside the worker container):
   ```bash
   docker compose exec celery_worker bash /app/setup_card_db.sh
   ```

4. **Access the services:**
   - **Frontend Dashboard**: [http://localhost:5173](http://localhost:5173)
   - **FastAPI Interactive Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
   - **PostGIS Database**: `localhost:5432` (`aegis_db`)
   - **Redis Instance**: `localhost:6379`

---

## 🔧 Manual Setup (Local Development)

### 1. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
export DATABASE_URL="postgresql://aegis_user:aegis_secure_pass@localhost:5432/aegis_db"
export REDIS_URL="redis://localhost:6379/0"
export CARD_DB_PATH="./card_db/card_database"

# Start the API server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Start the Celery Worker in a separate terminal:
celery -A tasks.celery_app worker --loglevel=info
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run Vite development server
npm run dev
```

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/analyze-sequence` | Ingests FASTA sequence and coordinates; triggers Celery BLAST alignment. |
| `GET` | `/api/outbreaks` | Retrieves spatial historical outbreak records with GeoJSON geometries. |
| `POST` | `/api/simulate-containment` | Calculates ICU demand, ventilator saturation, and quarantine perimeter. |
| `POST` | `/api/alerts/configure` | Sets alert thresholds ($R_0$, ICU %) and registers webhook destinations. |
| `POST` | `/api/alerts/test` | Dispatches a test emergency escalation payload to the configured webhook. |
| `WS` | `/ws/live` | WebSocket stream providing real-time detection events and outbreak updates. |

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | SQLAlchemy PostgreSQL + PostGIS connection string | `postgresql://aegis_user:aegis_secure_pass@db:5432/aegis_db` |
| `REDIS_URL` | Redis URI for Celery message broker & Pub/Sub stream | `redis://redis:6379/0` |
| `CARD_DB_PATH` | Path to compiled NCBI nucleotide BLAST database | `/blastdb/card_db` |

---

## 🚨 Emergency Alert Dispatch System

When high-risk pathogens or antibiotic resistance genes (such as *bla*<sub>NDM</sub>, *bla*<sub>KPC</sub>, or *mcr-1*) are detected and outbreak thresholds are breached, AEGIS can dispatch automated structured alert notifications to clinical emergency channels:

```json
{
  "text": "🚨 *AEGIS EMERGENCY AMR ESCALATION ALERT* 🚨\n*Pathogen Species:* `Klebsiella pneumoniae`\n*Resistance Gene:* `blaNDM-1`\n*Location:* Vadodara General Hospital\n*Basic Reproduction Number (R0):* `2.84`\n*ICU Saturation:* `91.2%`\n*Recommended Isolation Boundary:* `1850m`"
}
```

---

## 🤝 Contributing

Contributions to AEGIS are welcome!
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/clinical-triage-enhancement`)
3. Commit your changes (`git commit -m 'Add clinical triage enhancement'`)
4. Push to the branch (`git push origin feature/clinical-triage-enhancement`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
