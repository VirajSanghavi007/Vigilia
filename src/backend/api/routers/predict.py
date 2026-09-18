import io

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .. import state
from ..auth_deps import limiter

router = APIRouter()

# ── Custom transaction prediction (Predict tab) ──────────────────────────────


@router.post("/predict")
@limiter.limit("20/minute")
async def predict_transactions(
    request: Request,
    file: UploadFile | None = File(None),
    data: str | None = Form(None),
):
    """Score user-supplied transactions (CSV or Excel upload, or pasted CSV) on demand."""
    import pandas as pd
    from ...models.multignn import load_multignn, build_graph, score_transactions

    MAX_PREDICT_ROWS = 1000

    try:
        if file:
            name = (file.filename or "").lower()
            content = await file.read()
            if name.endswith((".xlsx", ".xls")):
                df = pd.read_excel(io.BytesIO(content))
            elif name.endswith(".csv"):
                df = pd.read_csv(io.BytesIO(content))
            else:
                raise HTTPException(status_code=400, detail="Only .csv and .xlsx/.xls files are accepted.")
        elif data:
            # Pasted data is CSV only — JSON is rejected.
            stripped = data.strip()
            if stripped.startswith("{") or stripped.startswith("["):
                raise HTTPException(status_code=400, detail="JSON is not accepted — paste CSV rows instead.")
            df = pd.read_csv(io.StringIO(data))
        else:
            raise HTTPException(status_code=400, detail="Must provide a file or pasted CSV data")

        if df.empty:
            raise HTTPException(status_code=400, detail="Provided data is empty")

        if len(df) > MAX_PREDICT_ROWS:
            raise HTTPException(
                status_code=400,
                detail=f"Too many rows ({len(df):,}). The Predict tab accepts up to {MAX_PREDICT_ROWS:,} rows.",
            )

        required_cols = {"Timestamp", "From Bank", "Account", "To Bank", "Account.1",
                         "Amount Paid", "Receiving Currency", "Payment Format"}
        if not required_cols.issubset(df.columns):
            missing = required_cols - set(df.columns)
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing}")

        if "Is Laundering" not in df.columns:
            df["Is Laundering"] = 0

        model, metrics = load_multignn()
        if not model:
            raise HTTPException(status_code=500, detail="Multi-GNN model is not trained or cannot be loaded.")

        threshold = float(metrics.get("threshold", 0.5)) if metrics else 0.5
        threshold = max(threshold, 0.10)

        bundle = build_graph(df=df, return_df=True)
        probs = score_transactions(model, bundle)

        res_df = bundle.get("df", df)
        if len(probs) == len(res_df):
            res_df["ml_score"] = probs
            res_df["flagged"] = res_df["ml_score"] >= threshold
        else:
            state.logger.warning(f"Length mismatch: {len(probs)} probs vs {len(res_df)} rows")
            res_df["ml_score"] = 0.0
            res_df["flagged"] = False

        if pd.api.types.is_datetime64_any_dtype(res_df["Timestamp"]):
            res_df["Timestamp"] = res_df["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")

        res_df = res_df.replace({np.nan: None})
        records = res_df.to_dict(orient="records")
        return JSONResponse(content={"transactions": records, "threshold": round(threshold, 4)})

    except HTTPException:
        raise
    except Exception as e:
        state.logger.error(f"Prediction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
