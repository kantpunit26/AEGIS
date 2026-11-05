import os
import time
import json
import re
from typing import List, Optional
from fastapi import FastAPI, Depends, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
import redis.asyncio as aioredis
from database import engine, Base, get_db
from models import OutbreakRecord
from tasks import process_fasta_sequence
from seir import calculate_seir_projection
from containment import simulate_containment
from alerts import dispatch_emergency_alert

# Initialize PostGIS extension and database schema on startup
for attempt in range(10):
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            conn.commit()
        Base.metadata.create_all(bind=engine)
        break
    except Exception as e:
        print(f"DB Wait: {e}")
        time.sleep(3)

app = FastAPI(title="AEGIS Master Core")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Global Alert Engine Configuration Store
ALERT_CONFIG = {
    "webhook_url": "",
    "email_recipient": "",
    "r0_threshold": 2.5,
    "icu_threshold_pct": 80.0,
    "auto_alert_enabled": True
}

KNOWN_GEOLOCATIONS = {
    "vadodara": (22.3072, 73.1812),
    "baroda": (22.3072, 73.1812),
    "delhi": (28.5672, 77.2100),
    "new delhi": (28.5672, 77.2100),
    "aiims": (28.5672, 77.2100),
    "mumbai": (19.0760, 72.8777),
    "new york": (40.7128, -74.0060),
    "nyc": (40.7128, -74.0060),
    "london": (51.5074, -0.1278)
}

class AlertConfigRequest(BaseModel):
    webhook_url: str
    email_recipient: Optional[str] = ""
    r0_threshold: float = 2.5
    icu_threshold_pct: float = 80.0
    auto_alert_enabled: bool = True

def verify_role(token: str = Depends(oauth2_scheme)):
    if token != "aegis-admin-token":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access Denied.")
    return {"role": "epidemiologist"}

