"""Infra layer — the only layer allowed to import psycopg2, boto3, etc.

Provides concrete adapters for interfaces defined in domain/ and ml/. May
not be imported by domain/. api/ and ml/ may depend on infra/.
"""
