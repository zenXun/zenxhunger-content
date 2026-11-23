---
title: "Many Weights, One Mind: Study Notes on Model Merging"
description: "When Matrix-style skill downloads start looking possible"
pubDate: 2026-11-23
status: "Flop"
locale: "en"
tags: ["AI", "Engineering"]
translationKey: "studio/model-merging"
cover: ../_assets/model-merging/cover.jpg
coverAlt: "Two identical weight grids converging into one, preserving both teal and warm-gold task patterns simultaneously"
draft: false
---

Over five weeks in October and November 2026, Google shipped four Gemini 4 models: Argon (Oct 13), Carbon (Nov 10), Hydrogen (Nov 12), and Neon (Nov 18). Look at the `Model dependencies` field in the public model cards and a single lineage appears: Carbon `is based on` Argon, while Hydrogen and Neon are both `adapted from` Carbon.

Google has not disclosed what technique sits behind "adapted from", so there is no way from the outside to know how they built these variants. Still, that public lineage raises a concrete engineering question: **once you already have an expensive pre-trained base model, what tools exist to derive multiple specialized models from it?**

## Three Ways to Derive Models from One Base

Post-training adaptation generally falls into three buckets, each under different constraints:

| Approach | Mechanism | Architectural Constraint | Tradeoffs & Typical Use |
|---|---|---|---|
| **Continued Fine-Tuning (SFT / RLHF / DPO)** | Further gradient updates on the base weights | Same architecture | Requires task data and training compute; best for steering the model toward clearly defined new behaviors |
| **Distillation** | Train a smaller model to match a larger teacher's outputs | **Cross-size / cross-architecture** | Compresses capability into smaller, cheaper, lower-latency models |
| **Model Merging** | Average or add/subtract fine-tuned weights directly, with no retraining | **Same architecture and same pre-trained initialization** | Merging itself is just tensor arithmetic with zero extra inference cost; Meta's Llama 3 paper (§4.1.5) explicitly averages models across RM, SFT, and DPO stages |

If you have not read the foundational papers on model merging, you can start with my 11-minute animated walkthrough (in Mandarin) to build intuition—it traces **Model Soups**, **Task Arithmetic**, and **TIES-Merging**:

