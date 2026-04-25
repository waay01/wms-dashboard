from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://wms:wms_secret@localhost:5432/wms_logs")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class LogEntry(Base):
    __tablename__ = "log_entries"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False)
    pid = Column(Integer)
    db_user = Column(String(100))
    database = Column(String(100))
    level = Column(String(50))
    level_eng = Column(String(20))
    msg = Column(Text)
    is_tsd = Column(Integer, default=0)
    operator_name = Column(String(100))
    terminal_uuid = Column(String(50))
    raw = Column(Text)
    __table_args__ = (
        Index("ix_timestamp", "timestamp"),
        Index("ix_level_eng", "level_eng"),
        Index("ix_database", "database"),
        Index("ix_is_tsd", "is_tsd"),
        Index("ix_operator_name", "operator_name"),
        Index("ix_terminal_uuid", "terminal_uuid"),
    )

class IngestedFile(Base):
    __tablename__ = "ingested_files"
    id = Column(Integer, primary_key=True)
    filename = Column(String(500), unique=True, nullable=False)
    ingested_at = Column(DateTime, default=datetime.utcnow)
    entry_count = Column(Integer, default=0)

def init_db():
    Base.metadata.create_all(bind=engine)
    # Добавляем столбец если его ещё нет
    try:
        with engine.connect() as conn:
            conn.execute(__import__('sqlalchemy').text(
                "ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS terminal_uuid VARCHAR(50)"
            ))
            conn.execute(__import__('sqlalchemy').text(
                "CREATE INDEX IF NOT EXISTS ix_terminal_uuid ON log_entries (terminal_uuid)"
            ))
            conn.commit()
    except: pass

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