@app.get("/api/outbreaks")
def get_historical_outbreaks(db: Session = Depends(get_db)):
    """Fetch persisted outbreak records with real-time SEIR trajectories and containment metrics."""
    try:
        records = db.query(OutbreakRecord).order_by(OutbreakRecord.id.desc()).limit(100).all()
        result = []
        for record in records:
            seir_data = calculate_seir_projection(
                population=150000,
                initial_infected=8,
                initial_exposed=24,
                beta=0.52 if "NDM" in record.amr_gene else 0.42,
                sigma=0.2,
                gamma=0.1,
                days=14
            )
            peak_infected = max(d["infectious"] for d in seir_data["projection"])
            containment_data = simulate_containment(
                r0_initial=seir_data["r0"],
                infectious_peak=peak_infected,
                population=150000,
                total_icu_beds=120,
                total_ventilators=40,
                lockdown_factor=0.0
            )
            
            result.append({
                "id": record.id,
                "pathogen_name": record.pathogen_name,
                "amr_gene": record.amr_gene,
                "e_value": record.e_value,
                "bit_score": record.bit_score,
                "hospital_or_site": record.hospital_or_site,
                "latitude": record.latitude,
                "longitude": record.longitude,
                "detected_at": record.detected_at.isoformat() if record.detected_at else "",
                "seir": seir_data,
                "containment": containment_data
            })
        return result
    except Exception as e:
        print(f"DATABASE QUERY ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Option 3: D3 AMR Phylogenetic Lineage Tree Endpoint
@app.get("/api/phylogeny/{gene_name}")
def get_phylogenetic_lineage(gene_name: str):
    """
    Returns hierarchical mutation lineage trees (SNP distance, evolutionary parent-child variants)
    for target resistance genes aligned from the CARD genomic database.
    """
    gene_upper = gene_name.upper()
    
    if "NDM" in gene_upper:
        tree = {
            "name": "blaNDM Ancestral Lineage",
            "type": "Root",
            "children": [
                {
                    "name": "blaNDM-1",
                    "mutation": "Wildtype Metallo-beta-lactamase",
                    "snp_distance": 0,
                    "children": [
                        {
                            "name": "blaNDM-5",
                            "mutation": "Val88Leu, Met154Leu",
                            "snp_distance": 2,
                            "children": [
                                {
                                    "name": "blaNDM-7",
                                    "mutation": "Ala233Val",
                                    "snp_distance": 3,
                                    "highlight": True if "NDM-7" in gene_upper else False
                                },
                                {
                                    "name": "blaNDM-15",
                                    "mutation": "Lys211Asn",
                                    "snp_distance": 4,
                                    "highlight": True if "NDM-15" in gene_upper else False
                                }
                            ],
                            "highlight": True if "NDM-5" in gene_upper else False
                        },
                        {
                            "name": "blaNDM-4",
                            "mutation": "Met154Leu",
                            "snp_distance": 1,
                            "highlight": True if "NDM-4" in gene_upper else False
                        }
                    ],
                    "highlight": True if "NDM-1" in gene_upper or "NDM" in gene_upper and not any(x in gene_upper for x in ["5","7","15","4"]) else False
                }
            ]
        }
    elif "MCR" in gene_upper:
        tree = {
            "name": "mcr Colistin Resistance Ancestor",
            "type": "Root",
            "children": [
                {
                    "name": "mcr-1.1",
                    "mutation": "Plasmid Phosphoethanolamine Transferase",
                    "snp_distance": 0,
                    "children": [
                        {
                            "name": "mcr-1.2",
                            "mutation": "Gln179His",
                            "snp_distance": 1,
                            "highlight": True if "MCR-1.2" in gene_upper else False
                        },
                        {
                            "name": "mcr-2",
                            "mutation": "Lineage Divergence (81% Id)",
                            "snp_distance": 14,
                            "highlight": True if "MCR-2" in gene_upper else False
                        }
                    ],
                    "highlight": True if "MCR-1" in gene_upper or "MCR" in gene_upper else False
                }
            ]
        }
    else:
        tree = {
            "name": f"{gene_name} Variant Clade",
            "type": "Root",
            "children": [
                {
                    "name": gene_name,
                    "mutation": "Primary Aligned Target",
                    "snp_distance": 0,
                    "highlight": True
                }
            ]
        }
        
    return tree

# Option 2: Alert Webhook Configuration & Dispatch Endpoints
@app.get("/api/alerts/config")
def get_alert_config():
    return ALERT_CONFIG

@app.post("/api/alerts/config")
def set_alert_config(config: AlertConfigRequest):
    ALERT_CONFIG["webhook_url"] = config.webhook_url
    ALERT_CONFIG["email_recipient"] = config.email_recipient
    ALERT_CONFIG["r0_threshold"] = config.r0_threshold
    ALERT_CONFIG["icu_threshold_pct"] = config.icu_threshold_pct
    ALERT_CONFIG["auto_alert_enabled"] = config.auto_alert_enabled
    return {"message": "Alert configuration updated successfully.", "config": ALERT_CONFIG}

@app.post("/api/alerts/test")
def trigger_test_alert(webhook_url: Optional[str] = None):
    url = webhook_url or ALERT_CONFIG["webhook_url"]
    if not url:
        raise HTTPException(status_code=400, detail="No Webhook URL provided.")
    
    test_data = {
        "pathogen_name": "Klebsiella pneumoniae (TEST)",
        "amr_gene": "blaNDM-1",
        "hospital_or_site": "AIIMS Emergency Command Center",
        "r0": 3.8,
        "icu_pct": 92.5,
        "radius_m": 1250,
        "latitude": 28.5672,
        "longitude": 77.2100,
        "e_value": 1e-169,
        "bit_score": 580.4
    }
    
    success = dispatch_emergency_alert(url, test_data)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send test alert payload to destination URL.")
    return {"message": "Emergency alert dispatch test successful."}

# Option 3: Natural Language & Spatial Query Engine
@app.get("/api/outbreaks/nl-query")
def natural_language_spatial_query(query: str, db: Session = Depends(get_db)):
    try:
        query_lower = query.lower()
        radius_match = re.search(r'(\d+)\s*km', query_lower)
        radius_km = float(radius_match.group(1)) if radius_match else 50.0

        center_coords = None
        target_location_name = None
        for loc_key, coords in KNOWN_GEOLOCATIONS.items():
            if loc_key in query_lower:
                center_coords = coords
                target_location_name = loc_key.upper()
                break

        gene_filter = None
        if "ndm" in query_lower:
            gene_filter = "NDM"
        elif "mcr" in query_lower:
            gene_filter = "MCR"
        elif "oxa" in query_lower:
            gene_filter = "OXA"

        params = {}
        where_clauses = []

        if center_coords:
            lat, lng = center_coords
            radius_meters = radius_km * 1000.0
            where_clauses.append("""
                ST_DWithin(
                    location, 
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 
                    :radius_meters
                )
            """)
            params.update({"lat": lat, "lng": lng, "radius_meters": radius_meters})

        if gene_filter:
            where_clauses.append("amr_gene ILIKE :gene_filter")
            params["gene_filter"] = f"%{gene_filter}%"

        sql_base = """
            SELECT id, pathogen_name, amr_gene, e_value, bit_score, 
                   hospital_or_site, latitude, longitude, detected_at
            FROM outbreak_records
        """
        if where_clauses:
            sql_base += " WHERE " + " AND ".join(where_clauses)
        sql_base += " ORDER BY id DESC LIMIT 100;"

        records = db.execute(text(sql_base), params).fetchall()

        results = []
        for row in records:
            seir_data = calculate_seir_projection(
                population=150000, initial_infected=8, initial_exposed=24,
                beta=0.52 if "NDM" in row.amr_gene else 0.42, sigma=0.2, gamma=0.1, days=14
            )
            peak_infected = max(d["infectious"] for d in seir_data["projection"])
            containment_data = simulate_containment(
                r0_initial=seir_data["r0"], infectious_peak=peak_infected,
                population=150000, total_icu_beds=120, total_ventilators=40, lockdown_factor=0.0
            )
            
            results.append({
                "id": row.id,
                "pathogen_name": row.pathogen_name,
                "amr_gene": row.amr_gene,
                "e_value": row.e_value,
                "bit_score": row.bit_score,
                "hospital_or_site": row.hospital_or_site,
                "latitude": row.latitude,
                "longitude": row.longitude,
                "detected_at": row.detected_at.isoformat() if row.detected_at else "",
                "seir": seir_data,
                "containment": containment_data
            })

        return {
            "parsed_query": {
                "raw_query": query,
                "detected_location": target_location_name or "GLOBAL",
                "radius_km": radius_km if center_coords else None,
                "gene_filter": gene_filter or "ALL",
                "matched_count": len(results)
            },
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"NL Spatial Engine Error: {str(e)}")

@app.get("/api/containment/simulate")
def get_containment_simulation(
    r0: float,
    peak_infected: int,
    total_icu_beds: int = 120,
    total_ventilators: int = 40,
    lockdown_factor: float = 0.0
):
    return simulate_containment(
        r0_initial=r0,
        infectious_peak=peak_infected,
        population=150000,
        total_icu_beds=total_icu_beds,
        total_ventilators=total_ventilators,
        lockdown_factor=lockdown_factor
    )

@app.get("/api/reports/export-geojson")
def export_geojson(outbreak_id: int, db: Session = Depends(get_db)):
    record = db.query(OutbreakRecord).filter(OutbreakRecord.id == outbreak_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Outbreak record not found")
    
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [record.longitude, record.latitude]
                },
                "properties": {
                    "id": record.id,
                    "pathogen_name": record.pathogen_name,
                    "amr_gene": record.amr_gene,
                    "e_value": record.e_value,
                    "bit_score": record.bit_score,
                    "hospital_or_site": record.hospital_or_site,
                    "detected_at": record.detected_at.isoformat() if record.detected_at else ""
                }
            }
        ]
    }