[![Model Merging 11-minute animated walkthrough covering Model Soups, Task Arithmetic, and TIES-Merging](../_assets/model-merging/video-cover.png "11-minute animated walkthrough of three foundational model-merging papers (Mandarin · click to play)")](https://youtu.be/9MecCo2YQ3w)
[Bilibili mirror](https://www.bilibili.com/video/BV1FWynzWEpp/?t=0)

Rather than repeating the video, this post focuses on two things the 11-minute format had to cut: **what happened in the research after 2023**, and **what I actually saw when merging two models on a 16GB M2 MacBook**.

## Where the Video Stops: Two Follow-Up Questions After 2023

In the TIES-Merging paper, the authors admit that we still lack a complete theory for why linear weight interpolation works in deep networks. Two threads from 2023–2024 push that question further.

### 1. Is "near-orthogonal high-dimensional vectors" really why task addition works?

The original Task Arithmetic paper noted that task vectors from different tasks have cosine similarity close to zero, and pointed to that as a reason they barely interfere. That explanation is weaker than it looks: in a billion-dimensional space, any two random vectors are nearly orthogonal. Because neural networks are nonlinear, orthogonality in parameter space does not automatically guarantee that their outputs will not collide.

In their NeurIPS 2023 Oral paper [*Task Arithmetic in the Tangent Space*](https://arxiv.org/abs/2305.12827), Ortiz-Jimenez et al. break the mechanism into two steps:

1. **The real driver is weight disentanglement.** Instead of only measuring angles between weight vectors, look at function space (`input → output`). In a heavily pre-trained model, moving weights along task A's direction (say, cars) changes outputs primarily on car inputs while leaving animal inputs nearly untouched—and vice versa. Pre-training maps different parameter directions to largely separate input regions, which is what allows task vectors to be added without interfering with each other.
2. **Why the paper proposes fine-tuning in the tangent space.** It was often assumed that standard fine-tuning moves weights little enough to stay nearly linear. The authors showed it does not: standard fine-tuning still introduces nonlinear drift that erodes weight disentanglement. Their fix changes **how you fine-tune** (not how you merge): take the first-order Taylor expansion of the network around the pre-trained checkpoint `θ₀`—approximating a curve by its tangent line at the starting point—and fine-tune only that linearized tangent model. Because the model's output becomes strictly linear in the weight delta `θ - θ₀`, weight disentanglement sharpens noticeably and task arithmetic accuracy rises.

### 2. At LLM scale, do fancier merging algorithms still pull ahead?

Following TIES-Merging, Yu et al. introduced [**DARE** (*Language Models are Super Mario*, ICML 2024)](https://arxiv.org/abs/2311.03099): randomly zero out 90% or even 99% of a fine-tuned model's parameter deltas (`θ_finetuned − θ_base`) and rescale the surviving entries, and merged performance barely budges.

"Rescaling" uses the same trick as Dropout during training. If you drop a fraction `p` of the deltas (say `p = 0.9`, zeroing out 90%), adding the survivors straight back would shrink the total update to 1/10 of its original size. Multiplying every surviving entry by `1 / (1 - p)` (×5 at 80% drop, ×10 at 90% drop) preserves the expected magnitude. Each task's delta becomes extremely sparse, sharply reducing the chance that two tasks overwrite the same coordinates during a merge.

![Schematic diagram of DARE random drop and rescaling](../_assets/model-merging/dare-rescale-en.png "How DARE (Drop And REscale) works: dropping 80% of deltas and scaling survivors by 5× preserves expected total magnitude|full|natural")

Even more worth reading is [*What Matters for Model Merging at Scale?*](https://arxiv.org/abs/2410.03617) (Yadav et al., 2024, with Google co-authors), which evaluates Model Soups, Task Arithmetic, TIES, and related methods across larger language models. The engineering takeaway is pragmatic: **the stronger and larger the base model, the easier merging becomes—and the smaller the gap between simple and intricate merging algorithms.** Picking a strong shared base and tuning fine-tuning hyperparameters often matters more than agonizing over the merge formula.

## Local Experiment: Merging Two Tasks on a 16GB M2 MacBook

Reading papers only gets you so far. To check how the equations behave on a real small model—and cross-check against `mergekit`—I ran a minimal experiment on my 16GB M2 MacBook (code in [`ai-paper-learning/02_model_merging`](https://github.com/zenXun/ai-paper-learning/tree/main/02_model_merging): fine-tuning in PyTorch on MPS, merge equations implemented in JAX, cross-checked with `mergekit`).

Scope and boundaries up front: this experiment tests four merging methods locally—**cross-task linear averaging** (the baseline in multi-task merging papers; strictly speaking, Model Soups averages multiple runs on the *same* task), **Task Arithmetic**, **TIES-Merging**, and **DARE**. Explicit **tangent-space linearized fine-tuning** and **7B+ scaling comparisons** are beyond 16GB local compute and remain literature notes only.

- **Base model**: `HuggingFaceTB/SmolLM2-360M-Instruct` (362M parameters, Apache-2.0)
- **Two tasks**: `stanfordnlp/sst2` (binary sentiment) and `fancyzhx/ag_news` (4-way news topic), evaluated on 500 examples each (1 example = 0.2 percentage points per task, or 0.1 percentage points on the 2-task average)
- **Fine-tuning setup & tradeoffs**: Both tasks start from the same raw base and run **full fine-tuning** (no LoRA, matching the task-vector definition) for **1 epoch over 2,000 examples, batch size 4 (500 steps), learning rate `1e-5`**. Stopping well short of the full datasets (67k for SST-2, 120k for AG News) is deliberate: a 40-step smoke test already gave strong signal, and more importantly, merging relies on fine-tuned weights staying close to the base model's loss basin—a small learning rate and a single epoch keep both models in that basin. To fit within 16GB unified memory, inputs are truncated to 128 tokens at batch size 4 (~6.1GB allocated, ~1.6s/step, with a 9GB abort guard against swapping).

### Full Measurements & `mergekit` Cross-Check

| Method | SST-2 | AG News | 2-Task Avg | Notes |
|---|---:|---:|---:|---|
| Pre-trained base (no FT) | 50.4% | 44.8% | 47.6% | Spot check: 199/200 SST-2 predictions were "negative" |
| Single-task FT · SST-2 | 90.8% | 67.4% | 79.1% | 500-step single-task fine-tune |
| Single-task FT · AG News | 88.0% | 92.4% | 90.2% | Format alignment unlocked the base's latent sentiment ability |
| Cross-task linear avg (`alpha = 0.5`, JAX) | 91.6% | 88.4% | 90.0% | SST-2 +0.8 pts over single-task; AG News -4.0 pts |
| Cross-task linear avg (`mergekit`) | 91.6% | 88.4% | 90.0% | Exact match with JAX implementation |
| Task Arithmetic (`lam = 0.7`, JAX) | 91.4% | 90.4% | 90.9% | Effectively tied with TIES at the same scale (0.2 pts) |
| Task Arithmetic (`lam = 1.0`, JAX) | 91.2% | 91.8% | 91.5% | Approaches 500-step single-task scores on both tasks |
| TIES-Merging (`density = 0.2, lam = 0.7`, JAX) | 92.4% | 89.0% | 90.7% | SST-2 +1.6 pts over single-task |
| TIES-Merging (`mergekit`) | 92.4% | 88.6% | 90.5% | Identical on SST-2; 2 examples (0.4 pts) apart on AG News |
| DARE (`drop = 0.99, lam = 0.5`, JAX) | 91.4% | 88.6% | 90.0% | Dropping 99% of deltas & scaling 100× leaves avg unchanged |

![Local SmolLM2-360M merging results and DARE drop-rate curve](../_assets/model-merging/local-results-en.png "SmolLM2-360M two-task merging comparison and DARE 0%→99% drop-rate sweep (2026-11-22, M2 16GB)|full|natural")

### Three Takeaways from Actually Running It

1. **The experimental caveat first: why did news fine-tuning push sentiment from 50.4% to 88.0%?**
   Look at the table and an obvious baseline jumps out: the single-task AG News model already averages **90.2%** across both tasks, while every merged model lands between **90.0% and 91.5%**. That means **this setup did not cleanly demonstrate combining two skills the base model did not already have**. The base model already understood sentiment; it was simply stuck answering `"negative"` before fine-tuning. Because both tasks share the same single-token chat template, fine-tuning on AG News unlocked format compliance for SST-2 as well. The lesson: inspect how the baseline fails before reading a jump as cross-task transfer; otherwise format alignment is easy to mistake for transfer. What *does* hold up cleanly here are three things: the task-vector cosine similarity, the `mergekit` cross-check, and the flat DARE curve.
2. **With two nearly orthogonal tasks, the merging methods basically tie.**
   The global cosine similarity between `tau_sst2` and `tau_ag_news` came out to **`0.0245`** (right inside the `0.01–0.06` band reported in Task Arithmetic Fig. 5), with similar L2 norms (3.53 vs. 4.14). At 500 evaluation examples per task (1,000 total, so 0.1 percentage points per example on the 2-task average), and with scaling factors picked on the same evaluation split, `Task Arithmetic (lam = 0.7)` (90.9%) and `TIES (lam = 0.7)` (90.7%) sit 0.2 percentage points apart—a net difference of just 2 examples (-5 on SST-2, +7 on AG News). Even with `lam = 1.0` reaching 91.5%, there is no basis to crown a winner—when only two low-conflict tasks are merged, simple addition and noise-filtering methods stay tightly bunched, echoing the 2024 scaling study.
3. **DARE at 362M completely contradicted my prior intuition.**
   Before running the sweep, I expected a 362M model—roughly one-thousandth the size of open large models like Llama 3.1 405B—to have far less parameter slack than 7B/70B models and to collapse well before 99% drop. Instead, across `drop = 0%, 50%, 80%, 90%, 95%, 99%`, the two-task average drew a flat line: **`90.0% → 90.0% → 89.9% → 90.0% → 90.1% → 90.0%`**. Even in a 362M model, full fine-tuning deltas are astonishingly redundant (with the caveat that single-token classification is much simpler than long-form reasoning, which may not survive 99% drop).

## Closing Thought

Model merging is not a silver bullet—it still requires identical architecture and initialization, and it still trails full multi-task joint training. Yet seeing the numbers firsthand shifted my mental model of weights. Inside the local neighborhood of a strong pre-trained base, weights stop feeling like an opaque block that only backpropagation can sculpt; they behave more like a Lego baseplate you can do linear algebra on. DARE shows how crude our control still is when it comes to combining specific capabilities cleanly—yet watching skills snap together like downloads in *The Matrix* still genuinely excites me. And these papers are already a few years old; it is hard not to wonder what the frontier looks like today.
