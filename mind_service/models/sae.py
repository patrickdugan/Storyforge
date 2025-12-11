import torch

class SAE:
    def __init__(self, sae_path, device="cuda"):
        ckpt = torch.load(sae_path, map_location=device)
        self.W_enc = ckpt["W_enc"]
        self.W_dec = ckpt["W_dec"]
        self.device = device

    def encode(self, activation):
        h = torch.relu(activation @ self.W_enc.T)
        return h
