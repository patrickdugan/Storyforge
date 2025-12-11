from fastapi import FastAPI
from .schemas import DecideRequest, DecideResponse
from ..models.llm_wrapper import LLMWrapper
from ..models.hrm import HRM
from ..models.sae import SAE
from ..config import CONFIG
import torch

app = FastAPI()

llm = LLMWrapper(CONFIG.llm_path, CONFIG.device)
if CONFIG.sae_layer:
    llm.register_activation_hook(CONFIG.sae_layer)

sae = SAE(CONFIG.sae_path, CONFIG.device)
hrm = HRM(d_model=2048, steps=3).to(CONFIG.device)

@app.post("/decide", response_model=DecideResponse)
def decide(req: DecideRequest):
    text, activations = llm.generate_with_activations(
        req.prompt,
        max_new_tokens=req.max_new_tokens
    )

    act = activations.get(CONFIG.sae_layer)
    act = act.mean(dim=1)

    sparse = sae.encode(act)
    topk = torch.topk(sparse, k=20)
    features = [
        {"feature_id": int(i), "value": float(v)}
        for v, i in zip(topk.values, topk.indices)
    ]

    hrm_vec = None
    if req.hrm_enabled:
        refined = hrm(act)
        hrm_vec = refined.detach().cpu().tolist()

    return DecideResponse(
        text=text,
        features=features,
        hrm_vector=hrm_vec
    )
