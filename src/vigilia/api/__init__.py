"""Presentation layer — FastAPI routers/schemas only.

Rule: this layer may import from domain/, ml/, and infra/. Nothing outside
this package may import *into* api/ — it is the outermost layer.
"""