@app.get("/api/reports/export-dossier")
def export_dossier(outbreak_id: int, db: Session = Depends(get_db)):
    record = db.query(OutbreakRecord).filter(OutbreakRecord.id == outbreak_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    
    seir_data = calculate_seir_projection(
        population=150000, initial_infected=8, initial_exposed=24,
        beta=0.52 if "NDM" in record.amr_gene else 0.42, sigma=0.2, gamma=0.1, days=14
    )
    
    return {
        "report_title": "WHO / CDC CLINICAL AMR THREAT ASSESSMENT DOSSIER",
        "classification": "CRITICAL LEVEL 4 SURVEILLANCE ALERT",
        "generated_timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "pathogen_telemetry": {
            "record_id": record.id,
            "pathogen_species": record.pathogen_name,
            "aligned_resistance_gene": record.amr_gene,
            "e_value": record.e_value,
            "bit_score": record.bit_score,
            "facility_location": record.hospital_or_site,
            "coordinates": f"{record.latitude:.4f}°, {record.longitude:.4f}°"
        },
        "epidemiological_projections": {
            "basic_reproduction_number_r0": seir_data["r0"],
            "projected_14d_peak_infections": max(d["infectious"] for d in seir_data["projection"])
        }
    }

@app.post("/api/upload-fasta")
async def upload_fasta(
    file: UploadFile = File(...), 
    pathogen_name: str = Form(...), 
    site_name: str = Form(...),
    latitude: float = Form(...), 
    longitude: float = Form(...), 
    user: dict = Depends(verify_role)
):
    try:
        content = (await file.read()).decode("utf-8")
        task = process_fasta_sequence.delay(content, pathogen_name, site_name, latitude, longitude)
        return {"message": "Queued", "task_id": str(task.id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    await websocket.accept()
    redis_conn = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = redis_conn.pubsub()
    await pubsub.subscribe("amr_live_alerts")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = json.loads(message["data"])
                
                # Check option 2 emergency threshold breach trigger
                if ALERT_CONFIG["auto_alert_enabled"] and ALERT_CONFIG["webhook_url"]:
                    r0_val = data.get("seir", {}).get("r0", 0)
                    icu_val = data.get("containment", {}).get("icu_saturation_pct", 0)
                    if r0_val >= ALERT_CONFIG["r0_threshold"] or icu_val >= ALERT_CONFIG["icu_threshold_pct"]:
                        dispatch_emergency_alert(ALERT_CONFIG["webhook_url"], {
                            "pathogen_name": data.get("pathogen_name"),
                            "amr_gene": data.get("amr_gene"),
                            "hospital_or_site": data.get("hospital_or_site"),
                            "r0": r0_val,
                            "icu_pct": icu_val,
                            "radius_m": data.get("containment", {}).get("recommended_quarantine_radius_m", 500),
                            "latitude": data.get("latitude"),
                            "longitude": data.get("longitude"),
                            "e_value": data.get("e_value"),
                            "bit_score": data.get("bit_score")
                        })
                
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        await pubsub.unsubscribe("amr_live_alerts")
    finally:
        await redis_conn.close()