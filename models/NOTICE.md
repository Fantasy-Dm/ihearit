# Bundled YAMNet ONNX model

Copyright 2022 Google LLC. Licensed under Apache License 2.0; see `LICENSE`.

- Original implementation: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
- Original weights: https://www.kaggle.com/models/google/yamnet (version 1)
- Licensed ONNX export: https://huggingface.co/audiomagic/yamnet-onnx/tree/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd
- Export revision: `f25b741c2f0bdc6d7e6db24b5fddda23347dbafd`
- File: `yamnet.onnx`
- SHA-256: `d3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e`

The exporter converted the original TensorFlow SavedModel to ONNX with tf2onnx (opset 15); the model card states the weights were not retrained, fine-tuned, pruned, or quantized. Its full provenance and modification statement are retained in `UPSTREAM-MODEL-CARD.md`. I Hear It distributes this export unchanged. The previously used development mirror is not part of the formal release.

The tool uses embeddings to retrieve user-calibrated examples. Uncalibrated class scores only propose clips for human review. No AudioSet recordings or full ontology/class-map file are included. Upstream identifies AudioSet ontology and label metadata as CC BY 4.0; attribution is retained in the upstream model card.
