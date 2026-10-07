#!/usr/bin/env python3
# unsloth_train.py - Autonomous LoRA Trainer for SOMA
# This script uses the Unsloth framework to fine-tune a model on SOMA's codebase trajectory data.

import os
import sys
import torch
import json
from transformers import TrainingArguments
from unsloth import FastLanguageModel
from trl import SFTTrainer
from datasets import load_dataset

def main():
    print("[Unsloth Trainer] Starting SOMA Autonomous LoRA pipeline...")
    
    # Configuration
    dataset_path = os.environ.get("SOMA_DATASET_PATH", "data/training/soma_trajectories.jsonl")
    output_dir = os.environ.get("SOMA_LORA_OUTPUT", "lora-adapters/soma-coder-v1")
    model_name = os.environ.get("UNSLOTH_BASE_MODEL", "unsloth/llama-3-8b-Instruct-bnb-4bit")
    max_seq_length = 2048
    
    if not os.path.exists(dataset_path):
        print(f"[Unsloth Trainer] Error: Dataset not found at {dataset_path}")
        sys.exit(1)
        
    print(f"[Unsloth Trainer] Loading model: {model_name}")
    
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = model_name,
        max_seq_length = max_seq_length,
        dtype = None, # Auto-detect
        load_in_4bit = True, # Use 4-bit quantization to save VRAM
    )
    
    # Configure PEFT / LoRA
    print("[Unsloth Trainer] Configuring LoRA adapters...")
    model = FastLanguageModel.get_peft_model(
        model,
        r = 16, # Rank
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha = 16,
        lora_dropout = 0, # Unsloth optimizes dropout = 0
        bias = "none",
        use_gradient_checkpointing = "unsloth",
        random_state = 3407,
        use_rslora = False,
        loftq_config = None,
    )
    
    # Load dataset
    print(f"[Unsloth Trainer] Loading dataset: {dataset_path}")
    dataset = load_dataset("json", data_files=dataset_path, split="train")
    
    # Formatting function
    def formatting_prompts_func(examples):
        inputs = examples["instruction"]
        outputs = examples["output"]
        texts = []
        for input_text, output_text in zip(inputs, outputs):
            text = f"<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n{input_text}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n{output_text}<|eot_id|>"
            texts.append(text)
        return { "text" : texts }
        
    dataset = dataset.map(formatting_prompts_func, batched = True)
    
    print("[Unsloth Trainer] Initializing Trainer...")
    trainer = SFTTrainer(
        model = model,
        tokenizer = tokenizer,
        train_dataset = dataset,
        dataset_text_field = "text",
        max_seq_length = max_seq_length,
        dataset_num_proc = 2,
        packing = False, # Can make training 5x faster for short sequences
        args = TrainingArguments(
            per_device_train_batch_size = 2,
            gradient_accumulation_steps = 4,
            warmup_steps = 5,
            max_steps = 60, # Small run for testing
            learning_rate = 2e-4,
            fp16 = not torch.cuda.is_bf16_supported(),
            bf16 = torch.cuda.is_bf16_supported(),
            logging_steps = 1,
            optim = "adamw_8bit",
            weight_decay = 0.01,
            lr_scheduler_type = "linear",
            seed = 3407,
            output_dir = "outputs",
        ),
    )
    
    print("[Unsloth Trainer] Starting Training!")
    trainer_stats = trainer.train()
    
    print(f"[Unsloth Trainer] Training complete. Saving LoRA adapter to {output_dir}")
    model.save_pretrained(output_dir) # Local saving
    tokenizer.save_pretrained(output_dir)
    print("[Unsloth Trainer] Success!")

if __name__ == "__main__":
    main()
