# Reference-video motion transfer quality research

Issue: [#33](https://github.com/phassle/DancingGrandma/issues/33)
Date: 2026-07-05

## Short answer

The technique is best called **motion transfer**, **reference-video motion transfer**, or **human image animation**. In model papers it is often framed as **character animation**: a still character/person image is driven by pose, expression, or motion signals from a reference video. "Image-to-video" is broader and is often too weak a term, because many image-to-video APIs only animate a still image from a prompt and do not copy another video's motion precisely.

For DancingGrandma, the most relevant product phrase is:

> character animation from one person photo plus one driving dance video

## What is happening technically

The better systems do not simply prompt "make this person dance." They use a pipeline like:

1. Upload a character/person image.
2. Upload a driving/reference video.
3. Extract body pose, facial expression, and sometimes scene/lighting information from the driving video.
4. Generate a temporally consistent video that preserves the character identity while following the driving motion.

Wan-Animate describes this directly: given a character image and reference video, it can animate the character by replicating the expressions and movements from the video, or replace the character in the source video while preserving scene lighting and tone. It uses spatially aligned skeleton signals for body motion and implicit facial features for expressions. Sources: [Wan-Animate project page](https://humanaigc.github.io/wan-animate/), [Wan-Animate arXiv paper](https://arxiv.org/abs/2509.14055).

This follows the same research direction as earlier systems:

- [Animate Anyone](https://arxiv.org/abs/2311.17117) uses a reference-image network, pose guider, and temporal modeling to preserve identity and smooth motion.
- [MagicAnimate](https://arxiv.org/abs/2311.16498) targets human image animation where a reference identity follows a motion sequence, improving temporal consistency and identity preservation.
- [MimicMotion](https://proceedings.mlr.press/v267/zhang25v.html) focuses on high-quality human motion video generation using confidence-aware pose guidance, regional loss amplification, and progressive latent fusion for longer smooth videos.
- [LivePortrait](https://liveportrait.github.io/) is relevant for faces/portraits, not full-body dance: it animates a portrait from driving motion such as facial expressions and head pose.

## Model/API options

### Current default: Kling Motion Control

The app now defaults to Kling v2.6 Motion Control because it completed a real end-to-end test with a YouTube-imported reference clip, a downscaled phone photo, `character_orientation: "video"`, and original audio preserved. fal describes Kling v2.6 Motion Control as transferring movement from a reference video to a character image. Its docs say the reference video should show a realistic-style character with full body or upper body visible, including the head, without obstruction; `character_orientation: "video"` is better for complex motions and allows up to 30 seconds, while `"image"` is better for camera-following portrait cases and allows up to 10 seconds: [fal Kling v2.6 Motion Control](https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control/api).

Kling v3 adds optional element binding for facial consistency when `character_orientation` is `"video"`: [fal Kling v3 Motion Control](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api). That is worth evaluating if identity drift is a top complaint.

### Strong open-source alternative: Wan-Animate via fal.ai

Wan remains a good fit for the workflow. fal's docs describe this endpoint as generating high-fidelity character videos by replicating expressions and movements from reference videos, and the schema requires both `video_url` and `image_url`: [fal Wan Animate Move API](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move/api).

Quality-relevant knobs in that API:

- `resolution`: `480p`, `580p`, or `720p`
- `num_inference_steps`: higher means better quality but slower
- `video_quality`: `low`, `medium`, `high`, or `maximum`
- `video_write_mode`: tradeoff between speed and file size
- `use_turbo`: fal says this applies quality enhancement for faster generation with optimized parameters

Current app note: `src/lib/generate.ts` sends Wan requests at `resolution: "580p"` and does not set `num_inference_steps` or `video_quality`. A quality pass should benchmark 720p plus explicit quality parameters before changing providers.

### Runway Act-Two

Runway Act-Two is also a good hosted candidate for evaluation. Runway's help docs describe the two required inputs as a driving performance video and a character image/video; the driving performance transfers movement, expressions, audio, and gestures to the character input: [Runway Act-Two help](https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two). Runway's API changelog says Act-Two became available via the API on July 21, 2025: [Runway API changelog](https://docs.dev.runwayml.com/api-details/api_changelog/).

Act-Two looks especially relevant for expressive upper-body performance and face/hand acting. It still needs a direct quality/cost benchmark against Wan and Kling for full-body dance.

### Sora / Azure Sora

Sora is not the right primary dependency for this exact workflow. Azure's Sora 2 docs frame it as text-to-video, image-to-video, and generated-video remix, not as exact reference-video motion transfer: [Azure Sora 2 video generation](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/video-generation). OpenAI's video docs also say Sora supports reference images, but input images with human faces are currently rejected and character uploads depicting human likeness are blocked by default: [OpenAI video generation guide](https://developers.openai.com/api/docs/guides/video-generation).

As of 2026-07-05, OpenAI's deprecations page also says the Sora 2 video models and Videos API are scheduled for removal on 2026-09-24: [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations). That makes Sora a poor long-term path for a grandma/person-photo workflow.

Current app note: the Azure route receives a photo and reference clip metadata, but the server-side Sora client only submits a text prompt. Even before deprecation, that route cannot preserve identity or copy the reference dance precisely.

### Hugging Face route

The current Hugging Face adapter is not doing motion transfer. It calls `InferenceClient.imageToVideo` with the uploaded photo and a prompt that mentions the reference clip name. Hugging Face's JS docs describe `imageToVideo` as taking image input and returning generated video, with Wan 2.1 I2V as the recommended model: [Hugging Face JS inference docs](https://huggingface.co/docs/huggingface.js/en/inference/modules).

That means the app's HF route can produce a dance-inspired image-to-video result, but it does not use the reference video as driving motion. If HF remains in the engine list, it should either route to a real motion-transfer backend or be labeled as approximate image-to-video.

## Input quality rules

The biggest practical improvement is not only the model. It is gating and normalizing the inputs.

Recommended source photo:

- One person only.
- Full body visible for full-body dances; upper body is acceptable only for portrait/gesture clips.
- Face visible, not too small, not blurred.
- Hands and feet visible where the dance needs them.
- No heavy occlusion, extreme crop, sunglasses, masks, or busy foreground objects.
- Similar starting orientation to the first frame of the reference video.
- Match the target aspect ratio before upload to avoid unwanted center crop. fal's Wan docs state that images not matching the chosen aspect ratio are resized and center-cropped.

Recommended reference video:

- One performer only.
- No hard cuts.
- Stable camera if the goal is motion clarity.
- Entire body or upper body visible, including head, without obstruction.
- Short clips first: 4-8 seconds for evaluation; expand once the pipeline works.
- Avoid extreme spins, floor moves, fast hand occlusions, and partial off-screen motion until the model/provider has passed a benchmark.
- Use licensed or owned reference clips for production.

Preprocessing worth adding:

- Transcode all reference clips to predictable H.264/AAC MP4.
- Normalize to vertical 9:16 when the app output is vertical.
- Trim to the strongest short segment.
- Detect and reject multi-person clips.
- Run a pose detector to warn on missing head/hands/feet, hard cuts, and severe occlusion.
- Generate several candidates per request only when the source passes validation; otherwise the extra spend just multiplies bad outputs.

## Evaluation rubric

Use a small golden set before changing providers or parameters:

- 5-10 person/grandma images covering realistic photo quality.
- 5-10 reference dances covering easy, medium, and hard movement.
- Fixed seeds/inputs where providers support them.
- Compare every engine on the same set.

Score each output 1-5 on:

- Identity preservation: still looks like the source person.
- Motion fidelity: follows the reference choreography and timing.
- Temporal consistency: low flicker, stable face/clothing/body.
- Anatomy: hands, feet, limbs, face, teeth, and eyes stay plausible.
- Framing: subject remains in frame and not awkwardly cropped.
- Audio: original reference audio preserved or muxed correctly.
- Safety/consent: visible AI watermark and no disallowed likeness handling.

Automated signals can help but should not replace human review:

- Extract pose from generated output and reference video, then compare keypoint trajectories. COCO's OKS/PCK-style pose metrics are relevant references: [COCO evaluator](https://github.com/cocodataset/cocoapi/blob/master/PythonAPI/pycocotools/cocoeval.py), [MMPose keypoint evaluation](https://mmpose.readthedocs.io/en/latest/_modules/mmpose/evaluation/functional/keypoint_eval.html).
- Compare face embeddings for identity preservation, with human review as the final call.
- Track provider latency, cost per successful acceptable clip, and retry rate.

## Recommended next steps for DancingGrandma

1. Treat this as **motion transfer**, not generic image-to-video.
2. Keep Wan Animate via fal as the first open-source quality target, but benchmark `720p`, explicit `video_quality`, and higher `num_inference_steps` against the current `580p` setting.
3. Evaluate Kling v3 Motion Control with element binding for identity consistency.
4. Reclassify or replace the HF route, because the current implementation does not consume the reference video as a motion driver.
5. Stop treating Sora/Azure Sora as a real fallback for this workflow; it is approximate, currently not wired to the uploaded image, has human-likeness constraints, and is scheduled for API removal.
6. Add input validation before spending generation credits.
7. Build a golden-set benchmark and compare output quality before making another provider the default.
