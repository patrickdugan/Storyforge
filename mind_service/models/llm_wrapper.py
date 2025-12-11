import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

class LLMWrapper:
    def __init__(self, model_path, device="cuda"):
        self.device = device
        self.model = AutoModelForCausalLM.from_pretrained(model_path).to(device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self._cached_activations = {}

    def _make_hook(self, name):
        def hook(module, inp, out):
            self._cached_activations[name] = out.detach()
        return hook
    
    def register_activation_hook(self, layer_name):
        layer = dict(self.model.named_modules())[layer_name]
        layer.register_forward_hook(self._make_hook(layer_name))

    def generate_with_activations(self, prompt, max_new_tokens=64):
        self._cached_activations = {}
        toks = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        out = self.model.generate(
            **toks,
            max_new_tokens=max_new_tokens,
            output_hidden_states=True
        )
        return self.tokenizer.decode(out[0]), self._cached_activations
