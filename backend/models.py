from sqlalchemy import Column, Integer, String, Float, DateTime
from geoalchemy2 import Geometry
from datetime import datetime
from database import Base

class OutbreakRecord(Base):
    __tablename__ = "outbreak_records"
    id = Column(Integer, primary_key=True, index=True)
    pathogen_name = Column(String, index=True, nullable=False)
    amr_gene = Column(String, index=True, nullable=False)
    e_value = Column(Float, nullable=False)
    bit_score = Column(Float, nullable=False)
    hospital_or_site = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location = Column(Geometry(geometry_type='POINT', srid=4326), nullable=False)
    detected_at = Column(DateTime, default=datetime.utcnow)