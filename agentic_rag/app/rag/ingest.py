import os
import uuid
import hashlib
import pdfplumber
import chardet
from docx import Document
import pandas as pd
import json
from pathlib import Path
from app.config import settings

class DocumentIngestor:
    def __init__(self):
        self.upload_dir = Path(settings.docs_upload_path)
        self.processed_dir = Path(settings.docs_processed_path)
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        
    def process_file(self, filepath: Path, document_id: str = None) -> list[dict]:
        ext = filepath.suffix.lower()
        text_content = ""
        
        if ext == '.pdf':
            with pdfplumber.open(filepath) as pdf:
                text_content = "\n".join([page.extract_text() or '' for page in pdf.pages])
        elif ext == '.txt':
            with open(filepath, 'rb') as f:
                raw = f.read()
                enc = chardet.detect(raw)['encoding'] or 'utf-8'
                text_content = raw.decode(enc, errors='replace')
        elif ext == '.docx':
            doc = Document(filepath)
            text_content = "\n".join([p.text for p in doc.paragraphs])
        elif ext == '.csv':
            df = pd.read_csv(filepath)
            text_content = df.to_string()
        elif ext == '.json':
            with open(filepath, 'r') as f:
                data = json.load(f)
                text_content = json.dumps(data, indent=2)
                
        if not document_id:
            document_id = hashlib.md5(filepath.name.encode()).hexdigest()
            
        chunks = self._chunk_text(text_content)
        result = []
        
        # Save processed text
        with open(self.processed_dir / f"{document_id}.txt", 'w') as f:
            f.write(text_content)
            
        for chunk in chunks:
            result.append({
                "text": chunk,
                "metadata": {
                    "document": filepath.name,
                    "document_id": document_id,
                    "source": str(filepath),
                    "chunk_id": str(uuid.uuid4()),
                    "topic": [], # Simplified
                    "text": chunk
                }
            })
            
        return result
        
    def _chunk_text(self, text: str, chunk_size: int = 400, overlap: int = 50) -> list[str]:
        words = text.split()
        chunks = []
        for i in range(0, len(words), chunk_size - overlap):
            chunk = " ".join(words[i:i + chunk_size])
            if chunk:
                chunks.append(chunk)
        return chunks
