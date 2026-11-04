# Third-party notices

I Hear It application source is licensed under MIT (see `LICENSE`). That license does not replace the licenses of the following third-party components.

| Component | Version/source | License and accompanying files |
| --- | --- | --- |
| YAMNet ONNX model | `audiomagic/yamnet-onnx`, revision `f25b741c2f0bdc6d7e6db24b5fddda23347dbafd` | Apache-2.0; `models/LICENSE`, `models/NOTICE.md`, `models/UPSTREAM-MODEL-CARD.md` |
| ONNX Runtime Node and Common | 1.31.1 | MIT; `licenses/ONNX-Runtime-LICENSE.txt`; included upstream components have additional licenses in `licenses/ONNX-Runtime-ThirdPartyNotices.txt` |
| @xmldom/xmldom | 0.9.12 | MIT; original `LICENSE` retained in the portable runtime package |
| Node.js | 24.13.0 in the first official Windows release | MIT and bundled component licenses; full upstream text in `licenses/Node-LICENSE.txt` |

## Source and provenance

- Application repository: <https://github.com/Fantasy-Dm/ihearit>
- Model export: <https://huggingface.co/audiomagic/yamnet-onnx/tree/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd>
- Upstream YAMNet code: <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>
- Original model: <https://www.kaggle.com/models/google/yamnet>
- ONNX Runtime exact source release, including sources covered by its third-party notices: <https://github.com/microsoft/onnxruntime/tree/v1.31.1>
- xmldom exact source release: <https://github.com/xmldom/xmldom/tree/0.9.12>
- Node.js exact source release: <https://github.com/nodejs/node/tree/v24.13.0>

The model's format conversion and unchanged-weight provenance are documented in the retained upstream model card. The application does not distribute AudioSet recordings, user recordings, or a full AudioSet class-map file. AudioSet ontology/label attribution is retained in the model card; those labels are identified upstream as CC BY 4.0.

The portable Windows release includes the three runtime npm packages in the table. npm installation helpers and their dependencies are present in the development lockfile but removed from the portable runtime. Their original license metadata remains in `package-lock.json`, and npm installs their original notices with the packages. No dependency source is modified.

Kdenlive, FFmpeg, Windows, and Edge are external programs supplied by the user or operating system. Their executables, code, fonts, logos, and installers are not bundled in this release. Naming the Kdenlive integration does not imply endorsement or affiliation.

Original third-party copyright and author notices are intentionally preserved. They identify their respective rights holders and are not application-user information.
