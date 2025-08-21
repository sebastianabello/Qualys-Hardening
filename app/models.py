from pydantic import BaseModel, Field
from typing import List

class UploadResponse(BaseModel):
    upload_id: str
    filename: str
    size: int

class ProcessRequest(BaseModel):
    cliente: str = Field(min_length=1)
    fecha: str   # YYYY-MM-DD
    files: List[str]

class ProcessResponse(BaseModel):
    run_id: str

class ResultFile(BaseModel):
    name: str
    url: str
    rows: int
    cols: int
    warnings: list[str] = []

class ResultsResponse(BaseModel):
    files: list[ResultFile]

class PushToESResponse(BaseModel):
    total_docs: int
    failed: int
    details: list[dict]
