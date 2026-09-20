"""Domain layer — framework-agnostic business logic.

Rule: no imports of fastapi, psycopg2, boto3, torch, or anything from api/,
infra/, or ml/ in this package. If a domain module needs persistence or an
external service, it depends on a Protocol/interface defined here, and
infra/ provides the concrete implementation (dependency inversion) — never
the other way around.
"""
