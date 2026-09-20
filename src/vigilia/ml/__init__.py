"""ML layer — graph construction, model definitions, training, inference,
and the model registry.

Rule: may import from domain/ (for shared types) and shared/. May not import
from api/. infra/ may be used only through the registry's storage backends
(ml/registry imports infra/storage, not the other way around).
"""
