import torch
import torch.nn as nn

class LowLevelModule(nn.Module):
    def __init__(self, d_model):
        super().__init__()
        self.net = nn.GRUCell(d_model, d_model)

    def forward(self, x, state):
        return self.net(x, state)

class HighLevelModule(nn.Module):
    def __init__(self, d_model):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.ReLU(),
            nn.Linear(d_model, d_model)
        )

    def forward(self, x):
        return self.net(x)

class HRM(nn.Module):
    def __init__(self, d_model=2048, steps=3):
        super().__init__()
        self.L = LowLevelModule(d_model)
        self.H = HighLevelModule(d_model)
        self.steps = steps

    def forward(self, llm_embedding):
        state = torch.zeros_like(llm_embedding)
        x = llm_embedding

        for _ in range(self.steps):
            state = self.L(x, state)
            correction = self.H(state)
            x = state + correction

        return x
