from dataclasses import dataclass

@dataclass
class ModelConfig:
    llm_path: str
    sae_path: str | None = None
    sae_layer: str | None = None
    device: str = "cuda"

CONFIG = ModelConfig(
    llm_path="models/llama3-8b.pt",
    sae_path="models/sae-layer14.pt",
    sae_layer="layers.14.mlp.down_proj",
)
