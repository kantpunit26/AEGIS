import os
import tempfile
import json
from datetime import datetime
from celery import Celery
import subprocess
from database import SessionLocal
from models import OutbreakRecord
import redis
from seir import calculate_seir_projection

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery("aegis_tasks", broker=REDIS_URL, backend=REDIS_URL)
redis_client = redis.from_url(REDIS_URL)

CARD_DB_PATH = os.getenv("CARD_DB_PATH", "/app/card_db/card_database")

@celery_app.task(name="tasks.process_fasta_sequence")
def process_fasta_sequence(fasta_content: str, pathogen_name: str, site_name: str, latitude: float, longitude: float):
    with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".fasta") as temp_file:
        temp_file.write(fasta_content)
        temp_path = temp_file.name

    out_fmt = "6 sseqid pident length evalue bitscore"
    cmd = f"blastn -query {temp_path} -db {CARD_DB_PATH} -outfmt '{out_fmt}' -max_target_seqs 1"
    
    try:
        res = subprocess.check_output(cmd, shell=True).decode("utf-8").strip()
        os.remove(temp_path)
        
        if res:
            parts = res.split('\t')
            amr_gene = parts[0]
            e_value = float(parts[3])
            bit_score = float(parts[4])
            
            # Compute dynamic SEIR epidemiological model
            seir_data = calculate_seir_projection(
                population=150000,
                initial_infected=8,
                initial_exposed=24,
                beta=0.52 if "NDM" in amr_gene else 0.42,
                sigma=0.2,
                gamma=0.1,
                days=14
            )
            
            db = SessionLocal()
            record = OutbreakRecord(
                pathogen_name=pathogen_name,
                amr_gene=amr_gene,
                e_value=e_value,
                bit_score=bit_score,
                hospital_or_site=site_name,
                latitude=latitude,
                longitude=longitude,
                location=f"POINT({longitude} {latitude})"
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            
            payload = {
                "id": record.id,
                "pathogen_name": record.pathogen_name,
                "amr_gene": record.amr_gene,
                "e_value": record.e_value,
                "bit_score": record.bit_score,
                "hospital_or_site": record.hospital_or_site,
                "latitude": record.latitude,
                "longitude": record.longitude,
                "detected_at": record.detected_at.isoformat() if record.detected_at else "",
                "seir": seir_data
            }
            db.close()
            
            redis_client.publish("amr_live_alerts", json.dumps(payload))
            return payload
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise e